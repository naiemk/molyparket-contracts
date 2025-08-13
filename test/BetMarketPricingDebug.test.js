const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("BetMarket Pricing Debug Test", function () {
    let betMarket, collateralToken;
    let deployer, user1, reserve;

    beforeEach(async function () {
        // Get signers
        [deployer, user1, reserve] = await ethers.getSigners();

        // Deploy Mock ERC20 Token for collateral (6 decimals like USDC)
        const MockToken = await ethers.getContractFactory("MockToken");
        collateralToken = await MockToken.deploy("Mock USD", "mUSD", ethers.parseUnits("1000000", 6));

        // Deploy BetMarket with just the owner
        const BetMarket = await ethers.getContractFactory("BetMarket");
        betMarket = await BetMarket.deploy(deployer.address);

        // Deploy a simple mock resolver
        const MockResolver = await ethers.getContractFactory("MockDtnResolver");
        const mockResolver = await MockResolver.deploy();

        // Configure BetMarket
        await betMarket.configure(
            await collateralToken.getAddress(),
            await mockResolver.getAddress(),
            reserve.address
        );

        // Grant allowance to the BetMarket contract
        await collateralToken.connect(deployer).approve(await betMarket.getAddress(), ethers.MaxUint256);
    });

    describe("Debug Pricing Calculations", function () {
        it("Should debug the cost calculation step by step", async function () {
            // Create a bet with $20 initial liquidity
            const currentTime = await time.latest();
            await betMarket.connect(deployer).createBet(
                "Debug Test",
                "Debug question",
                ethers.parseUnits("20", 6),
                currentTime + 86400,
                currentTime + 172800,
                "", "", ""
            );
            
            const poolId = 1;
            const pool = await betMarket.pools(poolId);
            
            console.log("\n=== Pool State ===");
            console.log("b parameter:", ethers.formatUnits(pool.b, 6));
            console.log("nYes (fixed point):", ethers.formatUnits(pool.nYes, 6));
            console.log("nNo (fixed point):", ethers.formatUnits(pool.nNo, 6));
            console.log("totalSupplyYes:", ethers.formatUnits(pool.totalSupplyYes, 6));
            console.log("totalSupplyNo:", ethers.formatUnits(pool.totalSupplyNo, 6));
            
            // Test with a very small amount to see what happens
            const testAmount = ethers.parseUnits("0.001", 6); // 0.001 tokens
            
            console.log("\n=== Testing with 0.001 tokens ===");
            try {
                const costFor0_001Yes = await betMarket.costToBuyYes(poolId, testAmount);
                console.log("Cost to buy 0.001 YES:", ethers.formatUnits(costFor0_001Yes, 6));
            } catch (error) {
                console.log("Error getting cost for 0.001 YES:", error.message);
            }
            
            try {
                const costFor0_001No = await betMarket.costToBuyNo(poolId, testAmount);
                console.log("Cost to buy 0.001 NO:", ethers.formatUnits(costFor0_001No, 6));
            } catch (error) {
                console.log("Error getting cost for 0.001 NO:", error.message);
            }
            
            // Test with 1 token
            console.log("\n=== Testing with 1 token ===");
            const oneToken = ethers.parseUnits("1", 6);
            
            try {
                const costFor1Yes = await betMarket.costToBuyYes(poolId, oneToken);
                console.log("Cost to buy 1 YES:", ethers.formatUnits(costFor1Yes, 6));
            } catch (error) {
                console.log("Error getting cost for 1 YES:", error.message);
            }
            
            try {
                const costFor1No = await betMarket.costToBuyNo(poolId, oneToken);
                console.log("Cost to buy 1 NO:", ethers.formatUnits(costFor1No, 6));
            } catch (error) {
                console.log("Error getting cost for 1 NO:", error.message);
            }
            
            // Test with 10 tokens
            console.log("\n=== Testing with 10 tokens ===");
            const tenTokens = ethers.parseUnits("10", 6);
            
            try {
                const costFor10Yes = await betMarket.costToBuyYes(poolId, tenTokens);
                console.log("Cost to buy 10 YES:", ethers.formatUnits(costFor10Yes, 6));
            } catch (error) {
                console.log("Error getting cost for 10 YES:", error.message);
            }
            
            try {
                const costFor10No = await betMarket.costToBuyNo(poolId, tenTokens);
                console.log("Cost to buy 10 NO:", ethers.formatUnits(costFor10No, 6));
            } catch (error) {
                console.log("Error getting cost for 10 NO:", error.message);
            }
        });

        it("Should test different initial liquidity amounts", async function () {
            // Test with $100 initial liquidity (b = 5)
            const currentTime = await time.latest();
            await betMarket.connect(deployer).createBet(
                "Debug Test $100",
                "Debug question with $100",
                ethers.parseUnits("100", 6),
                currentTime + 86400,
                currentTime + 172800,
                "", "", ""
            );
            
            const poolId = 2;
            const pool = await betMarket.pools(poolId);
            
            console.log("\n=== $100 Pool State ===");
            console.log("b parameter:", ethers.formatUnits(pool.b, 6));
            console.log("totalSupplyYes:", ethers.formatUnits(pool.totalSupplyYes, 6));
            console.log("totalSupplyNo:", ethers.formatUnits(pool.totalSupplyNo, 6));
            
            // Test cost calculation
            const oneToken = ethers.parseUnits("1", 6);
            try {
                const costFor1Yes = await betMarket.costToBuyYes(poolId, oneToken);
                console.log("Cost to buy 1 YES in $100 pool:", ethers.formatUnits(costFor1Yes, 6));
            } catch (error) {
                console.log("Error:", error.message);
            }
        });

        it("Should check the current state and debug the issue", async function () {
            // Create a bet with $20 initial liquidity
            const currentTime = await time.latest();
            await betMarket.connect(deployer).createBet(
                "Debug Test",
                "Debug question",
                ethers.parseUnits("20", 6),
                currentTime + 86400,
                currentTime + 172800,
                "", "", ""
            );
            
            const poolId = 1;
            const pool = await betMarket.pools(poolId);
            
            console.log("\n=== Current Pool State ===");
            console.log("b parameter (raw):", pool.b.toString());
            console.log("b parameter (formatted):", ethers.formatUnits(pool.b, 6));
            console.log("nYes (raw):", pool.nYes.toString());
            console.log("nYes (formatted):", ethers.formatUnits(pool.nYes, 6));
            console.log("nNo (raw):", pool.nNo.toString());
            console.log("nNo (formatted):", ethers.formatUnits(pool.nNo, 6));
            
            // Calculate the ratios that will be used in exp()
            const bValue = Number(ethers.formatUnits(pool.b, 6));
            const nYesValue = Number(ethers.formatUnits(pool.nYes, 6));
            const nNoValue = Number(ethers.formatUnits(pool.nNo, 6));
            
            console.log("\n=== Calculated Ratios ===");
            console.log("nYes / b =", nYesValue, "/", bValue, "=", nYesValue / bValue);
            console.log("nNo / b =", nNoValue, "/", bValue, "=", nNoValue / bValue);
            
            // Test with a very small amount
            const testAmount = ethers.parseUnits("0.001", 6);
            console.log("\n=== Testing with 0.001 tokens ===");
            console.log("Test amount:", ethers.formatUnits(testAmount, 6));
            
            try {
                const costFor0_001Yes = await betMarket.costToBuyYes(poolId, testAmount);
                console.log("Cost to buy 0.001 YES:", ethers.formatUnits(costFor0_001Yes, 6));
            } catch (error) {
                console.log("Error getting cost for 0.001 YES:", error.message);
            }
        });
    });
});
