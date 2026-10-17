// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Mintable fixture currency for demos; it has no backing or monetary value.
contract MockWBSC is ERC20 {
    error UnauthorizedMinter();

    address public immutable minter;

    constructor() ERC20("Mock BSC", "wBSC") {
        minter = msg.sender;
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        if (msg.sender != minter) revert UnauthorizedMinter();
        _mint(to, amount);
    }
}
