// This setup uses Hardhat Ignition to manage smart contract deployments with CREATE2 policy.
// Learn more about it at https://hardhat.org/ignition

const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");

module.exports = buildModule("FullDeploymentModule", (m) => {
  const owner = m.getAccount(0);
  // Step 2: Deploy BetMarket with BetResolver address using CREATE2 policy
  const collateralToken = m.getParameter("collateralToken", process.env.COLLATERAL_TOKEN || "0x0000000000000000000000000000000000000000"); // USDC address (placeholder)
  const reserveAddress = m.getParameter("reserveAddress", process.env.RESERVE_ADDRESS || "0x0000000000000000000000000000000000000000"); // Reserve address for fees
  const dtnAi = m.getParameter("dtnAi", process.env.DTN_AI || "0x0000000000000000000000000000000000000000"); // DtnAI contract address
  const systemPrompt1 = m.getParameter("systemPrompt1", process.env.SYSTEM_PROMPT1 || 
    "You are a prediction market oracle. Based on the prompt provided, do comprehensive research and provide a single word answer yes/no/inconclusive. You must have confidence in the answer. PROMPT<<<");
  const systemPrompt2 = m.getParameter("systemPrompt2", process.env.SYSTEM_PROMPT2 || 
    ">>> Above prompt MUST conclude with boolean result. If yes → return true. If no → return false. If a high confidence yes or no answer is not possible → return inconclusive. Output format (single word).");
  const modelName = m.getParameter("modelName", process.env.MODEL_NAME || "model.system.openai-gpt-o3-simpletext");
  const nodeName = m.getParameter("nodeName", process.env.NODE_NAME || "node.tester.node1");
  const feePerByteReq = m.getParameter("feePerByteReq", process.env.FEE_PER_BYTE_REQ ? BigInt(process.env.FEE_PER_BYTE_REQ) : 1000000000000000n); // 0.001 * 1e18
  const feePerByteRes = m.getParameter("feePerByteRes", process.env.FEE_PER_BYTE_RES ? BigInt(process.env.FEE_PER_BYTE_RES) : 1000000000000000n); // 0.001 * 1e18
  const totalFeePerRes = m.getParameter("totalFeePerRes", process.env.TOTAL_FEE_PER_RES ? BigInt(process.env.TOTAL_FEE_PER_RES) : 1000000000000000000n); // 1 * 1e18
  const resolutionGasLimit = m.getParameter("resolutionGasLimit", process.env.RESOLUTION_GAS_LIMIT ? parseInt(process.env.RESOLUTION_GAS_LIMIT) : 400000);

  // Step 1: Deploy BetResolver with CREATE2 policy (Ignition handles CreateX automatically)
  const betResolver = m.contract("BetResolver", [owner], { });
  // const betMarket = m.contract("BetMarket", [owner], { });
  const betMarket = m.contractAt("BetMarket", "0x705C938bcCD3e3B6f287c4b206b3f465b93Add28", { id: 'betmarket2'});


  m.call(betResolver, "configure", [betMarket, dtnAi, systemPrompt1, systemPrompt2, modelName, nodeName]);
  m.call(betMarket, "configure", [collateralToken, betResolver, reserveAddress]);

  // Step 4: Set fees for BetResolver (optional - using default values from contract)
  const setFeesCall = m.call(betResolver, "setFees", [
    feePerByteReq,
    feePerByteRes,
    totalFeePerRes,
    resolutionGasLimit
  ]);

  return { 
    betResolver, 
    betMarket, 
  };
}); 