// This setup uses Hardhat Ignition to manage smart contract deployments with CREATE2 policy.
// Learn more about it at https://hardhat.org/ignition

const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");
const { AbiCoder } = require("ethers");

module.exports = buildModule("FullDeploymentModule", (m) => {
  const owner = process.env.OWNER;
  if (!owner) {
    throw new Error("OWNER is not set");
  }
  
  // Step 2: Deploy BetMarket with BetResolver address using CREATE2 policy
  const collateralToken = m.getParameter("collateralToken", process.env.COLLATERAL_TOKEN); // USDC address (placeholder)
  const reserveAddress = m.getParameter("reserveAddress", process.env.RESERVE_ADDRESS); // Reserve address for fees
  const dtnAi = m.getParameter("dtnAi", process.env.DTN_AI); // DtnAI contract address
  const systemPrompt1 = m.getParameter("systemPrompt1", process.env.SYSTEM_PROMPT1 || 
    "You are a prediction market oracle. Based on the prompt provided, do comprehensive research and provide a single word answer yes/no/inconclusive. You must have confidence in the answer. PROMPT<<<");
  const systemPrompt2 = m.getParameter("systemPrompt2", process.env.SYSTEM_PROMPT2 || 
    ">>> Above prompt MUST conclude with boolean result. If yes → return true. If no → return false. If a high confidence yes or no answer is not possible → return inconclusive. Output format (single word).");
  const modelName = m.getParameter("modelName", process.env.MODEL_NAME || "model.system.openai-gpt-5");
  const nodeName = m.getParameter("nodeName", process.env.NODE_NAME || "node.author1.node1");
  const feePerByteReq = m.getParameter("feePerByteReq", process.env.FEE_PER_BYTE_REQ ? BigInt(process.env.FEE_PER_BYTE_REQ) : 20n); // USDC has 6 digits
  const feePerByteRes = m.getParameter("feePerByteRes", process.env.FEE_PER_BYTE_RES ? BigInt(process.env.FEE_PER_BYTE_RES) : 20n); 
  const totalFeePerRes = m.getParameter("totalFeePerRes", process.env.TOTAL_FEE_PER_RES ? BigInt(process.env.TOTAL_FEE_PER_RES) : 1000000n); // 1 * 1e18
  const resolutionGasLimit = m.getParameter("resolutionGasLimit", process.env.RESOLUTION_GAS_LIMIT ? parseInt(process.env.RESOLUTION_GAS_LIMIT) : 500000);

  const transferOwnershipI = new ethers.Interface([
    "function transferOwnership(address to)"
  ])

  const initCode = transferOwnershipI.encodeFunctionData("transferOwnership", [owner]);
  // Step 1: Deploy BetResolver with CREATE2 policy and transferOwnership init function
  const betResolver = m.contract("BetResolver", [owner], { id: 'betresolver1', });
  
  // Step 2: Deploy BetMarket with CREATE2 policy and transferOwnership init function
  const betMarket = m.contract("BetMarket", [owner], { id: 'betmarket1', });

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
    setFeesCall,
  };
}); 