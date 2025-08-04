// This setup uses Hardhat Ignition to manage smart contract deployments with CREATE2 policy.
// Learn more about it at https://hardhat.org/ignition

const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");

module.exports = buildModule("BetMarketModule", (m) => {
  // Get the deployed BetResolver from the previous module
  const { betResolver } = m.useModule("./BetResolver");

  // Configuration parameters
  const collateralToken = m.getParameter("collateralToken", "0x0000000000000000000000000000000000000000"); // USDC address (placeholder)
  const reserveAddress = m.getParameter("reserveAddress", "0x0000000000000000000000000000000000000000"); // Reserve address for fees

  // Salt for CREATE2 deployment (different from BetResolver)
  const salt = m.getParameter("betMarketSalt", "0x0000000000000000000000000000000000000000000000000000000000000002");

  // Deploy BetMarket with CREATE2 policy (Ignition handles CreateX automatically)
  const betMarket = m.contract("BetMarket", [
    collateralToken,
    betResolver,
    reserveAddress
  ], {
    salt: salt,
    policy: "CREATE2"
  });

  return { betMarket };
}); 