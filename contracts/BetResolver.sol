// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "@deeptrust/contracts/idtn-ai.sol";
import "@deeptrust/contracts/dtn-defaults.sol";
import "@deeptrust/contracts/with-dtn-ai.sol";

import "./IBetResolver.sol";

/**
 * @title BetResolver (custom-nodes-only routing)
 * @notice Resolves bets via DtnAI. The target model must return exactly "true" | "false" | "inconclusive".
 * @dev
 *  - Uses OpenZeppelin Ownable, ReentrancyGuard, SafeERC20.
 *  - Uses ONLY DtnDefaults.defaultCustomNodesValidatedAny(nodes) for routing.
 *  - Exposes restartSession() that forwards this contract's fee-token balance to DtnAI feeTarget and opens a session.
 *  - Resolution result is stored on-chain; does not handle escrow/payouts.
 */
contract BetResolver is WithDtnAi, Ownable, IBetResolver {
    using SafeERC20 for IERC20;

    // ----- Bet model -----

    struct Bet {
        bytes32 requestId;
        Outcome outcome;
        bytes4 onResolve;
        string aiRawResult;       // raw model return ("true"|"false"|"inconclusive")
        string aiError;
    }

    // ----- Storage -----
    address public betMarket;
    mapping(uint256 => Bet) public bets;
    mapping(bytes32 => uint256) public requestToBet;

    // DtnAI session management
    uint256 public sessionId;

    // Inference configuration
    string public systemPrompt; // wrapper line 0 for each resolve call
    string public modelName;    // e.g., "model.system.openai-gpt-o3-simpletext"
    string public nodeName;     // REQUIRED: e.g., "node.tester.node1"

    // Fees (feeToken decimals)
    uint256 public feePerByteReq = 1_000_000_000_000_000;          // 0.001 * 1e18
    uint256 public feePerByteRes = 1_000_000_000_000_000;          // 0.001 * 1e18
    uint256 public totalFeePerRes = 1_000_000_000_000_000_000;     // 1 * 1e18
    uint256 public resolutionGasLimit = 400_000;

    // ----- Events -----
    event ResolveRequested(uint256 indexed betId, bytes32 indexed requestId);
    event BetResolved(uint256 indexed betId, Outcome outcome, string rawResult);
    event BetResolutionFailed(uint256 indexed betId, bytes32 indexed requestId, string message);
    event BetResolutionCallbackFailed(uint256 indexed betId, bytes32 indexed requestId, bytes data);
    event SessionRestarted(uint256 sessionId, uint256 fundedAmount);
    event ConfigUpdated(address dtnAi, string systemPrompt, string modelName, string nodeName);
    event FeesUpdated(uint256 feePerByteReq, uint256 feePerByteRes, uint256 totalFeePerRes, uint256 resolutionGasLimit);

    constructor(
    ) Ownable(msg.sender) {
    }

    function configure(
        address _betMarket,
        address _dtnAi,
        string memory _systemPrompt,
        string memory _modelName,
        string memory _nodeName
    ) external onlyOwner {
        setAi(_dtnAi);
        betMarket = _betMarket;
        systemPrompt = _systemPrompt;
        modelName = _modelName;
        nodeName = _nodeName;
        emit ConfigUpdated(_dtnAi, _systemPrompt, _modelName, _nodeName);
    }

    function setFees(uint256 _feePerByteReq, uint256 _feePerByteRes, uint256 _totalFeePerRes, uint256 _resolutionGasLimit) external onlyOwner {
        feePerByteReq = _feePerByteReq;
        feePerByteRes = _feePerByteRes;
        totalFeePerRes = _totalFeePerRes;
        resolutionGasLimit = _resolutionGasLimit;
        emit FeesUpdated(_feePerByteReq, _feePerByteRes, _totalFeePerRes, _resolutionGasLimit);
    }

    /**
     * @notice Starts (or restarts) a DtnAI user session using this contract’s entire fee-token balance.
     * @dev Send the fee token to this contract first; this function forwards the full balance to `feeTarget()`.
     */
    function restartSession() public onlyOwner {
        if (sessionId != 0) {
            ai.closeUserSession(sessionId);
        }

        address tokenAddr = ai.feeToken();
        IERC20 token = IERC20(tokenAddr);
        uint256 amount = token.balanceOf(address(this));
        require(amount > 0, "No fee tokens");

        token.safeTransfer(ai.feeTarget(), amount);
        sessionId = ai.startUserSession();
        emit SessionRestarted(sessionId, amount);
    }

    /**
     * @notice Triggers AI resolution for a bet that has passed its close time.
     * @param betId The bet to resolve.
     * @param betPrompt The prompt for the bet.
     * @param onResolve The callback function to call when the bet is resolved. The function should have the following signature:
     *   onResolve(uint256 betId, Outcome outcome)
     * @dev Send ETH with {value: ...} if the DtnAI deployment requires it for callback gas.
     */
    function resolve(uint256 betId, string memory betPrompt, bytes4 onResolve) external payable {
        require(betId > 0, "invalid betId");
        require(bytes(betPrompt).length > 0, "invalid betPrompt");
        require(onResolve != bytes4(0), "invalid onResolve");
        require(msg.sender == betMarket, "invalid sender");
        require(msg.value >= resolutionGasLimit, "insufficient gas");

        // Build prompt lines: [systemPrompt, question]
        string[3] memory prompt_lines;
        prompt_lines[0] = systemPrompt;
        prompt_lines[1] = betPrompt;
        prompt_lines[2] = systemPrompt;

        // ---- ROUTING: custom nodes only ----
        bytes32[] memory nodes = new bytes32[](1);
        nodes[0] = keccak256(abi.encodePacked(nodeName));
        IDtnAi.DtnRouting memory routing =
            DtnDefaults.defaultCustomNodesValidatedAny(nodes);

        // Build request
        IDtnAi.DtnRequest memory req = IDtnAi.DtnRequest({
            call: abi.encode(prompt_lines),      // text call expects encoded lines
            extraParams: "",                     // not using typed extra params in this resolver
            calltype: IDtnAi.CallType.DIRECT,    // expect direct string response
            feePerByteReq: feePerByteReq,
            feePerByteRes: feePerByteRes,
            totalFeePerRes: totalFeePerRes
        });

        IDtnAi.CallBack memory cb = IDtnAi.CallBack({
            success: this.callbackResolve.selector,
            failure: this.callbackResolveError.selector,
            target: address(this)
        });

        // Resolve model id via registry if available; fallback to keccak(name)
        bytes32 modelId = keccak256(abi.encodePacked(modelName));

        // Submit request
        bytes32 requestId = ai.request{value: msg.value}(
            sessionId,
            modelId,
            routing,
            req,
            cb,
            msg.sender,   // gas refund address
            resolutionGasLimit
        );

        // Update bet state
        requestToBet[requestId] = betId;
        bets[betId] = Bet({
            requestId: requestId,
            outcome: Outcome.Unknown,
            onResolve: onResolve,
            aiRawResult: "",
            aiError: ""
        });

        emit ResolveRequested(betId, requestId);
    }

    // ----- AI Callbacks (guarded by onlyDtn + nonReentrant) -----
    function callbackResolve(bytes32 _requestId) external onlyDtn {
        (, , bytes memory response) = ai.fetchResponse(_requestId);
        // Expect abi-encoded string: "true" | "false" | "inconclusive"
        string memory raw = abi.decode(response, (string));

        Outcome out = _parseOutcome(raw);
        uint256 betId = requestToBet[_requestId];
        Bet storage b = bets[betId];
        bytes4 onResolve = b.onResolve;
        b.outcome = out;
        b.aiRawResult = raw;

        (bool success, bytes memory data) = address(betMarket).call(abi.encodeWithSelector(onResolve, betId, out));
        if (!success) {
            emit BetResolutionCallbackFailed(betId, _requestId, data);
        }
        emit BetResolved(betId, out, raw);
    }

    function callbackResolveError(bytes32 _requestId) external onlyDtn {
        (, string memory message, ) = ai.fetchResponse(_requestId);

        uint256 betId = requestToBet[_requestId];
        Bet storage b = bets[betId];
        b.aiError = message;

        emit BetResolutionFailed(betId, _requestId, message);
    }

    // ----- Pure helpers -----
    // Option 2: compare common casings directly (gas-cheap; no lowercase conversion).
    function _parseOutcome(string memory s) internal pure returns (Outcome) {
        bytes32 h = keccak256(bytes(s));
        if (
            h == keccak256("true")  || h == keccak256("True")  || h == keccak256("TRUE")
        ) return Outcome.True;

        if (
            h == keccak256("false") || h == keccak256("False") || h == keccak256("FALSE")
        ) return Outcome.False;

        return Outcome.Inconclusive;
    }
}
