// This setup uses Hardhat Ignition to manage smart contract deployments with CREATE2 policy.
// Learn more about it at https://hardhat.org/ignition

const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");

module.exports = buildModule("BetResolverModule", (m) => {
  // Get the owner account
  const owner = m.getAccount(0);
  
  // Salt for CREATE2 deployment (can be customized)
  const salt = m.getParameter("salt", "0x0000000000000000000000000000000000000000000000000000000000000001");
  
  // Deploy BetResolver with CREATE2 policy and transferOwnership init function
  const betResolver = m.contract("BetResolver", [owner], {
    salt: salt,
  });

  return { betResolver };
}); 