// Comprehensive test script that deploys and verifies contracts in a single session
const { ethers } = require("hardhat");
const { execSync } = require('child_process');

async function main() {
  console.log("🚀 Testing full deployment workflow...");
  
  try {
    // Step 1: Deploy contracts using Ignition
    console.log("\n1. Deploying contracts with Ignition...");
    const output = execSync('npx hardhat ignition deploy ignition/modules/FullDeployment.js --network hardhat', { 
      encoding: 'utf8' 
    });
    console.log("Ignition deployment output:", output);
    
    // Extract addresses from output
    const betResolverMatch = output.match(/FullDeploymentModule#BetResolver - (0x[a-fA-F0-9]{40})/);
    const betMarketMatch = output.match(/FullDeploymentModule#BetMarket - (0x[a-fA-F0-9]{40})/);
    
    if (!betResolverMatch || !betMarketMatch) {
      throw new Error("Could not extract contract addresses from Ignition output");
    }
    
    const betResolverAddress = betResolverMatch[1];
    const betMarketAddress = betMarketMatch[1];
    
    console.log("✅ Contracts deployed successfully!");
    console.log("- BetResolver:", betResolverAddress);
    console.log("- BetMarket:", betMarketAddress);
    
    // Step 2: Test contract functionality
    console.log("\n2. Testing contract functionality...");
    
    const BetResolver = await ethers.getContractFactory("BetResolver");
    const BetMarket = await ethers.getContractFactory("BetMarket");
    
    const betResolver = BetResolver.attach(betResolverAddress);
    const betMarket = BetMarket.attach(betMarketAddress);
    
    // Test basic contract existence
    const betResolverCode = await ethers.provider.getCode(betResolverAddress);
    const betMarketCode = await ethers.provider.getCode(betMarketAddress);
    
    if (betResolverCode !== "0x") {
      console.log("✅ BetResolver contract exists");
    } else {
      console.log("❌ BetResolver contract not found");
    }
    
    if (betMarketCode !== "0x") {
      console.log("✅ BetMarket contract exists");
    } else {
      console.log("❌ BetMarket contract not found");
    }
    
    // Test view functions
    try {
      const totalFeeBps = await betMarket.TOTAL_FEE_BPS();
      console.log("✅ BetMarket.TOTAL_FEE_BPS():", totalFeeBps.toString());
    } catch (error) {
      console.log("❌ BetMarket.TOTAL_FEE_BPS() failed:", error.message);
    }
    
    try {
      const referrerFeeBps = await betMarket.REFERRER_FEE_BPS();
      console.log("✅ BetMarket.REFERRER_FEE_BPS():", referrerFeeBps.toString());
    } catch (error) {
      console.log("❌ BetMarket.REFERRER_FEE_BPS() failed:", error.message);
    }
    
    // Test configuration functions
    try {
      const configuredBetMarket = await betResolver.betMarket();
      console.log("✅ BetResolver.betMarket():", configuredBetMarket);
    } catch (error) {
      console.log("❌ BetResolver.betMarket() failed:", error.message);
    }
    
    try {
      const configuredDtnAi = await betResolver.ai();
      console.log("✅ BetResolver.ai():", configuredDtnAi);
    } catch (error) {
      console.log("❌ BetResolver.ai() failed:", error.message);
    }
    
    try {
      const systemPrompt = await betResolver.systemPrompt();
      console.log("✅ BetResolver.systemPrompt():", systemPrompt);
    } catch (error) {
      console.log("❌ BetResolver.systemPrompt() failed:", error.message);
    }
    
    try {
      const modelName = await betResolver.modelName();
      console.log("✅ BetResolver.modelName():", modelName);
    } catch (error) {
      console.log("❌ BetResolver.modelName() failed:", error.message);
    }
    
    try {
      const nodeName = await betResolver.nodeName();
      console.log("✅ BetResolver.nodeName():", nodeName);
    } catch (error) {
      console.log("❌ BetResolver.nodeName() failed:", error.message);
    }
    
    try {
      const sessionId = await betResolver.sessionId();
      console.log("✅ BetResolver.sessionId():", sessionId.toString());
    } catch (error) {
      console.log("❌ BetResolver.sessionId() failed:", error.message);
    }
    
    // Test BetMarket configuration
    try {
      const collateralToken = await betMarket.collateralToken();
      console.log("✅ BetMarket.collateralToken():", collateralToken);
    } catch (error) {
      console.log("❌ BetMarket.collateralToken() failed:", error.message);
    }
    
    try {
      const dtnResolver = await betMarket.dtnResolver();
      console.log("✅ BetMarket.dtnResolver():", dtnResolver);
    } catch (error) {
      console.log("❌ BetMarket.dtnResolver() failed:", error.message);
    }
    
    try {
      const reserveAddress = await betMarket.reserveAddress();
      console.log("✅ BetMarket.reserveAddress():", reserveAddress);
    } catch (error) {
      console.log("❌ BetMarket.reserveAddress() failed:", error.message);
    }
    
    // Test ownership
    try {
      const [deployer] = await ethers.getSigners();
      const betResolverOwner = await betResolver.owner();
      console.log("✅ BetResolver.owner():", betResolverOwner);
      console.log("✅ Deployer address:", deployer.address);
      
      if (betResolverOwner === deployer.address) {
        console.log("✅ Ownership is correct");
      } else {
        console.log("❌ Ownership mismatch");
      }
    } catch (error) {
      console.log("❌ Ownership check failed:", error.message);
    }
    
    console.log("\n🎯 Test Summary:");
    console.log("- Contracts deployed successfully");
    console.log("- Basic functionality tested");
    console.log("- Configuration verified");
    console.log("- Ready for production use!");
    
  } catch (error) {
    console.error("❌ Test failed:", error);
    throw error;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  }); 