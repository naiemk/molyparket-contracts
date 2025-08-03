const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

// Helper to convert numbers to the SD59x18 fixed-point format
const toSD59x18 = (x) => ethers.parseUnits(x.toString(), 18);

describe("BetMarket", function () {
    let betMarket, collateralToken, mockResolver;
    let deployer, user1, user2, referrer, reserve;
    const POOL_ID = 1;

    beforeEach(async function () {
        // Get signers
        [deployer, user1, user2, referrer] = await ethers.getSigners();
        reserve = deployer; // Using deployer as the reserve for simplicity

        // Deploy Mock ERC20 Collateral Token
        const MockToken = await ethers.getContractFactory("MockToken");
        collateralToken = await MockToken.deploy("Mock USD", "mUSD", ethers.parseUnits("1000000", 6));

        // Distribute collateral tokens to users
        await collateralToken.transfer(user1.address, ethers.parseUnits("10000", 6));
        await collateralToken.transfer(user2.address, ethers.parseUnits("10000", 6));

        // Deploy Mock Resolver
        const MockResolver = await ethers.getContractFactory("MockDtnResolver");
        mockResolver = await MockResolver.deploy();

        // Deploy BetMarket
        const BetMarket = await ethers.getContractFactory("BetMarket");
        betMarket = await BetMarket.deploy(
            await collateralToken.getAddress(),
            await mockResolver.getAddress(),
            reserve.address
        );

        // Grant allowance to the BetMarket contract
        await collateralToken.connect(deployer).approve(await betMarket.getAddress(), ethers.MaxUint256);
        await collateralToken.connect(user1).approve(await betMarket.getAddress(), ethers.MaxUint256);
        await collateralToken.connect(user2).approve(await betMarket.getAddress(), ethers.MaxUint256);
    });

    // MockDtnResolver contract for testing purposes
    before(async () => {
        const MockDtnResolverArtifact = await ethers.getContractFactory("MockDtnResolver");
        const MockTokenArtifact = await ethers.getContractFactory("MockToken");
    });

    // We need to define the mock contracts within the script for Hardhat to compile them
    it("should compile mock contracts", async function () {
        await ethers.getContractFactory("MockDtnResolver");
        await ethers.getContractFactory("MockToken");
    });


    describe("Bet Creation", function () {
        it("Should create a new bet pool correctly", async function () {
            const title = "Will ETH reach $10k by 2025?";
            const initialLiquidity = ethers.parseUnits("1000", 6);
            const closingTime = (await time.latest()) + 86400; // 1 day from now
            const b = 100; // Liquidity parameter

            await expect(betMarket.connect(deployer).createBet(title, initialLiquidity, closingTime, b))
                .to.emit(betMarket, "BetCreated")
                .withArgs(POOL_ID, deployer.address, title, initialLiquidity, closingTime);

            const pool = await betMarket.pools(POOL_ID);
            expect(pool.id).to.equal(POOL_ID);
            expect(pool.title).to.equal(title);
            expect(pool.creator).to.equal(deployer.address);
            expect(pool.collateral).to.equal(initialLiquidity);

            // Check creator's bonus (2%)
            const bonusTokens = (initialLiquidity * 2n) / 100n;
            const expectedTokens = (initialLiquidity + bonusTokens) / 2n;

            expect(await betMarket.yesBalances(POOL_ID, deployer.address)).to.equal(expectedTokens);
            expect(await betMarket.noBalances(POOL_ID, deployer.address)).to.equal(expectedTokens);
            expect(pool.totalSupplyYes).to.equal(expectedTokens);

            // Check if creator is blocked
            expect(await betMarket.isBlockedFromTrading(POOL_ID, deployer.address)).to.be.true;
        });
    });

    describe("Trading: Buying and Selling", function () {
        const initialLiquidity = ethers.parseUnits("1000", 6);
        const b = 100;

        beforeEach(async function () {
            const closingTime = (await time.latest()) + 86400;
            await betMarket.connect(deployer).createBet("Test Bet", initialLiquidity, closingTime, b);
        });

        it("Should allow a user to buy YES tokens", async function () {
            const amountToBuy = ethers.parseUnits("100", 6);
            const totalCost = await betMarket.costToBuyYes(POOL_ID, amountToBuy);

            const initialBalance = await collateralToken.balanceOf(user1.address);

            await betMarket.connect(user1).buyYes(POOL_ID, amountToBuy, referrer.address);

            // Check balances
            expect(await betMarket.yesBalances(POOL_ID, user1.address)).to.equal(amountToBuy);
            const finalBalance = await collateralToken.balanceOf(user1.address);
            expect(initialBalance - finalBalance).to.equal(totalCost);

            // Check fees
            const netCost = (totalCost * 10000n) / 10020n; // Extract net cost from total cost
            const fee = totalCost - netCost; // Fee is the difference
            const referrerFee = fee / 2n; // REFERRER_FEE_BPS = 10, TOTAL_FEE_BPS = 20
            const reserveFee = fee - referrerFee;
            expect(await betMarket.withdrawableFees(referrer.address)).to.equal(referrerFee);
            expect(await betMarket.withdrawableFees(reserve.address)).to.equal(reserveFee);
        });

        it("Should allow a user to sell NO tokens", async function () {
            // First, user1 buys NO tokens
            const amountToBuy = ethers.parseUnits("50", 6);
            await betMarket.connect(user1).buyNo(POOL_ID, amountToBuy, ethers.ZeroAddress);
            expect(await betMarket.noBalances(POOL_ID, user1.address)).to.equal(amountToBuy);

            // Now, user1 sells them
            const amountToSell = ethers.parseUnits("50", 6);
            const refund = await betMarket.revenueFromSellNo(POOL_ID, amountToSell);
            const initialBalance = await collateralToken.balanceOf(user1.address);

            await betMarket.connect(user1).sellNo(POOL_ID, amountToSell, ethers.ZeroAddress);

            expect(await betMarket.noBalances(POOL_ID, user1.address)).to.equal(0);
            const finalBalance = await collateralToken.balanceOf(user1.address);
            expect(finalBalance - initialBalance).to.equal(refund);
        });

        it("Should bring the pool state back to near-original after a buy and sell", async function () {
            const poolBefore = await betMarket.pools(POOL_ID);

            // User 1 buys 100 YES tokens
            const amount = ethers.parseUnits("100", 6);
            await betMarket.connect(user1).buyYes(POOL_ID, amount, ethers.ZeroAddress);
            
            const poolAfterBuy = await betMarket.pools(POOL_ID);
            expect(poolAfterBuy.nYes).to.not.equal(poolBefore.nYes);

            // User 1 immediately sells the same 100 YES tokens
            await betMarket.connect(user1).sellYes(POOL_ID, amount, ethers.ZeroAddress);

            const poolAfterSell = await betMarket.pools(POOL_ID);

            // Due to fees and fixed-point math, we check if it's close, not identical
            const tolerance = toSD59x18("0.00001");
            expect(poolAfterSell.nYes).to.be.closeTo(poolBefore.nYes, tolerance);
            expect(poolAfterSell.nNo).to.be.closeTo(poolBefore.nNo, tolerance);
            
            // Collateral will be lower due to fees collected
            const feesCollected = await betMarket.withdrawableFees(reserve.address);
            expect(feesCollected).to.be.gt(0);
            expect(poolAfterSell.collateral).to.be.closeTo(poolBefore.collateral, ethers.parseUnits("200", 4));
        });
    });

    describe("Resolution and Withdrawal", function () {
        const initialLiquidity = ethers.parseUnits("1000", 6);
        const b = 100;

        beforeEach(async function () {
            const closingTime = (await time.latest()) + 86400;
            await betMarket.connect(deployer).createBet("Resolution Test", initialLiquidity, closingTime, b);
            
            // Users buy tokens
            await betMarket.connect(user1).buyYes(POOL_ID, ethers.parseUnits("100", 6), ethers.ZeroAddress);
            await betMarket.connect(user2).buyNo(POOL_ID, ethers.parseUnits("200", 6), ethers.ZeroAddress);
        });

        it("Should correctly pay out winners when YES is the outcome", async function () {
            // Fast-forward time
            const pool = await betMarket.pools(POOL_ID);
            await time.increaseTo(pool.closingTime + 1n);

            // Resolve the bet
            await expect(betMarket.connect(deployer).resolve(POOL_ID))
                .to.emit(mockResolver, "ResolutionRequested");
            
            // Simulate oracle callback
            await mockResolver.connect(deployer).callBack(await betMarket.getAddress(), POOL_ID, 1); // 1 for YES

            const resolvedPool = await betMarket.pools(POOL_ID);
            expect(resolvedPool.resolution).to.equal(1); // Resolution.YES

            // User1 (YES holder) withdraws
            const expectedPayout = await betMarket.withdrawableAmount(POOL_ID, user1.address);
            const initialBalance = await collateralToken.balanceOf(user1.address);
            await betMarket.connect(user1).withdraw(POOL_ID);
            const finalBalance = await collateralToken.balanceOf(user1.address);
            expect(finalBalance - initialBalance).to.equal(expectedPayout);
            expect(expectedPayout).to.be.gt(0);

            // User2 (NO holder) should get nothing
            await expect(betMarket.connect(user2).withdraw(POOL_ID))
                .to.be.revertedWith("No funds to withdraw");
        });

        it("Should correctly pay out winners when INCONCLUSIVE is the outcome", async function () {
            // Fast-forward time and resolve
            const pool = await betMarket.pools(POOL_ID);
            await time.increaseTo(pool.closingTime + 1n);
            await betMarket.connect(deployer).resolve(POOL_ID);
            await mockResolver.connect(deployer).callBack(await betMarket.getAddress(), POOL_ID, 0); // 0 for INCONCLUSIVE

            // Both users should be able to withdraw a proportional amount
            const payout1 = await betMarket.withdrawableAmount(POOL_ID, user1.address);
            const payout2 = await betMarket.withdrawableAmount(POOL_ID, user2.address);

            expect(payout1).to.be.gt(0);
            expect(payout2).to.be.gt(0);

            // User1 withdraws
            const initialBalance1 = await collateralToken.balanceOf(user1.address);
            await betMarket.connect(user1).withdraw(POOL_ID);
            expect(await collateralToken.balanceOf(user1.address)).to.equal(initialBalance1 + payout1);
        });

        it("Should allow fee withdrawal", async function() {
            const initialReserveFees = await betMarket.withdrawableFees(reserve.address);
            expect(initialReserveFees).to.be.gt(0);

            const initialReserveBalance = await collateralToken.balanceOf(reserve.address);
            await betMarket.connect(reserve).withdrawFees();
            
            expect(await betMarket.withdrawableFees(reserve.address)).to.equal(0);
            expect(await collateralToken.balanceOf(reserve.address)).to.equal(initialReserveBalance + initialReserveFees);
        });

        it("Should prevent trading after closing time", async function() {
            const pool = await betMarket.pools(POOL_ID);
            await time.increaseTo(pool.closingTime + 1n);

            await expect(betMarket.connect(user1).buyYes(POOL_ID, 1, ethers.ZeroAddress))
                .to.be.revertedWith("Trading has closed");
        });
    });
});

