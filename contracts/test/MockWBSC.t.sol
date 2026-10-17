// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {MockWBSC} from "../src/MockWBSC.sol";
import {TestBase} from "./TestBase.sol";

contract MockWBSCTest is TestBase {
    address internal constant BUYER = address(0xB0B);

    function testDeployerCanMintSixDecimalFixtureCurrency() public {
        MockWBSC token = new MockWBSC();
        token.mint(BUYER, 1_000_000);
        assertEq(token.decimals(), 6, "currency must use six decimals");
        assertEq(token.balanceOf(BUYER), 1_000_000, "mint must fund the requested buyer");
        assertEq(token.totalSupply(), 1_000_000, "mint must account for fixture supply");
    }

    function testTokenNameClearlyIdentifiesMockBSC() public {
        MockWBSC token = new MockWBSC();
        assertEq(keccak256(bytes(token.name())), keccak256("Mock BSC"), "asset name must identify Mock BSC");
    }

    function testTokenSymbolIsWBSC() public {
        MockWBSC token = new MockWBSC();
        assertEq(keccak256(bytes(token.symbol())), keccak256("wBSC"), "asset symbol must identify wBSC");
    }

    function testOtherWalletCannotMint() public {
        MockWBSC token = new MockWBSC();
        vm.expectRevert();
        vm.prank(BUYER);
        token.mint(BUYER, 1_000_000);
        assertEq(token.totalSupply(), 0, "unauthorized mint must create no tokens");
    }
}
