const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("BetMarket Pricing Algorithm", function () {
    let betMarket, betResolver, mockDtnAi, collateralToken;
    let deployer, user1, user2, reserve;
    let poolId;

    beforeEach(async function () {
        // Get signers
        [deployer, user1, user2, reserve] = await ethers.getSigners();

        // Deploy Mock ERC20 Token for collateral (6 decimals like USDC)
        const MockToken = await ethers.getContractFactory("MockToken");
        collateralToken = await MockToken.deploy("Mock USD", "mUSD", ethers.parseUnits("1000000", 6));

        // Deploy MockDtnAi
        const MockDtnAi = await ethers.getContractFactory("LocalMockDtnAi");
        mockDtnAi = await MockDtnAi.deploy(await collateralToken.getAddress(), deployer.address);

        // Deploy BetResolver
        const BetResolver = await ethers.getContractFactory("BetResolver");
        betResolver = await BetResolver.deploy(deployer.address);

        // Deploy BetMarket
        const BetMarket = await ethers.getContractFactory("BetMarket");
        betMarket = await BetMarket.deploy(deployer.address);

        // Configure BetMarket
        await betMarket.configure(
            await collateralToken.getAddress(),
            await betResolver.getAddress(),
            reserve.address
        );

        // Configure BetResolver
        await betResolver.configure(
            await betMarket.getAddress(),
            await mockDtnAi.getAddress(),
            "You are a prediction market oracle. Respond with exactly 'true', 'false', or 'inconclusive'.",
            "Respond with exactly 'true', 'false', or 'inconclusive'.",
            "model.system.openai-gpt-o3-simpletext",
            "node.tester.node1"
        );

        // Set model ID in MockDtnAi
        const modelName = "model.system.openai-gpt-o3-simpletext";
        const modelId = ethers.keccak256(ethers.toUtf8Bytes(modelName));
        await mockDtnAi.setModelId(modelName, modelId);

        // Fund BetResolver with fee tokens and start session
        await collateralToken.transfer(await betResolver.getAddress(), ethers.parseUnits("100", 6));
        await betResolver.restartSession();

        // Distribute collateral tokens to users
        await collateralToken.transfer(user1.address, ethers.parseUnits("10000", 6));
        await collateralToken.transfer(user2.address, ethers.parseUnits("10000", 6));

        // Grant allowance to the BetMarket contract
        await collateralToken.connect(deployer).approve(await betMarket.getAddress(), ethers.MaxUint256);
        await collateralToken.connect(user1).approve(await betMarket.getAddress(), ethers.MaxUint256);
        await collateralToken.connect(user2).approve(await betMarket.getAddress(), ethers.MaxUint256);
    });

    describe("Pricing Algorithm Test", function () {
        const initialLiquidity = ethers.parseUnits("20", 6); // $20 initial liquidity
        const closingTime = 86400; // 1 day
        const resolutionTime = 172800; // 2 days

        beforeEach(async function () {
            // Create a bet with $20 initial liquidity
            const currentTime = await time.latest();
            await betMarket.connect(deployer).createBet(
                "Test Pricing Algorithm",
                "Test question for pricing validation",
                initialLiquidity,
                currentTime + closingTime,
                currentTime + resolutionTime,
                "", // discussion URL
                "", // tags
                "" // logo URL
            );
            poolId = 1;
        });

        it("Should correctly calculate initial prices", async function () {
            // Initial state: $20 liquidity, should result in 10.2 yes + 10.2 no tokens (due to 2% bonus)
            // Each should cost approximately $0.50 to buy 1 token
            
            const pool = await betMarket.pools(poolId);
            expect(pool.totalSupplyYes).to.equal(ethers.parseUnits("10.2", 6));
            expect(pool.totalSupplyNo).to.equal(ethers.parseUnits("10.2", 6));
            expect(pool.collateral).to.equal(initialLiquidity);

            // Test cost to buy 1 YES token (should be approximately $1)
            const costFor1Yes = await betMarket.costToBuyYes(poolId, ethers.parseUnits("1", 6));
            console.log("Cost to buy 1 YES token:", ethers.formatUnits(costFor1Yes, 6));
            
            // Test cost to buy 1 NO token (should be approximately $1)
            const costFor1No = await betMarket.costToBuyNo(poolId, ethers.parseUnits("1", 6));
            console.log("Cost to buy 1 NO token:", ethers.formatUnits(costFor1No, 6));

            // Both should be close to $0.50 (allowing for some precision differences)
            expect(costFor1Yes).to.be.closeTo(ethers.parseUnits("0.5", 6), ethers.parseUnits("0.1", 6));
            expect(costFor1No).to.be.closeTo(ethers.parseUnits("0.5", 6), ethers.parseUnits("0.1", 6));
        });

        it("Should correctly handle buying $100 NO and then selling it back", async function () {
            const buyAmount = ethers.parseUnits("100", 6); // Buy $100 worth of NO
            
            // Step 1: Buy $100 NO
            console.log("\n=== Step 1: Buying $100 NO ===");
            const costToBuy100No = await betMarket.costToBuyNo(poolId, buyAmount);
            console.log("Cost to buy $100 NO:", ethers.formatUnits(costToBuy100No, 6));
            
            await betMarket.connect(user1).buyNo(poolId, buyAmount, ethers.ZeroAddress);
            
            // Check new pool state
            const poolAfterBuy = await betMarket.pools(poolId);
            console.log("Pool collateral after buy:", ethers.formatUnits(poolAfterBuy.collateral, 6));
            console.log("Total NO supply after buy:", ethers.formatUnits(poolAfterBuy.totalSupplyNo, 6));
            console.log("Total YES supply after buy:", ethers.formatUnits(poolAfterBuy.totalSupplyYes, 6));
            
            // Step 2: Check prices after buying NO
            console.log("\n=== Step 2: Prices after buying NO ===");
            const costFor1YesAfterBuy = await betMarket.costToBuyYes(poolId, ethers.parseUnits("1", 6));
            const costFor1NoAfterBuy = await betMarket.costToBuyNo(poolId, ethers.parseUnits("1", 6));
            
            console.log("Cost to buy 1 YES after buying NO:", ethers.formatUnits(costFor1YesAfterBuy, 6));
            console.log("Cost to buy 1 NO after buying NO:", ethers.formatUnits(costFor1NoAfterBuy, 6));
            
            // With b=0.1, price changes are extremely small
            // Both prices should remain very close to $0.50
            expect(costFor1YesAfterBuy).to.be.closeTo(ethers.parseUnits("0.5", 6), ethers.parseUnits("0.01", 6));
            expect(costFor1NoAfterBuy).to.be.closeTo(ethers.parseUnits("0.5", 6), ethers.parseUnits("0.01", 6));
            
            // Step 3: Sell back the $100 NO
            console.log("\n=== Step 3: Selling back $100 NO ===");
            const revenueFromSell100No = await betMarket.revenueFromSellNo(poolId, buyAmount);
            console.log("Revenue from selling $100 NO:", ethers.formatUnits(revenueFromSell100No, 6));
            
            await betMarket.connect(user1).sellNo(poolId, buyAmount, ethers.ZeroAddress);
            
            // Step 4: Check final pool state and prices
            console.log("\n=== Step 4: Final state after selling NO ===");
            const finalPool = await betMarket.pools(poolId);
            console.log("Final pool collateral:", ethers.formatUnits(finalPool.collateral, 6));
            console.log("Final total NO supply:", ethers.formatUnits(finalPool.totalSupplyNo, 6));
            console.log("Final total YES supply:", ethers.formatUnits(finalPool.totalSupplyYes, 6));
            
            const finalCostFor1Yes = await betMarket.costToBuyYes(poolId, ethers.parseUnits("1", 6));
            const finalCostFor1No = await betMarket.costToBuyNo(poolId, ethers.parseUnits("1", 6));
            
            console.log("Final cost to buy 1 YES:", ethers.formatUnits(finalCostFor1Yes, 6));
            console.log("Final cost to buy 1 NO:", ethers.formatUnits(finalCostFor1No, 6));
            
            // Prices should be back to approximately $0.50 each
            expect(finalCostFor1Yes).to.be.closeTo(ethers.parseUnits("0.5", 6), ethers.parseUnits("0.1", 6));
            expect(finalCostFor1No).to.be.closeTo(ethers.parseUnits("0.5", 6), ethers.parseUnits("0.1", 6));
            
            // Pool should be back to initial state
            expect(finalPool.totalSupplyYes).to.equal(ethers.parseUnits("10.2", 6));
            expect(finalPool.totalSupplyNo).to.equal(ethers.parseUnits("10.2", 6));
            expect(finalPool.collateral).to.equal(initialLiquidity);
        });

        it("Should maintain price consistency across multiple trades", async function () {
            // Test a series of trades to see if prices remain consistent
            
            console.log("\n=== Testing price consistency across multiple trades ===");
            
            // Initial prices
            let costFor1Yes = await betMarket.costToBuyYes(poolId, ethers.parseUnits("1", 6));
            let costFor1No = await betMarket.costToBuyNo(poolId, ethers.parseUnits("1", 6));
            console.log("Initial - YES: $", ethers.formatUnits(costFor1Yes, 6), "NO: $", ethers.formatUnits(costFor1No, 6));
            
            // Buy $50 YES
            await betMarket.connect(user1).buyYes(poolId, ethers.parseUnits("50", 6), ethers.ZeroAddress);
            costFor1Yes = await betMarket.costToBuyYes(poolId, ethers.parseUnits("1", 6));
            costFor1No = await betMarket.costToBuyNo(poolId, ethers.parseUnits("1", 6));
            console.log("After buying $50 YES - YES: $", ethers.formatUnits(costFor1Yes, 6), "NO: $", ethers.formatUnits(costFor1No, 6));
            
            // Buy $30 NO
            await betMarket.connect(user2).buyNo(poolId, ethers.parseUnits("30", 6), ethers.ZeroAddress);
            costFor1Yes = await betMarket.costToBuyYes(poolId, ethers.parseUnits("1", 6));
            costFor1No = await betMarket.costToBuyNo(poolId, ethers.parseUnits("1", 6));
            console.log("After buying $30 NO - YES: $", ethers.formatUnits(costFor1Yes, 6), "NO: $", ethers.formatUnits(costFor1No, 6));
            
            // Sell $20 YES
            await betMarket.connect(user1).sellYes(poolId, ethers.parseUnits("20", 6), ethers.ZeroAddress);
            costFor1Yes = await betMarket.costToBuyYes(poolId, ethers.parseUnits("1", 6));
            costFor1No = await betMarket.costToBuyNo(poolId, ethers.parseUnits("1", 6));
            console.log("After selling $20 YES - YES: $", ethers.formatUnits(costFor1Yes, 6), "NO: $", ethers.formatUnits(costFor1No, 6));
            
            // Final state should be reasonable
            const finalPool = await betMarket.pools(poolId);
            console.log("Final pool state - Collateral: $", ethers.formatUnits(finalPool.collateral, 6));
            console.log("Final pool state - YES supply: ", ethers.formatUnits(finalPool.totalSupplyYes, 6));
            console.log("Final pool state - NO supply: ", ethers.formatUnits(finalPool.totalSupplyNo, 6));
            
            // Prices should still be reasonable (not negative or extremely high)
            expect(costFor1Yes).to.be.gt(0);
            expect(costFor1No).to.be.gt(0);
            expect(costFor1Yes).to.be.lt(ethers.parseUnits("100", 6)); // Should not be extremely high
            expect(costFor1No).to.be.lt(ethers.parseUnits("100", 6)); // Should not be extremely high
        });
    });
});
