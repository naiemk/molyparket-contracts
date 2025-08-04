const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("BetMarket Integration with BetResolver", function () {
    let betMarket, betResolver, mockDtnAi, collateralToken;
    let deployer, user1, user2, user3, node, reserve;
    let sessionId;

    beforeEach(async function () {
        // Get signers
        [deployer, user1, user2, user3, node, reserve] = await ethers.getSigners();

        // Deploy Mock ERC20 Token for collateral (6 decimals like USDC)
        const MockToken = await ethers.getContractFactory("MockToken");
        collateralToken = await MockToken.deploy("Mock USD", "mUSD", ethers.parseUnits("1000000", 6));

        // Deploy MockDtnAi
        const MockDtnAi = await ethers.getContractFactory("LocalMockDtnAi");
        mockDtnAi = await MockDtnAi.deploy(await collateralToken.getAddress(), deployer.address);

        // Deploy BetResolver
        const BetResolver = await ethers.getContractFactory("BetResolver");
        betResolver = await BetResolver.deploy();

        // Deploy BetMarket
        const BetMarket = await ethers.getContractFactory("BetMarket");
        betMarket = await BetMarket.deploy(
            await collateralToken.getAddress(),
            await betResolver.getAddress(),
            reserve.address
        );

        // Configure BetResolver
        await betResolver.configure(
            await betMarket.getAddress(),
            await mockDtnAi.getAddress(),
            "You are a prediction market oracle. Respond with exactly 'true', 'false', or 'inconclusive'.",
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
        sessionId = await betResolver.sessionId();

        // Distribute collateral tokens to users
        await collateralToken.transfer(user1.address, ethers.parseUnits("10000", 6));
        await collateralToken.transfer(user2.address, ethers.parseUnits("10000", 6));
        await collateralToken.transfer(user3.address, ethers.parseUnits("10000", 6));

        // Grant allowance to the BetMarket contract
        await collateralToken.connect(deployer).approve(await betMarket.getAddress(), ethers.MaxUint256);
        await collateralToken.connect(user1).approve(await betMarket.getAddress(), ethers.MaxUint256);
        await collateralToken.connect(user2).approve(await betMarket.getAddress(), ethers.MaxUint256);
        await collateralToken.connect(user3).approve(await betMarket.getAddress(), ethers.MaxUint256);
    });

    describe("Full Bet Lifecycle - YES Outcome", function () {
        let poolId;
        const initialLiquidity = ethers.parseUnits("1000", 6);
        const closingTime = 86400; // 1 day
        const resolutionTime = 172800; // 2 days

        beforeEach(async function () {
            // Create a bet
            const currentTime = await time.latest();
            await betMarket.connect(deployer).createBet(
                "Will ETH reach $5000 by end of 2024?",
                "Will the price of Ethereum (ETH) be above $5000 USD on December 31, 2024 at 23:59:59 UTC?",
                initialLiquidity,
                currentTime + closingTime,
                currentTime + resolutionTime
            );
            poolId = 1;
        });

        it("Should complete full lifecycle with YES outcome", async function () {
            // Step 1: Users buy tokens
            const user1YesAmount = ethers.parseUnits("200", 6);
            const user2NoAmount = ethers.parseUnits("300", 6);
            const user3YesAmount = ethers.parseUnits("150", 6);

            await betMarket.connect(user1).buyYes(poolId, user1YesAmount, ethers.ZeroAddress);
            await betMarket.connect(user2).buyNo(poolId, user2NoAmount, ethers.ZeroAddress);
            await betMarket.connect(user3).buyYes(poolId, user3YesAmount, ethers.ZeroAddress);

            // Verify balances
            expect(await betMarket.yesBalances(poolId, user1.address)).to.equal(user1YesAmount);
            expect(await betMarket.noBalances(poolId, user2.address)).to.equal(user2NoAmount);
            expect(await betMarket.yesBalances(poolId, user3.address)).to.equal(user3YesAmount);

            // Step 2: Fast forward to resolution time
            const currentTime = await time.latest();
            await time.increaseTo(currentTime + resolutionTime + 1);

            // Step 3: Resolve the bet
            await expect(betMarket.connect(deployer).resolve(poolId, { value: ethers.parseEther("0.1") }))
                .to.emit(betMarket, "PoolResolving")
                .withArgs(poolId);

            // Step 4: Get the request ID from BetResolver
            const events = await betResolver.queryFilter(betResolver.filters.ResolveRequested, -1);
            const requestId = events[0].args.requestId;

            // Step 5: Mock node response with 'true' (YES outcome)
            const encodedResponse = ethers.AbiCoder.defaultAbiCoder().encode(["string"], ["true"]);
            // await mockDtnAi.connect(node).respondToRequest(
            //     requestId,
            //     0, // SUCCESS
            //     "",
            //     encodedResponse,
            //     ethers.keccak256(ethers.toUtf8Bytes("node.tester.node1")),
            //     100,
            //     50
            // );

            // Step 6: Trigger callback to resolve the bet
            await expect(mockDtnAi.connect(node).respondSuccess(requestId, encodedResponse, 0))
                .to.emit(betMarket, "PoolResolved")
                .withArgs(poolId, 1); // Resolution.YES

            // Step 7: Verify pool is resolved
            const pool = await betMarket.pools(poolId);
            expect(pool.resolution).to.equal(1); // Resolution.YES

            // Step 8: Users withdraw their winnings
            const user1Payout = await betMarket.withdrawableAmount(poolId, user1.address);
            const user2Payout = await betMarket.withdrawableAmount(poolId, user2.address);
            const user3Payout = await betMarket.withdrawableAmount(poolId, user3.address);

            // User1 and User3 should get payouts (YES holders), User2 should get nothing (NO holder)
            expect(user1Payout).to.be.gt(0);
            expect(user2Payout).to.equal(0);
            expect(user3Payout).to.be.gt(0);

            // Record initial balances
            const user1InitialBalance = await collateralToken.balanceOf(user1.address);
            const user3InitialBalance = await collateralToken.balanceOf(user3.address);

            // Withdraw
            await betMarket.connect(user1).withdraw(poolId);
            await betMarket.connect(user3).withdraw(poolId);

            // Verify payouts
            expect(await collateralToken.balanceOf(user1.address)).to.equal(user1InitialBalance + user1Payout);
            expect(await collateralToken.balanceOf(user3.address)).to.equal(user3InitialBalance + user3Payout);

            // User2 should not be able to withdraw (no winnings)
            await expect(betMarket.connect(user2).withdraw(poolId))
                .to.be.revertedWith("No funds to withdraw");

            // Verify balances are reset after withdrawal
            expect(await betMarket.yesBalances(poolId, user1.address)).to.equal(0);
            expect(await betMarket.yesBalances(poolId, user3.address)).to.equal(0);
        });
    });

    describe("Full Bet Lifecycle - NO Outcome", function () {
        let poolId;
        const initialLiquidity = ethers.parseUnits("1000", 6);
        const closingTime = 86400; // 1 day
        const resolutionTime = 172800; // 2 days

        beforeEach(async function () {
            // Create a bet
            const currentTime = await time.latest();
            await betMarket.connect(deployer).createBet(
                "Will Bitcoin crash below $20k in 2024?",
                "Will the price of Bitcoin (BTC) fall below $20,000 USD at any point during 2024?",
                initialLiquidity,
                currentTime + closingTime,
                currentTime + resolutionTime
            );
            poolId = 1;
        });

        it("Should complete full lifecycle with NO outcome", async function () {
            // Step 1: Users buy tokens
            const user1YesAmount = ethers.parseUnits("200", 6);
            const user2NoAmount = ethers.parseUnits("300", 6);
            const user3NoAmount = ethers.parseUnits("150", 6);

            await betMarket.connect(user1).buyYes(poolId, user1YesAmount, ethers.ZeroAddress);
            await betMarket.connect(user2).buyNo(poolId, user2NoAmount, ethers.ZeroAddress);
            await betMarket.connect(user3).buyNo(poolId, user3NoAmount, ethers.ZeroAddress);

            // Step 2: Fast forward to resolution time
            const currentTime = await time.latest();
            await time.increaseTo(currentTime + resolutionTime + 1);

            // Step 3: Resolve the bet
            await betMarket.connect(deployer).resolve(poolId, { value: ethers.parseEther("0.1") });

            // Step 4: Get the request ID and mock response with 'false'
            const events = await betResolver.queryFilter(betResolver.filters.ResolveRequested, -1);
            const requestId = events[0].args.requestId;

            const encodedResponse = ethers.AbiCoder.defaultAbiCoder().encode(["string"], ["false"]);

            // Step 5: Trigger callback
            await mockDtnAi.connect(node).respondSuccess(requestId, encodedResponse, 0);

            // Step 6: Verify pool is resolved as NO
            const pool = await betMarket.pools(poolId);
            expect(pool.resolution).to.equal(2); // Resolution.NO

            // Step 7: Check payouts
            const user1Payout = await betMarket.withdrawableAmount(poolId, user1.address);
            const user2Payout = await betMarket.withdrawableAmount(poolId, user2.address);
            const user3Payout = await betMarket.withdrawableAmount(poolId, user3.address);

            // User1 should get nothing (YES holder), User2 and User3 should get payouts (NO holders)
            expect(user1Payout).to.equal(0);
            expect(user2Payout).to.be.gt(0);
            expect(user3Payout).to.be.gt(0);

            // Withdraw
            await betMarket.connect(user2).withdraw(poolId);
            await betMarket.connect(user3).withdraw(poolId);

            // User1 should not be able to withdraw
            await expect(betMarket.connect(user1).withdraw(poolId))
                .to.be.revertedWith("No funds to withdraw");
        });
    });

    describe("Full Bet Lifecycle - INCONCLUSIVE Outcome", function () {
        let poolId;
        const initialLiquidity = ethers.parseUnits("1000", 6);
        const closingTime = 86400; // 1 day
        const resolutionTime = 172800; // 2 days

        beforeEach(async function () {
            // Create a bet
            const currentTime = await time.latest();
            await betMarket.connect(deployer).createBet(
                "Will there be a major earthquake in California in 2024?",
                "Will there be an earthquake of magnitude 7.0 or greater in California during 2024?",
                initialLiquidity,
                currentTime + closingTime,
                currentTime + resolutionTime
            );
            poolId = 1;
        });

        it("Should complete full lifecycle with INCONCLUSIVE outcome", async function () {
            // Step 1: Users buy tokens
            const user1YesAmount = ethers.parseUnits("200", 6);
            const user2NoAmount = ethers.parseUnits("300", 6);
            const user3YesAmount = ethers.parseUnits("150", 6);

            await betMarket.connect(user1).buyYes(poolId, user1YesAmount, ethers.ZeroAddress);
            await betMarket.connect(user2).buyNo(poolId, user2NoAmount, ethers.ZeroAddress);
            await betMarket.connect(user3).buyYes(poolId, user3YesAmount, ethers.ZeroAddress);

            // Step 2: Fast forward to resolution time
            const currentTime = await time.latest();
            await time.increaseTo(currentTime + resolutionTime + 1);

            // Step 3: Resolve the bet
            await betMarket.connect(deployer).resolve(poolId, { value: ethers.parseEther("0.1") });

            // Step 4: Get the request ID and mock response with 'inconclusive'
            const events = await betResolver.queryFilter(betResolver.filters.ResolveRequested, -1);
            const requestId = events[0].args.requestId;

            const encodedResponse = ethers.AbiCoder.defaultAbiCoder().encode(["string"], ["inconclusive"]);

            // Step 5: Trigger callback
            await mockDtnAi.connect(node).respondSuccess(requestId, encodedResponse, 0);

            // Step 6: Verify pool is resolved as INCONCLUSIVE
            const pool = await betMarket.pools(poolId);
            expect(pool.resolution).to.equal(3); // Resolution.INCONCLUSIVE

            // Step 7: Check payouts - everyone should get proportional amounts
            const user1Payout = await betMarket.withdrawableAmount(poolId, user1.address);
            const user2Payout = await betMarket.withdrawableAmount(poolId, user2.address);
            const user3Payout = await betMarket.withdrawableAmount(poolId, user3.address);

            // All users should get payouts proportional to their total tokens
            expect(user1Payout).to.be.gt(0);
            expect(user2Payout).to.be.gt(0);
            expect(user3Payout).to.be.gt(0);

            // Withdraw all
            await betMarket.connect(user1).withdraw(poolId);
            await betMarket.connect(user2).withdraw(poolId);
            await betMarket.connect(user3).withdraw(poolId);

            // Verify all balances are reset
            expect(await betMarket.yesBalances(poolId, user1.address)).to.equal(0);
            expect(await betMarket.noBalances(poolId, user2.address)).to.equal(0);
            expect(await betMarket.yesBalances(poolId, user3.address)).to.equal(0);
        });
    });

    describe("Error Handling and Edge Cases", function () {
        let poolId;
        const initialLiquidity = ethers.parseUnits("1000", 6);
        const closingTime = 86400; // 1 day
        const resolutionTime = 172800; // 2 days

        beforeEach(async function () {
            // Create a bet
            const currentTime = await time.latest();
            await betMarket.connect(deployer).createBet(
                "Test bet for error handling",
                "This is a test bet to verify error handling scenarios.",
                initialLiquidity,
                currentTime + closingTime,
                currentTime + resolutionTime
            );
            poolId = 1;
        });

        it("Should handle AI failure during resolution", async function () {
            // Users buy tokens
            await betMarket.connect(user1).buyYes(poolId, ethers.parseUnits("200", 6), ethers.ZeroAddress);
            await betMarket.connect(user2).buyNo(poolId, ethers.parseUnits("300", 6), ethers.ZeroAddress);

            // Fast forward to resolution time
            const currentTime = await time.latest();
            await time.increaseTo(currentTime + resolutionTime + 1);

            // Resolve the bet
            await betMarket.connect(deployer).resolve(poolId, { value: ethers.parseEther("0.1") });

            // Get the request ID
            const events = await betResolver.queryFilter(betResolver.filters.ResolveRequested, -1);
            const requestId = events[0].args.requestId;

            // Mock AI failure
            await mockDtnAi.connect(node).respondFailure(requestId, "AI model temporarily unavailable");

            // Verify pool is still unresolved
            const pool = await betMarket.pools(poolId);
            expect(pool.resolution).to.equal(0); // Resolution.UNRESOLVED

            // Users should not be able to withdraw
            await expect(betMarket.connect(user1).withdraw(poolId))
                .to.be.revertedWith("Pool not resolved");
        });

        it("Should prevent resolution before resolution time", async function () {
            // Users buy tokens
            await betMarket.connect(user1).buyYes(poolId, ethers.parseUnits("200", 6), ethers.ZeroAddress);

            // Try to resolve before resolution time
            await expect(betMarket.connect(deployer).resolve(poolId, { value: ethers.parseEther("0.1") }))
                .to.be.revertedWith("Not yet resolution time");
        });

        it("Should prevent double resolution", async function () {
            // Users buy tokens
            await betMarket.connect(user1).buyYes(poolId, ethers.parseUnits("200", 6), ethers.ZeroAddress);

            // Fast forward to resolution time
            const currentTime = await time.latest();
            await time.increaseTo(currentTime + resolutionTime + 1);

            // Resolve the bet
            await betMarket.connect(deployer).resolve(poolId, { value: ethers.parseEther("0.1") });

            // Get the request ID and resolve it
            const events = await betResolver.queryFilter(betResolver.filters.ResolveRequested, -1);
            const requestId = events[0].args.requestId;

            const encodedResponse = ethers.AbiCoder.defaultAbiCoder().encode(["string"], ["true"]);
            await mockDtnAi.connect(node).respondToRequest(
                requestId,
                0, // SUCCESS
                "",
                encodedResponse,
                ethers.keccak256(ethers.toUtf8Bytes("node.tester.node1")),
                100,
                50
            );

            await mockDtnAi.connect(node).respondSuccess(requestId, encodedResponse, 0);

            // Try to resolve again
            await expect(betMarket.connect(deployer).resolve(poolId, { value: ethers.parseEther("0.1") }))
                .to.be.revertedWith("Pool already resolved");
        });
    });

    describe("Fee Collection and Distribution", function () {
        let poolId;
        const initialLiquidity = ethers.parseUnits("1000", 6);
        const closingTime = 86400; // 1 day
        const resolutionTime = 172800; // 2 days

        beforeEach(async function () {
            // Create a bet
            const currentTime = await time.latest();
            await betMarket.connect(deployer).createBet(
                "Test bet for fee collection",
                "This is a test bet to verify fee collection and distribution.",
                initialLiquidity,
                currentTime + closingTime,
                currentTime + resolutionTime
            );
            poolId = 1;
        });

        it("Should collect and distribute fees correctly", async function () {
            // Users buy tokens with referrer
            await betMarket.connect(user1).buyYes(poolId, ethers.parseUnits("200", 6), user3.address);
            await betMarket.connect(user2).buyNo(poolId, ethers.parseUnits("300", 6), ethers.ZeroAddress);

            // Check fee distribution
            const reserveFees = await betMarket.withdrawableFees(reserve.address);
            const referrerFees = await betMarket.withdrawableFees(user3.address);

            expect(reserveFees).to.be.gt(0);
            expect(referrerFees).to.be.gt(0);

            // Withdraw fees
            const reserveInitialBalance = await collateralToken.balanceOf(reserve.address);
            const referrerInitialBalance = await collateralToken.balanceOf(user3.address);

            await betMarket.connect(reserve).withdrawFees();
            await betMarket.connect(user3).withdrawFees();

            expect(await collateralToken.balanceOf(reserve.address)).to.equal(reserveInitialBalance + reserveFees);
            expect(await collateralToken.balanceOf(user3.address)).to.equal(referrerInitialBalance + referrerFees);

            // Verify fees are reset
            expect(await betMarket.withdrawableFees(reserve.address)).to.equal(0);
            expect(await betMarket.withdrawableFees(user3.address)).to.equal(0);
        });
    });
}); 