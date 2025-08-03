// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// This is the interface the main BetMarket contract uses.
interface IDtnResolver {
    function onPoolResolve(uint256 poolId, uint8 outcome) external;
}

/**
 * @title MockDtnResolver
 * @dev A mock oracle for testing. It allows the test deployer to manually
 * trigger the callback to the BetMarket contract, simulating an oracle response.
 */
contract MockDtnResolver {
    event ResolutionRequested(string poolInfo, address callbackTarget);

    /**
     * @notice This function is called by BetMarket to request a resolution.
     * In this mock, it only emits an event for tests to listen to.
     */
    function requestResolve(string calldata poolInfo, address callbackTarget) external {
        emit ResolutionRequested(poolInfo, callbackTarget);
    }

    /**
     * @notice A helper function for tests to simulate the oracle's callback.
     * @param target The address of the BetMarket contract.
     * @param poolId The ID of the pool to resolve.
     * @param outcome The resolution outcome (1 for YES, 2 for NO, 0 for INCONCLUSIVE).
     */
    function callBack(address target, uint256 poolId, uint8 outcome) external {
        IDtnResolver(target).onPoolResolve(poolId, outcome);
    }
}