// Mock Contracts for testing
const MockDtnResolverSource = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
interface IDtnResolver {
    function requestResolve(string calldata poolInfo, address callbackTarget) external;
    function onPoolResolve(uint256 poolId, uint8 outcome) external;
}
contract MockDtnResolver {
    event ResolutionRequested(string poolInfo, address callbackTarget);
    function requestResolve(string calldata poolInfo, address callbackTarget) external {
        emit ResolutionRequested(poolInfo, callbackTarget);
    }
    function callBack(address target, uint256 poolId, uint8 outcome) external {
        IDtnResolver(target).onPoolResolve(poolId, outcome);
    }
}`;

const MockTokenSource = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol, uint256 initialSupply) ERC20(name, symbol) {
        _mint(msg.sender, initialSupply);
    }
}`;

// This is a workaround to make Hardhat compile the mock contracts defined as strings.
// In a real project, these would be in their own .sol files.
(async () => {
    if (typeof hre !== 'undefined') {
        await hre.artifacts.addArtifact({
            _format: "hh-sol-artifact-1",
            contractName: "MockDtnResolver",
            sourceName: "contracts/mocks/MockDtnResolver.sol",
            abi: (await hre.ethers.getContractFactory(new hre.ethers.Interface(MockDtnResolverSource))).interface.fragments,
            bytecode: (await hre.ethers.getContractFactory(new hre.ethers.Interface(MockDtnResolverSource))).bytecode,
        });
        await hre.artifacts.addArtifact({
            _format: "hh-sol-artifact-1",
            contractName: "MockToken",
            sourceName: "contracts/mocks/MockToken.sol",
            abi: (await hre.ethers.getContractFactory(new hre.ethers.Interface(MockTokenSource), (await hre.ethers.getSigners())[0])).interface.fragments,
            bytecode: (await hre.ethers.getContractFactory(new hre.ethers.Interface(MockTokenSource), (await hre.ethers.getSigners())[0])).bytecode,
        });
    }
})();
