// Simple test script to verify contract deployment
const { ethers } = require("hardhat");

async function main() {
  console.log("Testing contract deployment...");
  
  // Test if we can get contract factories
  try {
    const BetResolver = await ethers.getContractFactory("BetResolver");
    const BetMarket = await ethers.getContractFactory("BetMarket");
    console.log("✅ Contract factories loaded successfully");
    
    // Test if we can create contract instances
    const betResolverAddress = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
    const betMarketAddress = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
    
    const betResolver = BetResolver.attach(betResolverAddress);
    const betMarket = BetMarket.attach(betMarketAddress);
    console.log("✅ Contract instances created successfully");
    
    // Test basic contract calls
    try {
      const code = await ethers.provider.getCode(betResolverAddress);
      if (code !== "0x") {
        console.log("✅ BetResolver contract exists at address");
      } else {
        console.log("❌ BetResolver contract not found at address");
      }
    } catch (error) {
      console.log("❌ Error checking BetResolver:", error.message);
    }
    
    try {
      const code = await ethers.provider.getCode(betMarketAddress);
      if (code !== "0x") {
        console.log("✅ BetMarket contract exists at address");
      } else {
        console.log("❌ BetMarket contract not found at address");
      }
    } catch (error) {
      console.log("❌ Error checking BetMarket:", error.message);
    }
    
    // Test if we can call view functions
    try {
      const totalFeeBps = await betMarket.TOTAL_FEE_BPS();
      console.log("✅ BetMarket.TOTAL_FEE_BPS() works:", totalFeeBps.toString());
    } catch (error) {
      console.log("❌ BetMarket.TOTAL_FEE_BPS() failed:", error.message);
    }
    
    try {
      const referrerFeeBps = await betMarket.REFERRER_FEE_BPS();
      console.log("✅ BetMarket.REFERRER_FEE_BPS() works:", referrerFeeBps.toString());
    } catch (error) {
      console.log("❌ BetMarket.REFERRER_FEE_BPS() failed:", error.message);
    }
    
  } catch (error) {
    console.log("❌ Error loading contracts:", error.message);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  }); 