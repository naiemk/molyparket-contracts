// This setup uses Hardhat Ignition to manage smart contract deployments with CREATE2 policy.
// Learn more about it at https://hardhat.org/ignition

const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");

module.exports = buildModule("FullDeploymentModule", (m) => {
  // Salts for CREATE2 deployment (can be customized)
  const betResolverSalt = m.getParameter("betResolverSalt", process.env.BET_RESOLVER_SALT || "0x0000000000000000000000000000000000000000000000000000000000000001");
  const betMarketSalt = m.getParameter("betMarketSalt", process.env.BET_MARKET_SALT || "0x0000000000000000000000000000000000000000000000000000000000000002");

  // Step 1: Deploy BetResolver with CREATE2 policy (Ignition handles CreateX automatically)
  const betResolver = m.contract("BetResolver", [], {
    salt: betResolverSalt,
    policy: "CREATE2"
  });

  // Step 2: Deploy BetMarket with BetResolver address using CREATE2 policy
  const collateralToken = m.getParameter("collateralToken", process.env.COLLATERAL_TOKEN || "0x0000000000000000000000000000000000000000"); // USDC address (placeholder)
  const reserveAddress = m.getParameter("reserveAddress", process.env.RESERVE_ADDRESS || "0x0000000000000000000000000000000000000000"); // Reserve address for fees

  const betMarket = m.contract("BetMarket", [
    collateralToken,
    betResolver,
    reserveAddress
  ], {
    salt: betMarketSalt,
    policy: "CREATE2"
  });

  // Step 3: Configure BetResolver with BetMarket address and other parameters
  const dtnAi = m.getParameter("dtnAi", process.env.DTN_AI || "0x0000000000000000000000000000000000000000"); // DtnAI contract address
  const systemPrompt = m.getParameter("systemPrompt", process.env.SYSTEM_PROMPT || "You are a prediction market oracle. Respond with exactly 'true', 'false', or 'inconclusive' based on the given question.");
  const modelName = m.getParameter("modelName", process.env.MODEL_NAME || "model.system.openai-gpt-o3-simpletext");
  const nodeName = m.getParameter("nodeName", process.env.NODE_NAME || "node.tester.node1");

  const configureCall = m.call(betResolver, "configure", [
    betMarket,
    dtnAi,
    systemPrompt,
    modelName,
    nodeName
  ]);

  // Step 4: Set fees for BetResolver (optional - using default values from contract)
  const feePerByteReq = m.getParameter("feePerByteReq", process.env.FEE_PER_BYTE_REQ ? BigInt(process.env.FEE_PER_BYTE_REQ) : 1000000000000000n); // 0.001 * 1e18
  const feePerByteRes = m.getParameter("feePerByteRes", process.env.FEE_PER_BYTE_RES ? BigInt(process.env.FEE_PER_BYTE_RES) : 1000000000000000n); // 0.001 * 1e18
  const totalFeePerRes = m.getParameter("totalFeePerRes", process.env.TOTAL_FEE_PER_RES ? BigInt(process.env.TOTAL_FEE_PER_RES) : 1000000000000000000n); // 1 * 1e18
  const resolutionGasLimit = m.getParameter("resolutionGasLimit", process.env.RESOLUTION_GAS_LIMIT ? parseInt(process.env.RESOLUTION_GAS_LIMIT) : 400000);

  const setFeesCall = m.call(betResolver, "setFees", [
    feePerByteReq,
    feePerByteRes,
    totalFeePerRes,
    resolutionGasLimit
  ]);

  return { 
    betResolver, 
    betMarket, 
    configureCall, 
    setFeesCall 
  };
}); 