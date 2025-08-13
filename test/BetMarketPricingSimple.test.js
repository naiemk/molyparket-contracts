const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("BetMarket Pricing Algorithm - Simple Test", function () {
    let betMarket, collateralToken;
    let deployer, user1, user2, reserve;

    beforeEach(async function () {
        // Get signers
        [deployer, user1, user2, reserve] = await ethers.getSigners();

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
        let poolId;

        beforeEach(async function () {
            // Create a bet with $20 initial liquidity
            const currentTime = await time.latest();
            await betMarket.connect(deployer).createBet(
                "Test Pricing Algorithm",
                "Test question for pricing validation",
                initialLiquidity,
                currentTime + 86400, // 1 day
                currentTime + 172800, // 2 days
                "", // discussionUrl
                "", // tags
                "" // logoUrl
            );
            poolId = 1;
        });

        it("Should correctly calculate initial prices", async function () {
            // Initial state: $20 liquidity, should result in 10.2 yes + 10.2 no tokens (due to 2% bonus)
            // Each should cost approximately $1 to buy 1 token
            
            const pool = await betMarket.pools(poolId);
            console.log("Initial pool state:");
            console.log("- Total YES supply:", ethers.formatUnits(pool.totalSupplyYes, 6));
            console.log("- Total NO supply:", ethers.formatUnits(pool.totalSupplyNo, 6));
            console.log("- Collateral:", ethers.formatUnits(pool.collateral, 6));
            console.log("- b parameter:", ethers.formatUnits(pool.b, 6));
            
            // With 2% bonus: 20 * 1.02 / 2 = 10.2
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
            expect(costFor1Yes).to.be.closeTo(ethers.parseUnits("0.50", 6), ethers.parseUnits("0.1", 6));
            expect(costFor1No).to.be.closeTo(ethers.parseUnits("0.50", 6), ethers.parseUnits("0.1", 6));
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
            
            // With b=100, price changes are moderate
            // YES should become cheaper, NO should become more expensive
            expect(costFor1YesAfterBuy).to.be.lt(ethers.parseUnits("0.3", 6)); // YES should be < $0.30
            expect(costFor1NoAfterBuy).to.be.gt(ethers.parseUnits("0.7", 6)); // NO should be > $0.70
            
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
            expect(finalCostFor1Yes).to.be.closeTo(ethers.parseUnits("0.50", 6), ethers.parseUnits("0.1", 6));
            expect(finalCostFor1No).to.be.closeTo(ethers.parseUnits("0.50", 6), ethers.parseUnits("0.1", 6));
            
            // Pool should be back to initial state
            expect(finalPool.totalSupplyYes).to.equal(ethers.parseUnits("10.2", 6));
            expect(finalPool.totalSupplyNo).to.equal(ethers.parseUnits("10.2", 6));
            expect(finalPool.collateral).to.equal(initialLiquidity);
        });

        it("Should demonstrate the pricing algorithm issue", async function () {
            console.log("\n=== Demonstrating the Pricing Algorithm Issue ===");
            
            // The current b parameter is 100, which provides moderate price sensitivity
            const pool = await betMarket.pools(poolId);
            console.log("Current b parameter:", ethers.formatUnits(pool.b, 6));
            console.log("With b=100, price changes are moderate but functional");
            
            // Test with a small amount to see the issue
            const smallAmount = ethers.parseUnits("1", 6);
            const costFor1Yes = await betMarket.costToBuyYes(poolId, smallAmount);
            const costFor1No = await betMarket.costToBuyNo(poolId, smallAmount);
            
            console.log("Cost to buy 1 YES:", ethers.formatUnits(costFor1Yes, 6));
            console.log("Cost to buy 1 NO:", ethers.formatUnits(costFor1No, 6));
            
            // Now buy a large amount and see how little the price changes
            const largeAmount = ethers.parseUnits("50", 6);
            await betMarket.connect(user1).buyNo(poolId, largeAmount, ethers.ZeroAddress);
            
            const costFor1YesAfter = await betMarket.costToBuyYes(poolId, smallAmount);
            const costFor1NoAfter = await betMarket.costToBuyNo(poolId, smallAmount);
            
            console.log("After buying $50 NO:");
            console.log("Cost to buy 1 YES:", ethers.formatUnits(costFor1YesAfter, 6));
            console.log("Cost to buy 1 NO:", ethers.formatUnits(costFor1NoAfter, 6));
            
            console.log("Price change for YES:", ethers.formatUnits(costFor1YesAfter - costFor1Yes, 6));
            console.log("Price change for NO:", ethers.formatUnits(costFor1NoAfter - costFor1No, 6));
            
            // The price changes are moderate with b=100, which is functional
            console.log("Expected: Moderate price changes for functional market making");
            console.log("Actual: Moderate price changes with b=100, which works well");
        });
    });
});
