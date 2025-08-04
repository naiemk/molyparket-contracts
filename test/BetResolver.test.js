const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("BetResolver", function () {
    let betResolver, mockDtnAi, mockToken;
    let deployer, user1, user2, node;
    let sessionId;

    beforeEach(async function () {
        // Get signers
        [deployer, user1, user2, node] = await ethers.getSigners();

        // Deploy Mock ERC20 Token for fees
        const MockToken = await ethers.getContractFactory("MockToken");
        mockToken = await MockToken.deploy("Mock Fee Token", "MFT", ethers.parseUnits("1000000", 18));

        // Deploy MockDtnAi
        const MockDtnAi = await ethers.getContractFactory("LocalMockDtnAi");
        mockDtnAi = await MockDtnAi.deploy(await mockToken.getAddress(), deployer.address);

        // Deploy BetResolver
        const BetResolver = await ethers.getContractFactory("BetResolver");
        betResolver = await BetResolver.deploy();

        // Configure BetResolver (use deployer as betMarket for testing)
        await betResolver.configure(
            deployer.address,
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
        await mockToken.transfer(await betResolver.getAddress(), ethers.parseUnits("100", 18));
        await betResolver.restartSession();
        sessionId = await betResolver.sessionId();
    });

    describe("Setup and Configuration", function () {
        it("Should configure correctly", async function () {
            expect(await betResolver.betMarket()).to.equal(deployer.address);
            expect(await betResolver.ai()).to.equal(await mockDtnAi.getAddress());
            expect(await betResolver.systemPrompt()).to.equal("You are a prediction market oracle. Respond with exactly 'true', 'false', or 'inconclusive'.");
            expect(await betResolver.modelName()).to.equal("model.system.openai-gpt-o3-simpletext");
            expect(await betResolver.nodeName()).to.equal("node.tester.node1");
        });

        it("Should start a session correctly", async function () {
            expect(sessionId).to.be.gt(0);
            expect(await mockDtnAi.isSessionActive(sessionId)).to.be.true;
        });

        it("Should allow fee configuration", async function () {
            await betResolver.setFees(
                ethers.parseUnits("0.001", 18),  // feePerByteReq
                ethers.parseUnits("0.001", 18),  // feePerByteRes
                ethers.parseUnits("1", 18),      // totalFeePerRes
                500000                           // resolutionGasLimit
            );

            expect(await betResolver.feePerByteReq()).to.equal(ethers.parseUnits("0.001", 18));
            expect(await betResolver.feePerByteRes()).to.equal(ethers.parseUnits("0.001", 18));
            expect(await betResolver.totalFeePerRes()).to.equal(ethers.parseUnits("1", 18));
            expect(await betResolver.resolutionGasLimit()).to.equal(500000);
        });
    });

    describe("Bet Resolution - Success Cases", function () {
        it("Should resolve bet with 'true' outcome", async function () {
            const betId = 1;
            const betPrompt = "Will the price of ETH be above $3000 on December 31, 2024?";
            const onResolve = ethers.keccak256(ethers.toUtf8Bytes("onResolve(uint256,uint8)")).slice(0, 10);

            // Call resolve (deployer is configured as betMarket)
            await expect(betResolver.connect(deployer).resolve(betId, betPrompt, onResolve, { value: ethers.parseEther("0.1") }))
                .to.emit(betResolver, "ResolveRequested");

            // Get the request ID from the event
            const events = await betResolver.queryFilter(betResolver.filters.ResolveRequested, -1);
            const requestId = events[0].args.requestId;

            // Verify request was created in MockDtnAi
            const request = await mockDtnAi.getRequest(requestId);
            expect(request.call.length).to.be.gt(0);

            // Mock node response with 'true'
            const encodedResponse = ethers.AbiCoder.defaultAbiCoder().encode(["string"], ["true"]);
            await expect(mockDtnAi.connect(node).respondSuccess(requestId, encodedResponse, 0))
                .to.emit(betResolver, "BetResolved")
                .withArgs(betId, 1, "true"); // 1 = Outcome.True

            // Verify bet state
            const bet = await betResolver.bets(betId);
            expect(bet.outcome).to.equal(1); // Outcome.True
            expect(bet.aiRawResult).to.equal("true");
            expect(bet.aiError).to.equal("");
        });

        it("Should resolve bet with 'false' outcome", async function () {
            const betId = 2;
            const betPrompt = "Will Bitcoin reach $100k in 2024?";
            const onResolve = ethers.keccak256(ethers.toUtf8Bytes("onResolve(uint256,uint8)")).slice(0, 10);

            // Call resolve
            await betResolver.connect(deployer).resolve(betId, betPrompt, onResolve, { value: ethers.parseEther("0.1") });

            // Get the request ID
            const events = await betResolver.queryFilter(betResolver.filters.ResolveRequested, -1);
            const requestId = events[0].args.requestId;

            // Mock node response with 'false'
            const encodedResponse = ethers.AbiCoder.defaultAbiCoder().encode(["string"], ["false"]);
            await mockDtnAi.connect(node).respondSuccess(requestId, encodedResponse, 0);

            // Verify bet state
            const bet = await betResolver.bets(betId);
            expect(bet.outcome).to.equal(2); // Outcome.False
            expect(bet.aiRawResult).to.equal("false");
        });

        it("Should resolve bet with 'inconclusive' outcome", async function () {
            const betId = 3;
            const betPrompt = "Will there be a major earthquake in California in 2024?";
            const onResolve = ethers.keccak256(ethers.toUtf8Bytes("onResolve(uint256,uint8)")).slice(0, 10);

            // Call resolve
            await betResolver.connect(deployer).resolve(betId, betPrompt, onResolve, { value: ethers.parseEther("0.1") });

            // Get the request ID
            const events = await betResolver.queryFilter(betResolver.filters.ResolveRequested, -1);
            const requestId = events[0].args.requestId;

            // Mock node response with 'inconclusive'
            const encodedResponse = ethers.AbiCoder.defaultAbiCoder().encode(["string"], ["inconclusive"]);
            await mockDtnAi.connect(node).respondSuccess(requestId, encodedResponse, 0);

            // Verify bet state
            const bet = await betResolver.bets(betId);
            expect(bet.outcome).to.equal(3); // Outcome.Inconclusive
            expect(bet.aiRawResult).to.equal("inconclusive");
        });

        it("Should handle case-insensitive responses", async function () {
            const betId = 4;
            const betPrompt = "Will Tesla stock go up tomorrow?";
            const onResolve = ethers.keccak256(ethers.toUtf8Bytes("onResolve(uint256,uint8)")).slice(0, 10);

            // Call resolve
            await betResolver.connect(deployer).resolve(betId, betPrompt, onResolve, { value: ethers.parseEther("0.1") });

            // Get the request ID
            const events = await betResolver.queryFilter(betResolver.filters.ResolveRequested, -1);
            const requestId = events[0].args.requestId;

            // Mock node response with 'TRUE' (uppercase)
            const encodedResponse = ethers.AbiCoder.defaultAbiCoder().encode(["string"], ["TRUE"]);
            await mockDtnAi.connect(node).respondSuccess(requestId, encodedResponse, 0);

            // Verify bet state
            const bet = await betResolver.bets(betId);
            expect(bet.outcome).to.equal(1); // Outcome.True
            expect(bet.aiRawResult).to.equal("TRUE");
        });
    });

    describe("Bet Resolution - Failure Cases", function () {
        it("Should handle AI failure response", async function () {
            const betId = 5;
            const betPrompt = "Will the sun rise tomorrow?";
            const onResolve = ethers.keccak256(ethers.toUtf8Bytes("onResolve(uint256,uint8)")).slice(0, 10);

            // Call resolve
            await betResolver.connect(deployer).resolve(betId, betPrompt, onResolve, { value: ethers.parseEther("0.1") });

            // Get the request ID
            const events = await betResolver.queryFilter(betResolver.filters.ResolveRequested, -1);
            const requestId = events[0].args.requestId;

            // Mock node failure response
            await mockDtnAi.connect(node).respondFailure(requestId, "AI model temporarily unavailable");

            // Verify bet state
            const bet = await betResolver.bets(betId);
            expect(bet.outcome).to.equal(0); // Outcome.Unknown
            expect(bet.aiError).to.equal("AI model temporarily unavailable");
            expect(bet.aiRawResult).to.equal("");
        });

        it("Should handle invalid response format", async function () {
            const betId = 6;
            const betPrompt = "Will it rain tomorrow?";
            const onResolve = ethers.keccak256(ethers.toUtf8Bytes("onResolve(uint256,uint8)")).slice(0, 10);

            // Call resolve
            await betResolver.connect(deployer).resolve(betId, betPrompt, onResolve, { value: ethers.parseEther("0.1") });

            // Get the request ID
            const events = await betResolver.queryFilter(betResolver.filters.ResolveRequested, -1);
            const requestId = events[0].args.requestId;

            // Mock node response with invalid format
            const encodedResponse = ethers.AbiCoder.defaultAbiCoder().encode(["string"], ["maybe"]);
            await mockDtnAi.connect(node).respondSuccess(requestId, encodedResponse, 0);

            // Verify bet state - should default to Inconclusive
            const bet = await betResolver.bets(betId);
            expect(bet.outcome).to.equal(3); // Outcome.Inconclusive
            expect(bet.aiRawResult).to.equal("maybe");
        });
    });

    describe("Security and Access Control", function () {
        it("Should only allow betMarket to call resolve", async function () {
            const betId = 7;
            const betPrompt = "Test prompt";
            const onResolve = ethers.keccak256(ethers.toUtf8Bytes("onResolve(uint256,uint8)")).slice(0, 10);

            await expect(
                betResolver.connect(user1).resolve(betId, betPrompt, onResolve, { value: ethers.parseEther("0.1") })
            ).to.be.revertedWith("invalid sender");
        });

        it("Should require sufficient gas for resolution", async function () {
            const betId = 8;
            const betPrompt = "Test prompt";
            const onResolve = ethers.keccak256(ethers.toUtf8Bytes("onResolve(uint256,uint8)")).slice(0, 10);

            // Try with insufficient gas (less than resolutionGasLimit)
            // The resolutionGasLimit is 400_000 wei, so we need to send at least that much
            await expect(
                betResolver.connect(deployer).resolve(betId, betPrompt, onResolve, { value: 200000 }) // Less than 400_000
            ).to.be.revertedWith("insufficient gas");
        });

        it("Should only allow DtnAI to call callbacks", async function () {
            const betId = 9;
            const betPrompt = "Test prompt";
            const onResolve = ethers.keccak256(ethers.toUtf8Bytes("onResolve(uint256,uint8)")).slice(0, 10);

            // Call resolve
            await betResolver.connect(deployer).resolve(betId, betPrompt, onResolve, { value: ethers.parseEther("0.1") });

            // Get the request ID
            const events = await betResolver.queryFilter(betResolver.filters.ResolveRequested, -1);
            const requestId = events[0].args.requestId;

            // Try to call callback from unauthorized address
            await expect(
                betResolver.connect(user1).callbackResolve(requestId)
            ).to.be.revertedWith("Only Dtn can call this function");
        });
    });

    describe("Session Management", function () {
        it("Should allow session restart", async function () {
            const initialSessionId = await betResolver.sessionId();
            
            // Fund resolver with more tokens
            await mockToken.transfer(await betResolver.getAddress(), ethers.parseUnits("50", 18));
            
            // Restart session
            await expect(betResolver.restartSession())
                .to.emit(betResolver, "SessionRestarted");

            const newSessionId = await betResolver.sessionId();
            expect(newSessionId).to.not.equal(initialSessionId);
            expect(await mockDtnAi.isSessionActive(newSessionId)).to.be.true;
        });

        it("Should require fee tokens to restart session", async function () {
            // The beforeEach already called restartSession, so this is the second call
            // which should fail because all tokens were used in the first call
            await expect(betResolver.connect(deployer).restartSession())
                .to.be.revertedWith("No fee tokens");
        });
    });
}); 