// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {MockWBSC} from "../src/MockWBSC.sol";
import {LoyaltyCheckout} from "../src/LoyaltyCheckout.sol";
import {ServiceLoyaltyMigration} from "../src/ServiceLoyaltyMigration.sol";
import {LegacyLoyaltyCheckout} from "./fixtures/LegacyLoyaltyCheckout.sol";
import {TestBase} from "./TestBase.sol";

contract ServiceLoyaltyMigrationTest is TestBase {
    MockWBSC token;
    LegacyLoyaltyCheckout legacy;
    ServiceLoyaltyMigration upgraded;
    address constant BUYER = address(0xB0B);
    address constant SELLER = address(0xA11CE);
    bytes32 constant FIRST = keccak256("first");
    bytes32 constant SECOND = keccak256("second");

    function setUp() public {
        token = new MockWBSC();
        legacy = new LegacyLoyaltyCheckout(address(token));
        token.mint(BUYER, 1_000_000);
        vm.startPrank(SELLER);
        legacy.setOffer(FIRST, 50_000, 150_000, 2000, true);
        legacy.setOffer(SECOND, 50_000, 150_000, 2000, true);
        vm.stopPrank();
        vm.prank(BUYER);
        token.approve(address(legacy), 1_000_000);
        for (uint256 i = 1; i <= 3; ++i) {
            vm.prank(BUYER);
            legacy.checkout(SELLER, FIRST, bytes32(i), 50_000, 1, block.timestamp);
        }
        // V1 incorrectly discounted SECOND. Migration carries only what was actually paid.
        vm.prank(BUYER);
        legacy.checkout(SELLER, SECOND, bytes32(uint256(4)), 40_000, 1, block.timestamp);
        upgraded = new ServiceLoyaltyMigration(address(token), address(legacy));
    }

    function testImportsActualOrdersIntoSeparateServiceLedgersWithoutMovingTokens() public {
        uint256 buyerBalance = token.balanceOf(BUYER);
        uint256 sellerBalance = token.balanceOf(SELLER);
        bytes32[] memory ids = new bytes32[](4);
        for (uint256 i; i < 4; ++i) {
            ids[i] = bytes32(i + 1);
        }
        upgraded.importHistory(BUYER, ids);
        (uint256 firstPrice,, uint256 firstPaid, uint256 firstCount,) = upgraded.preview(BUYER, SELLER, FIRST);
        (uint256 secondPrice, uint16 secondBps, uint256 secondPaid, uint256 secondCount,) =
            upgraded.preview(BUYER, SELLER, SECOND);
        assertEq(firstPrice, 40_000, "repeated first service retains its earned tier");
        assertEq(firstPaid, 150_000, "first service retains only its own payments");
        assertEq(firstCount, 3, "first service retains its actual count");
        assertEq(secondPrice, 50_000, "second service loses the incorrect inherited discount");
        assertEq(secondBps, 0, "second service has not qualified");
        assertEq(secondPaid, 40_000, "carry actual discounted amount, not old aggregate or gross price");
        assertEq(secondCount, 1, "second service has exactly one old order");
        assertEq(token.balanceOf(BUYER), buyerBalance, "history import must not debit buyer");
        assertEq(token.balanceOf(SELLER), sellerBalance, "history import must not credit seller");
        upgraded.importHistory(BUYER, ids);
        assertEq(upgraded.stats(BUYER, SELLER, FIRST).paid, 150_000, "repeated import cannot duplicate credit");
        assertEq(upgraded.stats(BUYER, SELLER, SECOND).purchaseCount, 1, "repeated import cannot duplicate count");
    }

    function testHistoricalEntitlementsAndReplayGuardsRemainValidWithoutImport() public {
        assertEq(upgraded.orders(BUYER, bytes32(uint256(4))).amount, 40_000, "old paid response remains deliverable");
        assertEq(upgraded.orders(BUYER, bytes32(uint256(4))).sku, SECOND, "old entitlement keeps its service");
        vm.prank(BUYER);
        token.approve(address(upgraded), 100_000);
        vm.expectRevert(LoyaltyCheckout.DuplicateOrder.selector);
        vm.prank(BUYER);
        upgraded.checkout(SELLER, SECOND, bytes32(uint256(4)), 50_000, 1, block.timestamp);
    }

    function testOnlyVerifiedLegacyOrdersCanBeImportedForTheirActualBuyer() public {
        bytes32[] memory ids = new bytes32[](1);
        ids[0] = bytes32(uint256(1));
        vm.expectRevert(ServiceLoyaltyMigration.UnknownLegacyOrder.selector);
        upgraded.importHistory(address(0xBAD), ids);
        ids[0] = "invented";
        vm.expectRevert(ServiceLoyaltyMigration.UnknownLegacyOrder.selector);
        upgraded.importHistory(BUYER, ids);
        assertEq(upgraded.stats(BUYER, SELLER, FIRST).paid, 0, "invalid source cannot invent paid spend");
    }

    function testSellerMayUpdateInheritedOfferOnlyInItsOwnBucket() public {
        assertEq(upgraded.offer(SELLER, FIRST).version, 1, "existing seller offer is available");
        vm.prank(SELLER);
        upgraded.setOffer(FIRST, 60_000, 150_000, 1000, true);
        assertEq(upgraded.offer(SELLER, FIRST).version, 2, "new version follows inherited version");
        assertEq(legacy.offer(SELLER, FIRST).basePrice, 50_000, "old contract remains unchanged");
        assertEq(upgraded.offer(SELLER, SECOND).basePrice, 50_000, "other service remains unchanged");
    }

    function testLegacySourceMustUseTheSamePaymentToken() public {
        MockWBSC otherToken = new MockWBSC();
        vm.expectRevert(ServiceLoyaltyMigration.InvalidLegacyCheckout.selector);
        new ServiceLoyaltyMigration(address(otherToken), address(legacy));
        vm.expectRevert(ServiceLoyaltyMigration.InvalidLegacyCheckout.selector);
        new ServiceLoyaltyMigration(address(token), address(0));
    }
}
