// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IBetResolver {
    enum Outcome { Unknown, True, False, Inconclusive }

    /**
     * @notice Requests to resolve a bet.
     * @param betPrompt The prompt for the bet.
     * @param onResolve The callback function to call when the bet is resolved. The function should have the following signature:
     *   onResolve(uint256 betId, Outcome outcome)
     */
    function resolve(
        uint256 betId,
        string memory betPrompt,
        bytes4 onResolve) external payable;
}