// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {SD59x18, sd, exp, ln} from "@prb/math/src/SD59x18.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "./IBetResolver.sol";

/**
 * @title BetMarket
 * @author Gemini
 * @notice A prediction market contract using the Logarithmic Market Scoring Rule (LMSR).
 * @dev This contract uses prb-math v4 (SD59x18) for fixed-point arithmetic.
 * It dynamically handles collateral token decimals to ensure numerical stability.
 * It manages multiple prediction pools, each with its own liquidity and state.
 */
contract BetMarket is Ownable {
    using Strings for uint256;
    using SafeERC20 for IERC20;

    uint256 private constant PROMPT_SIZE_LIMIT = 2048;

    // --- Enums and Structs ---

    enum Resolution {
        UNRESOLVED,
        YES,
        NO,
        INCONCLUSIVE
    }

    struct Pool {
        uint256 id;
        address creator;
        uint256 closingTime;
        uint256 resolutionTime;
        SD59x18 b; // Liquidity parameter, stored as d18
        SD59x18 nYes; // Number of YES shares, stored as d18
        SD59x18 nNo; // Number of NO shares, stored as d18
        uint256 totalSupplyYes;
        uint256 totalSupplyNo;
        uint256 collateral;
        Resolution resolution;
        string title;
        string resolutionPrompt;
        string discussionUrl;
        string tags;
        string logoUrl;
    }

    // --- State Variables ---

    IERC20 public collateralToken;
    IBetResolver public dtnResolver;
    address public reserveAddress;
    uint8 public collateralDecimals;
    uint256 public scalingFactor; // = 10**(18 - collateralDecimals)

    uint256 public constant TOTAL_FEE_BPS = 20;
    uint256 public constant REFERRER_FEE_BPS = 10;
    mapping(address => uint256) public withdrawableFees;

    uint256 private poolCounter;
    mapping(uint256 => Pool) public pools;
    mapping(uint256 => mapping(address => uint256)) public yesBalances;
    mapping(uint256 => mapping(address => uint256)) public noBalances;
    mapping(uint256 => mapping(address => bool)) public isBlockedFromTrading;
    uint256[] public betIds;

    // --- Events ---

    event BetCreated(uint256 indexed poolId, address indexed creator, string title, uint256 initialLiquidity, uint256 closingTime);
    event Trade(uint256 indexed poolId, address indexed trader, bool isBuy, bool isYes, uint256 tokenAmount, uint256 collateralAmount);
    event PoolResolving(uint256 indexed poolId);
    event PoolResolved(uint256 indexed poolId, Resolution outcome);
    event Withdrawn(uint256 indexed poolId, address indexed user, uint256 amount);
    event FeesWithdrawn(address indexed recipient, uint256 amount);
    event Configured(address collateralToken, uint8 decimals);

    // --- Constructor ---

    constructor(address owner) Ownable(owner) {}

    /**
     * @notice Configures the contract's core addresses and parameters.
     * @dev Fetches and stores the collateral token's decimals to calculate the scaling factor.
     */
    function configure(address _collateralToken, address _dtnResolver, address _reserveAddress) external onlyOwner {
        collateralToken = IERC20(_collateralToken);
        dtnResolver = IBetResolver(_dtnResolver);
        reserveAddress = _reserveAddress;
        
        collateralDecimals = IERC20Metadata(address(collateralToken)).decimals();
        require(collateralDecimals <= 18, "Token decimals cannot exceed 18");
        scalingFactor = 10**(18 - collateralDecimals);
        
        emit Configured(_collateralToken, collateralDecimals);
    }

    // --- Public Functions ---

    function betIdsLength() external view returns (uint256) {
        return betIds.length;
    }

    function getBetSummaries(uint256[] memory _betIds) external view returns (
        uint256[] memory _yesSupply, uint256[] memory _noSupply, uint256[] memory _collaterals, uint8[] memory _resolutions) {
        uint256 length = _betIds.length;
        _yesSupply = new uint256[](length);
        _noSupply = new uint256[](length);
        _collaterals = new uint256[](length);
        _resolutions = new uint8[](length);

        for (uint256 i = 0; i < length; i++) {
            uint256 betId = _betIds[i]; // Use the passed-in ID
            Pool storage pool = pools[betId];
            _yesSupply[i] = pool.totalSupplyYes;
            _noSupply[i] = pool.totalSupplyNo;
            _collaterals[i] = pool.collateral;
            _resolutions[i] = uint8(pool.resolution);
        }
    }

    function createBet(
        string memory _title,
        string memory _resolutionPrompt,
        uint256 _initialLiquidity,
        uint256 _closingTime,
        uint256 _resolutionTime,
        string memory _discussionUrl,
        string memory _tags,
        string memory _logoUrl) external {
        require(_initialLiquidity > 0, "Initial liquidity must be > 0");
        require(_closingTime > block.timestamp, "Closing time must be in the future");
        require(_resolutionTime >= _closingTime, "Resolution must be after closing");
        require(bytes(_resolutionPrompt).length <= PROMPT_SIZE_LIMIT, "Resolution prompt too long");
        require(address(collateralToken) != address(0), "Contract not configured");

        poolCounter++;
        uint256 poolId = poolCounter;

        uint256 bonusTokens = (_initialLiquidity * 2) / 100;
        uint256 creatorYesTokens = (_initialLiquidity + bonusTokens) / 2;
        uint256 creatorNoTokens = (_initialLiquidity + bonusTokens) / 2;

        pools[poolId] = Pool({
            id: poolId,
            title: _title,
            resolutionPrompt: _resolutionPrompt,
            creator: msg.sender,
            closingTime: _closingTime,
            resolutionTime: _resolutionTime,
            // Set b=$100, properly scaled to 18 decimals for the math library
            b: sd(int256(100 * 1e18)),
            // Scale initial token amounts to 18 decimals for the math library
            nYes: sd(int256(creatorYesTokens * scalingFactor)),
            nNo: sd(int256(creatorNoTokens * scalingFactor)),
            totalSupplyYes: creatorYesTokens,
            totalSupplyNo: creatorNoTokens,
            collateral: _initialLiquidity,
            resolution: Resolution.UNRESOLVED,
            discussionUrl: _discussionUrl,
            tags: _tags,
            logoUrl: _logoUrl
        });


        isBlockedFromTrading[poolId][msg.sender] = true;
        yesBalances[poolId][msg.sender] = creatorYesTokens;
        noBalances[poolId][msg.sender] = creatorNoTokens;
        betIds.push(poolId);

        collateralToken.safeTransferFrom(msg.sender, address(this), _initialLiquidity);

        emit BetCreated(poolId, msg.sender, _title, _initialLiquidity, _closingTime);
    }

    function buyYes(uint256 poolId, uint256 amount, address referrer) external {
        _buy(poolId, amount, true, referrer);
    }

    function buyNo(uint256 poolId, uint256 amount, address referrer) external {
        _buy(poolId, amount, false, referrer);
    }

    function sellYes(uint256 poolId, uint256 amount, address referrer) external {
        _sell(poolId, amount, true, referrer);
    }

    function sellNo(uint256 poolId, uint256 amount, address referrer) external {
        _sell(poolId, amount, false, referrer);
    }

    function resolve(uint256 poolId) external payable {
        Pool storage pool = pools[poolId];
        require(pool.id != 0, "Pool does not exist");
        require(block.timestamp > pool.resolutionTime, "Not yet resolution time");
        require(pool.resolution == Resolution.UNRESOLVED, "Pool already resolved");
        
        dtnResolver.resolve{value: msg.value}(poolId, pool.resolutionPrompt, this.onPoolResolve.selector);
        emit PoolResolving(poolId);
    }

    function onPoolResolve(uint256 poolId, IBetResolver.Outcome outcome) external {
        require(msg.sender == address(dtnResolver), "Caller is not the oracle");
        Pool storage pool = pools[poolId];
        require(pool.id != 0, "Pool does not exist");
        require(pool.resolution == Resolution.UNRESOLVED, "Pool already resolved");

        if (outcome == IBetResolver.Outcome.True) pool.resolution = Resolution.YES;
        else if (outcome == IBetResolver.Outcome.False) pool.resolution = Resolution.NO;
        else pool.resolution = Resolution.INCONCLUSIVE;
        
        emit PoolResolved(poolId, pool.resolution);
    }

    function withdraw(uint256 poolId) external {
        uint256 payout = withdrawableAmount(poolId, msg.sender);
        require(payout > 0, "No funds to withdraw");

        yesBalances[poolId][msg.sender] = 0;
        noBalances[poolId][msg.sender] = 0;

        collateralToken.safeTransfer(msg.sender, payout);
        emit Withdrawn(poolId, msg.sender, payout);
    }

    function withdrawFees() external {
        uint256 amount = withdrawableFees[msg.sender];
        require(amount > 0, "No fees to withdraw");
        withdrawableFees[msg.sender] = 0;
        collateralToken.safeTransfer(msg.sender, amount);
        emit FeesWithdrawn(msg.sender, amount);
    }

    // --- Internal Functions ---

    function _buy(uint256 poolId, uint256 amount, bool isYes, address referrer) internal {
        Pool storage pool = pools[poolId];
        _validateTrade(pool, msg.sender);
        require(amount > 0, "Amount must be > 0");

        uint256 netCost = isYes ? _costToBuyYes(poolId, amount) : _costToBuyNo(poolId, amount);
        
        uint256 fee = (netCost * TOTAL_FEE_BPS) / 10000;
        uint256 totalCost = netCost + fee;

        pool.collateral += netCost;
        // Scale the amount to 18 decimals before adding to the fixed-point state
        SD59x18 amountFixed = sd(int256(amount * scalingFactor));
        if (isYes) {
            pool.nYes = pool.nYes + amountFixed;
            pool.totalSupplyYes += amount;
            yesBalances[poolId][msg.sender] += amount;
        } else {
            pool.nNo = pool.nNo + amountFixed;
            pool.totalSupplyNo += amount;
            noBalances[poolId][msg.sender] += amount;
        }

        _distributeFees(fee, referrer);
        collateralToken.safeTransferFrom(msg.sender, address(this), totalCost);
        emit Trade(poolId, msg.sender, true, isYes, amount, netCost);
    }

    function _sell(uint256 poolId, uint256 amount, bool isYes, address referrer) internal {
        Pool storage pool = pools[poolId];
        _validateTrade(pool, msg.sender);
        require(amount > 0, "Amount must be > 0");

        if (isYes) require(yesBalances[poolId][msg.sender] >= amount, "Insufficient YES balance");
        else require(noBalances[poolId][msg.sender] >= amount, "Insufficient NO balance");

        // The public-facing revenue functions return the net refund, so we use an internal one to get the gross.
        uint256 grossRefund = _revenueFromSell(poolId, amount, isYes);
        require(grossRefund > 0, "Refund cannot be zero");

        uint256 fee = (grossRefund * TOTAL_FEE_BPS) / 10000;
        require(grossRefund > fee, "Refund less than fee");
        uint256 netRefund = grossRefund - fee;
        
        pool.collateral -= grossRefund;

        // Scale the amount to 18 decimals before subtracting from the fixed-point state
        SD59x18 amountFixed = sd(int256(amount * scalingFactor));
        if (isYes) {
            pool.nYes = pool.nYes - amountFixed;
            pool.totalSupplyYes -= amount;
            yesBalances[poolId][msg.sender] -= amount;
        } else {
            pool.nNo = pool.nNo - amountFixed;
            pool.totalSupplyNo -= amount;
            noBalances[poolId][msg.sender] -= amount;
        }

        _distributeFees(fee, referrer);
        collateralToken.safeTransfer(msg.sender, netRefund);
        emit Trade(poolId, msg.sender, false, isYes, amount, grossRefund);
    }

    function _distributeFees(uint256 fee, address referrer) internal {
        if (fee == 0) return;
        
        uint256 referrerCut = 0;
        if (referrer != address(0) && referrer != reserveAddress) {
            referrerCut = (fee * REFERRER_FEE_BPS) / TOTAL_FEE_BPS;
            withdrawableFees[referrer] += referrerCut;
        }
        
        uint256 reserveCut = fee - referrerCut;
        withdrawableFees[reserveAddress] += reserveCut;
    }

    function _validateTrade(Pool storage pool, address trader) internal view {
        require(pool.id != 0, "Pool does not exist");
        require(block.timestamp <= pool.closingTime, "Trading has closed");
        require(pool.resolution == Resolution.UNRESOLVED, "Pool is resolved");
        require(!isBlockedFromTrading[pool.id][trader], "Address is blocked from trading");
    }

    // --- LMSR Math Functions (Internal) ---

    function _calcCost(SD59x18 _nYes, SD59x18 _nNo, SD59x18 _b) internal pure returns (SD59x18) {
        SD59x18 expNy = exp(_nYes / _b);
        SD59x18 expNn = exp(_nNo / _b);
        return ln(expNy + expNn) * _b;
    }

    function _costToBuy(uint256 poolId, uint256 amount, bool isYes) internal view returns (uint256) {
        Pool storage pool = pools[poolId];
        // Scale amount from token decimals to 18 decimals for math
        SD59x18 amountFixed = sd(int256(amount * scalingFactor));
        SD59x18 initialCost = _calcCost(pool.nYes, pool.nNo, pool.b);
        SD59x18 finalCost;
        if (isYes) {
            finalCost = _calcCost(pool.nYes + amountFixed, pool.nNo, pool.b);
        } else {
            finalCost = _calcCost(pool.nYes, pool.nNo + amountFixed, pool.b);
        }
        // Unwrap and scale result from 18 decimals back to token decimals
        return uint256(SD59x18.unwrap(finalCost - initialCost)) / scalingFactor;
    }
    
    function _revenueFromSell(uint256 poolId, uint256 amount, bool isYes) internal view returns (uint256) {
        Pool storage pool = pools[poolId];
        // Scale amount from token decimals to 18 decimals for math
        SD59x18 amountFixed = sd(int256(amount * scalingFactor));
        SD59x18 initialCost = _calcCost(pool.nYes, pool.nNo, pool.b);
        SD59x18 finalCost;
        if (isYes) {
            finalCost = _calcCost(pool.nYes - amountFixed, pool.nNo, pool.b);
        } else {
            finalCost = _calcCost(pool.nYes, pool.nNo - amountFixed, pool.b);
        }
        // Unwrap and scale result from 18 decimals back to token decimals
        return uint256(SD59x18.unwrap(initialCost - finalCost)) / scalingFactor;
    }
    
    // --- View Functions ---

    function withdrawableAmount(uint256 poolId, address user) public view returns (uint256) {
        Pool storage pool = pools[poolId];
        Resolution resolution = pool.resolution;
        require(resolution != Resolution.UNRESOLVED, "Pool not resolved");

        uint256 userYes = yesBalances[poolId][user];
        uint256 userNo = noBalances[poolId][user];
        uint256 payout = 0;

        if (resolution == Resolution.YES) {
            if (pool.totalSupplyYes > 0) payout = (pool.collateral * userYes) / pool.totalSupplyYes;
        } else if (resolution == Resolution.NO) {
            if (pool.totalSupplyNo > 0) payout = (pool.collateral * userNo) / pool.totalSupplyNo;
        } else { // Inconclusive
            uint256 totalTokens = pool.totalSupplyYes + pool.totalSupplyNo;
            if (totalTokens > 0) {
                uint256 userTotalTokens = userYes + userNo;
                payout = (pool.collateral * userTotalTokens) / totalTokens;
            }
        }
        return payout;
    }

    function _costToBuyYes(uint256 poolId, uint256 amount) internal view returns (uint256) {
        return _costToBuy(poolId, amount, true);
    }

    function costToBuyYes(uint256 poolId, uint256 amount) external view returns (uint256) {
        uint256 netCost = _costToBuyYes(poolId, amount);
        uint256 fee = (netCost * TOTAL_FEE_BPS) / 10000;
        return netCost + fee;
    }

    function _costToBuyNo(uint256 poolId, uint256 amount) internal view returns (uint256) {
        return _costToBuy(poolId, amount, false);
    }

    function costToBuyNo(uint256 poolId, uint256 amount) external view returns (uint256) {
        uint256 netCost = _costToBuyNo(poolId, amount);
        uint256 fee = (netCost * TOTAL_FEE_BPS) / 10000;
        return netCost + fee;
    }

    function revenueFromSellYes(uint256 poolId, uint256 amount) public view returns (uint256) {
        uint256 grossRevenue = _revenueFromSell(poolId, amount, true);
        uint256 fee = (grossRevenue * TOTAL_FEE_BPS) / 10000;
        if (grossRevenue <= fee) return 0;
        return (grossRevenue - fee);
    }

    function revenueFromSellNo(uint256 poolId, uint256 amount) public view returns (uint256) {
        uint256 grossRevenue = _revenueFromSell(poolId, amount, false);
        uint256 fee = (grossRevenue * TOTAL_FEE_BPS) / 10000;
        if (grossRevenue <= fee) return 0;
        return (grossRevenue - fee);
    }
}