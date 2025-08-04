// This setup uses Hardhat Ignition to manage smart contract deployments.
// Learn more about it at https://hardhat.org/ignition

const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");

module.exports = buildModule("BetResolverConfigModule", (m) => {
  // Get the deployed contracts from previous modules
  const { betResolver } = m.useModule("./BetResolver");
  const { betMarket } = m.useModule("./BetMarket");

  // Configuration parameters for BetResolver
  const dtnAi = m.getParameter("dtnAi", "0x0000000000000000000000000000000000000000"); // DtnAI contract address
  const systemPrompt = m.getParameter("systemPrompt", "You are a prediction market oracle. Respond with exactly 'true', 'false', or 'inconclusive' based on the given question.");
  const modelName = m.getParameter("modelName", "model.system.openai-gpt-o3-simpletext");
  const nodeName = m.getParameter("nodeName", "node.tester.node1");

  // Configure BetResolver
  const configureCall = m.call(betResolver, "configure", [
    betMarket,
    dtnAi,
    systemPrompt,
    modelName,
    nodeName
  ]);

  // Set fees (optional - using default values from contract)
  const feePerByteReq = m.getParameter("feePerByteReq", 1000000000000000n); // 0.001 * 1e18
  const feePerByteRes = m.getParameter("feePerByteRes", 1000000000000000n); // 0.001 * 1e18
  const totalFeePerRes = m.getParameter("totalFeePerRes", 1000000000000000000n); // 1 * 1e18
  const resolutionGasLimit = m.getParameter("resolutionGasLimit", 400000);

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