// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockToken
 * @dev A standard ERC20 token for use as collateral in tests.
 * It mints an initial supply to the contract deployer and has 6 decimals to mimic USDC.
 */
contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol, uint256 initialSupply) ERC20(name, symbol) {
        _mint(msg.sender, initialSupply);
    }

    // Override decimals to be 6, like USDC
    function decimals() public view virtual override returns (uint8) {
        return 6;
    }
}
