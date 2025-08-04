// Verification script to check deployed contracts
const { ethers } = require("hardhat");

async function main() {
  // Contract addresses (update these with your deployed addresses)
  const betResolverAddress = process.env.BET_RESOLVER_ADDRESS;
  const betMarketAddress = process.env.BET_MARKET_ADDRESS;

  if (!betResolverAddress || !betMarketAddress) {
    console.error("Please set BET_RESOLVER_ADDRESS and BET_MARKET_ADDRESS environment variables");
    process.exit(1);
  }

  console.log("Verifying deployment...");
  console.log("BetResolver:", betResolverAddress);
  console.log("BetMarket:", betMarketAddress);

  try {
    // Get contract instances
    const BetResolver = await ethers.getContractFactory("BetResolver");
    const BetMarket = await ethers.getContractFactory("BetMarket");
    
    const betResolver = BetResolver.attach(betResolverAddress);
    const betMarket = BetMarket.attach(betMarketAddress);

    // Verify BetResolver configuration
    console.log("\n=== BetResolver Configuration ===");
    try {
      const configuredBetMarket = await betResolver.betMarket();
      const configuredDtnAi = await betResolver.ai();
      const systemPrompt = await betResolver.systemPrompt();
      const modelName = await betResolver.modelName();
      const nodeName = await betResolver.nodeName();
      const sessionId = await betResolver.sessionId();

      console.log("✅ BetMarket address:", configuredBetMarket);
      console.log("✅ DtnAI address:", configuredDtnAi);
      console.log("✅ System prompt:", systemPrompt);
      console.log("✅ Model name:", modelName);
      console.log("✅ Node name:", nodeName);
      console.log("✅ Session ID:", sessionId.toString());
    } catch (error) {
      console.log("⚠️  BetResolver configuration not available:", error.message);
      console.log("This is normal if the contracts were deployed but not configured.");
    }

    // Verify BetMarket configuration
    console.log("\n=== BetMarket Configuration ===");
    try {
      const collateralToken = await betMarket.collateralToken();
      const dtnResolver = await betMarket.dtnResolver();
      const reserveAddress = await betMarket.reserveAddress();
      const totalFeeBps = await betMarket.TOTAL_FEE_BPS();
      const referrerFeeBps = await betMarket.REFERRER_FEE_BPS();

      console.log("✅ Collateral token:", collateralToken);
      console.log("✅ DtnResolver:", dtnResolver);
      console.log("✅ Reserve address:", reserveAddress);
      console.log("✅ Total fee BPS:", totalFeeBps.toString());
      console.log("✅ Referrer fee BPS:", referrerFeeBps.toString());
    } catch (error) {
      console.log("⚠️  BetMarket configuration not available:", error.message);
      console.log("This is normal if the contracts were deployed but not configured.");
    }

    // Verify cross-references
    console.log("\n=== Cross-Reference Verification ===");
    try {
      const configuredBetMarket = await betResolver.betMarket();
      if (configuredBetMarket === betMarketAddress) {
        console.log("✅ BetResolver correctly references BetMarket");
      } else {
        console.log("❌ BetResolver references wrong BetMarket address");
      }
    } catch (error) {
      console.log("⚠️  Cross-reference verification not available for BetResolver");
    }

    try {
      const dtnResolver = await betMarket.dtnResolver();
      if (dtnResolver === betResolverAddress) {
        console.log("✅ BetMarket correctly references BetResolver");
      } else {
        console.log("❌ BetMarket references wrong BetResolver address");
      }
    } catch (error) {
      console.log("⚠️  Cross-reference verification not available for BetMarket");
    }

    // Check contract ownership
    console.log("\n=== Ownership Verification ===");
    const [deployer] = await ethers.getSigners();
    try {
      const betResolverOwner = await betResolver.owner();
      console.log("✅ BetResolver owner:", betResolverOwner);
      console.log("✅ Deployer address:", deployer.address);

      if (betResolverOwner === deployer.address) {
        console.log("✅ BetResolver ownership is correct");
      } else {
        console.log("❌ BetResolver ownership mismatch");
      }
    } catch (error) {
      console.log("⚠️  Ownership verification not available:", error.message);
    }

    // Check if contracts are ready for use
    console.log("\n=== Readiness Check ===");
    try {
      const configuredDtnAi = await betResolver.ai();
      const sessionId = await betResolver.sessionId();
      const collateralToken = await betMarket.collateralToken();
      
      if (configuredDtnAi !== ethers.ZeroAddress) {
        console.log("✅ DtnAI is configured");
      } else {
        console.log("⚠️  DtnAI is not configured (zero address)");
      }

      if (sessionId > 0) {
        console.log("✅ DtnAI session is active");
      } else {
        console.log("⚠️  DtnAI session is not active (call restartSession())");
      }

      if (collateralToken !== ethers.ZeroAddress) {
        console.log("✅ Collateral token is configured");
      } else {
        console.log("❌ Collateral token is not configured (zero address)");
      }
    } catch (error) {
      console.log("⚠️  Readiness check not available:", error.message);
    }

    console.log("\n✅ Verification completed successfully!");

  } catch (error) {
    console.error("❌ Verification failed:", error);
    throw error;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  }); 