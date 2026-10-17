// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {MockWBSC} from "../src/MockWBSC.sol";
import {LoyaltyCheckout} from "../src/LoyaltyCheckout.sol";
import {TestBase} from "./TestBase.sol";

contract ContractBuyer {
    function pay(MockWBSC token, LoyaltyCheckout checkout, address merchant, bytes32 sku) external {
        token.approve(address(checkout), 50_000);
        checkout.checkout(merchant, sku, "contract-order", 50_000, 1, block.timestamp);
    }
}

contract LoyaltyCheckoutTest is TestBase {
    MockWBSC internal token;
    LoyaltyCheckout internal checkout;
    address internal constant BUYER = address(0xB0B);
    address internal constant FRESH = address(0xF123);
    address internal constant SELLER_A = address(0xA11CE);
    address internal constant SELLER_B = address(0xB11CE);
    bytes32 internal constant SKU = keccak256("bnb-budget");
    bytes32 internal constant OTHER_SKU = keccak256("bnb-agents");

    event OrderPaid(
        address indexed buyer,
        address indexed merchant,
        bytes32 indexed orderId,
        bytes32 sku,
        uint256 basePrice,
        uint256 amount,
        uint16 appliedBps,
        uint256 priorPaid,
        uint256 newPaid,
        uint64 offerVersion
    );

    function setUp() public {
        token = new MockWBSC();
        checkout = new LoyaltyCheckout(address(token));
        token.mint(BUYER, 1_000_000);
        token.mint(FRESH, 1_000_000);
        vm.prank(BUYER);
        token.approve(address(checkout), 1_000_000);
        vm.prank(FRESH);
        token.approve(address(checkout), 1_000_000);
        vm.startPrank(SELLER_A);
        checkout.setOffer(SKU, 50_000, 150_000, 2000, true);
        checkout.setOffer(OTHER_SKU, 50_000, 150_000, 2000, true);
        vm.stopPrank();
        vm.prank(SELLER_B);
        checkout.setOffer(SKU, 55_000, 150_000, 0, true);
    }

    // Catches qualifying the third purchase from its own payment, gross-price accounting,
    // or accidentally sharing paid spend across different service SKUs.
    function testDiscountStartsOnFourthPurchaseAndMerchantReceives190000() public {
        for (uint256 i; i < 3; ++i) {
            (uint256 price, uint16 bps,,,) = checkout.preview(BUYER, SELLER_A, SKU);
            assertEq(price, 50_000, "the first three purchases must stay full price");
            assertEq(bps, 0, "spend must qualify only the next purchase");
            _buy(BUYER, SELLER_A, SKU, bytes32(i + 1), 50_000, 1);
        }
        LoyaltyCheckout.Stats memory beforeFourth = checkout.stats(BUYER, SELLER_A, SKU);
        assertEq(beforeFourth.paid, 150_000, "three actual payments establish spend");
        assertEq(beforeFourth.purchaseCount, 3, "count must track settled payments");
        (uint256 fourthPrice, uint16 fourthBps, uint256 priorPaid, uint256 count, uint64 version) =
            checkout.preview(BUYER, SELLER_A, SKU);
        assertEq(fourthPrice, 40_000, "repeated payments for this service unlock the fourth discount");
        assertEq(fourthBps, 2000, "fourth purchase has a 20 percent discount");
        assertEq(priorPaid, 150_000, "quote must disclose prior net paid spend");
        assertEq(count, 3, "quote must disclose prior purchase count");
        assertEq(version, 1, "first offer version is one");
        vm.expectEmit(true, true, true, true, address(checkout));
        emit OrderPaid(BUYER, SELLER_A, bytes32(uint256(4)), SKU, 50_000, 40_000, 2000, 150_000, 190_000, 1);
        _buy(BUYER, SELLER_A, SKU, bytes32(uint256(4)), 40_000, 1);
        LoyaltyCheckout.Stats memory finalStats = checkout.stats(BUYER, SELLER_A, SKU);
        assertEq(finalStats.paid, 190_000, "ledger must record net tokens actually paid");
        assertEq(finalStats.purchaseCount, 4, "four purchases must be recorded");
        assertEq(token.balanceOf(SELLER_A), 190_000, "merchant must receive all actual payments");
        assertEq(token.balanceOf(BUYER), 810_000, "buyer is debited actual discounted payments");
        LoyaltyCheckout.PaidOrder memory order = checkout.orders(BUYER, bytes32(uint256(4)));
        assertEq(order.merchant, SELLER_A, "order binds the paid merchant");
        assertEq(order.sku, SKU, "order binds the purchased service");
        assertEq(order.amount, 40_000, "order stores the actual paid amount");
        assertEq(order.offerVersion, 1, "order stores the accepted offer version");
    }

    function testOtherServiceAtSameSellerDoesNotInheritLoyalty() public {
        _warmUp();
        (uint256 earnedPrice, uint16 earnedBps,,,) = checkout.preview(BUYER, SELLER_A, OTHER_SKU);
        (uint256 untouchedPrice, uint16 untouchedBps, uint256 untouchedPaid, uint256 untouchedCount,) =
            checkout.preview(BUYER, SELLER_A, SKU);
        assertEq(earnedPrice, 40_000, "the repeatedly purchased service earns loyalty");
        assertEq(earnedBps, 2000, "the purchased service earns twenty percent");
        assertEq(untouchedPrice, 50_000, "a different service must remain full price");
        assertEq(untouchedBps, 0, "a different service has no discount");
        assertEq(untouchedPaid, 0, "a different service has no paid spend");
        assertEq(untouchedCount, 0, "a different service has no purchases");
        _buy(BUYER, SELLER_A, SKU, "other-service", 50_000, 1);
        (uint256 originalPrice,, uint256 originalPaid, uint256 originalCount,) =
            checkout.preview(BUYER, SELLER_A, OTHER_SKU);
        assertEq(originalPrice, 40_000, "another service purchase cannot change earned pricing");
        assertEq(originalPaid, 150_000, "another service payment cannot add to original spend");
        assertEq(originalCount, 3, "another service payment cannot add to original count");
    }

    function testFreshBuyerAndOtherMerchantDoNotInheritHistory() public {
        _warmUp();
        vm.prank(SELLER_B);
        checkout.setOffer(SKU, 55_000, 150_000, 2000, true);
        (uint256 freshPrice, uint16 freshBps, uint256 freshPaid,,) = checkout.preview(FRESH, SELLER_A, SKU);
        (uint256 otherPrice, uint16 otherBps, uint256 otherPaid,,) = checkout.preview(BUYER, SELLER_B, SKU);
        assertEq(freshPrice, 50_000, "fresh buyer must pay public A price");
        assertEq(freshBps, 0, "fresh buyer has no earned discount");
        assertEq(freshPaid, 0, "fresh buyer has no paid history");
        assertEq(otherPrice, 55_000, "A history must not discount B");
        assertEq(otherBps, 0, "other merchant history is isolated");
        assertEq(otherPaid, 0, "other merchant spend starts at zero");
    }

    function testSellerCanOnlyConfigureItsOwnOfferBucket() public {
        vm.prank(SELLER_A);
        checkout.setOffer(SKU, 60_000, 150_000, 1000, true);
        LoyaltyCheckout.Offer memory a = checkout.offer(SELLER_A, SKU);
        LoyaltyCheckout.Offer memory b = checkout.offer(SELLER_B, SKU);
        assertEq(a.basePrice, 60_000, "seller update affects its own offer");
        assertEq(a.version, 2, "configuration updates invalidate prior quotes");
        assertEq(b.basePrice, 55_000, "another merchant offer cannot be overwritten");
        assertEq(b.version, 1, "another merchant version stays unchanged");
        assertTrue(a.enabled && b.enabled, "configured offers are enabled");
    }

    function testTransferFailureRollsBackHistoryAndOrderCanBeRetried() public {
        vm.prank(BUYER);
        token.approve(address(checkout), 0);
        vm.expectRevert();
        _buy(BUYER, SELLER_A, SKU, "retry", 50_000, 1);
        _assertUnpaid("retry");
        vm.prank(BUYER);
        token.approve(address(checkout), 50_000);
        _buy(BUYER, SELLER_A, SKU, "retry", 50_000, 1);
        assertEq(checkout.orders(BUYER, "retry").amount, 50_000, "failed order ID must remain usable");
        assertEq(token.balanceOf(SELLER_A), 50_000, "retry transfers exactly once");
    }

    function testSameBuyerOrderCannotBeReplayedAtEitherMerchant() public {
        bytes32 orderId = "one-payment";
        _buy(BUYER, SELLER_A, SKU, orderId, 50_000, 1);
        vm.expectRevert(LoyaltyCheckout.DuplicateOrder.selector);
        _buy(BUYER, SELLER_A, SKU, orderId, 50_000, 1);
        vm.expectRevert(LoyaltyCheckout.DuplicateOrder.selector);
        _buy(BUYER, SELLER_B, SKU, orderId, 55_000, 1);
        assertEq(token.balanceOf(SELLER_A), 50_000, "replay must not transfer twice");
        assertEq(token.balanceOf(SELLER_B), 0, "cross merchant replay must not charge");
        assertEq(checkout.stats(BUYER, SELLER_A, SKU).paid, 50_000, "replay must not inflate history");
        assertEq(checkout.stats(BUYER, SELLER_B, SKU).purchaseCount, 0, "cross merchant replay leaves no history");
    }

    function testDifferentBuyersCanUseSameOrderId() public {
        _buy(BUYER, SELLER_A, SKU, "shared-id", 50_000, 1);
        _buy(FRESH, SELLER_A, SKU, "shared-id", 50_000, 1);
        assertEq(checkout.stats(BUYER, SELLER_A, SKU).paid, 50_000, "first buyer owns its history");
        assertEq(checkout.stats(FRESH, SELLER_A, SKU).paid, 50_000, "second buyer owns independent history");
        assertEq(checkout.orders(FRESH, "shared-id").amount, 50_000, "order scope includes buyer");
        assertEq(token.balanceOf(SELLER_A), 100_000, "both distinct buyers may pay");
    }

    function testIdentityIsImmediateSenderIncludingContractWallet() public {
        ContractBuyer wallet = new ContractBuyer();
        token.mint(address(wallet), 50_000);
        vm.prank(BUYER);
        wallet.pay(token, checkout, SELLER_A, SKU);
        assertEq(checkout.stats(address(wallet), SELLER_A, SKU).paid, 50_000, "contract sender owns paid history");
        assertEq(checkout.stats(BUYER, SELLER_A, SKU).paid, 0, "external caller cannot receive contract wallet credit");
        assertEq(
            checkout.orders(address(wallet), "contract-order").merchant,
            SELLER_A,
            "paid order must belong to immediate sender"
        );
        assertEq(token.balanceOf(address(wallet)), 0, "immediate sender funds payment");
        assertEq(token.balanceOf(BUYER), 1_000_000, "external caller is not charged");
    }

    function testStaleOfferRevertsWithoutCharging() public {
        vm.prank(SELLER_A);
        checkout.setOffer(SKU, 49_000, 150_000, 2000, true);
        vm.expectRevert(LoyaltyCheckout.StaleOffer.selector);
        _buy(BUYER, SELLER_A, SKU, "stale", 50_000, 1);
        _assertUnpaid("stale");
    }

    function testExpiredQuoteRevertsWithoutCharging() public {
        vm.warp(100);
        vm.expectRevert(LoyaltyCheckout.ExpiredQuote.selector);
        vm.prank(BUYER);
        checkout.checkout(SELLER_A, SKU, "expired", 50_000, 1, 99);
        _assertUnpaid("expired");
    }

    function testMaximumAmountRejectsPriceAboveBudget() public {
        vm.expectRevert(LoyaltyCheckout.AmountExceedsMaximum.selector);
        _buy(BUYER, SELLER_A, SKU, "over-budget", 49_999, 1);
        _assertUnpaid("over-budget");
    }

    function testDisabledAndAbsentOffersCannotQuoteOrCharge() public {
        vm.prank(SELLER_A);
        checkout.setOffer(SKU, 50_000, 150_000, 2000, false);
        vm.expectRevert(LoyaltyCheckout.OfferDisabled.selector);
        checkout.preview(BUYER, SELLER_A, SKU);
        vm.expectRevert(LoyaltyCheckout.OfferDisabled.selector);
        _buy(BUYER, SELLER_A, SKU, "disabled", 50_000, 2);
        vm.expectRevert(LoyaltyCheckout.OfferDisabled.selector);
        checkout.preview(BUYER, address(0xDEAD), SKU);
        vm.expectRevert(LoyaltyCheckout.OfferDisabled.selector);
        _buy(BUYER, address(0xDEAD), SKU, "absent", 50_000, 0);
        _assertUnpaid("disabled");
        _assertUnpaid("absent");
    }

    function testInvalidConfigurationCannotReplaceExistingOffer() public {
        vm.startPrank(SELLER_A);
        vm.expectRevert(LoyaltyCheckout.InvalidOffer.selector);
        checkout.setOffer(SKU, 0, 150_000, 2000, true);
        vm.expectRevert(LoyaltyCheckout.InvalidOffer.selector);
        checkout.setOffer(SKU, 50_000, 0, 2000, true);
        vm.expectRevert(LoyaltyCheckout.InvalidOffer.selector);
        checkout.setOffer(SKU, 50_000, 150_000, 2001, true);
        vm.stopPrank();
        assertEq(checkout.offer(SELLER_A, SKU).version, 1, "bad configuration must not invalidate existing quotes");
        assertEq(checkout.offer(SELLER_A, SKU).basePrice, 50_000, "bad configuration must preserve the old price");
    }

    function testZeroDiscountRemainsPublicPriceAfterEligibility() public {
        _warmSku();
        vm.prank(SELLER_A);
        checkout.setOffer(SKU, 50_000, 150_000, 0, true);
        (uint256 price, uint16 bps,,,) = checkout.preview(BUYER, SELLER_A, SKU);
        assertEq(price, 50_000, "zero discount is a valid public price policy");
        assertEq(bps, 0, "zero discount stays zero after eligibility");
        _buy(BUYER, SELLER_A, SKU, "zero-discount", 50_000, 2);
        assertEq(checkout.stats(BUYER, SELLER_A, SKU).paid, 200_000, "undiscounted eligible payment adds full amount");
    }

    function testDiscountRoundsDownBeforeSubtracting() public {
        _warmSku();
        vm.prank(SELLER_A);
        checkout.setOffer(SKU, 50_001, 150_000, 1999, true);
        (uint256 price, uint16 bps,,,) = checkout.preview(BUYER, SELLER_A, SKU);
        assertEq(price, 40_006, "discount must floor to 9995 then subtract from 50001");
        assertEq(bps, 1999, "quoted basis points preserve configured policy");
        _buy(BUYER, SELLER_A, SKU, "rounded", 40_006, 2);
        assertEq(checkout.stats(BUYER, SELLER_A, SKU).paid, 190_006, "rounded actual payment updates ledger");
    }

    function testPaymentTokenMustBeContract() public {
        vm.expectRevert(LoyaltyCheckout.InvalidPaymentToken.selector);
        new LoyaltyCheckout(address(0));
        vm.expectRevert(LoyaltyCheckout.InvalidPaymentToken.selector);
        new LoyaltyCheckout(BUYER);
        assertEq(address(checkout.paymentToken()), address(token), "payment token is fixed at construction");
    }

    function _warmSku() internal {
        _buy(BUYER, SELLER_A, SKU, bytes32(uint256(1)), 50_000, 1);
        _buy(BUYER, SELLER_A, SKU, bytes32(uint256(2)), 50_000, 1);
        _buy(BUYER, SELLER_A, SKU, bytes32(uint256(3)), 50_000, 1);
    }

    function _warmUp() internal {
        _buy(BUYER, SELLER_A, OTHER_SKU, bytes32(uint256(1)), 50_000, 1);
        _buy(BUYER, SELLER_A, OTHER_SKU, bytes32(uint256(2)), 50_000, 1);
        _buy(BUYER, SELLER_A, OTHER_SKU, bytes32(uint256(3)), 50_000, 1);
    }

    function _buy(address buyer, address merchant, bytes32 sku, bytes32 orderId, uint256 max, uint64 version) internal {
        vm.prank(buyer);
        checkout.checkout(merchant, sku, orderId, max, version, block.timestamp);
    }

    function _assertUnpaid(bytes32 orderId) internal view {
        LoyaltyCheckout.Stats memory state = checkout.stats(BUYER, SELLER_A, SKU);
        LoyaltyCheckout.PaidOrder memory order = checkout.orders(BUYER, orderId);
        assertEq(state.paid, 0, "rejected checkout must leave paid spend unchanged");
        assertEq(state.purchaseCount, 0, "rejected checkout must leave count unchanged");
        assertEq(order.merchant, address(0), "rejected checkout must not create an entitlement");
        assertEq(order.amount, 0, "absent order returns zero amount");
        assertEq(token.balanceOf(BUYER), 1_000_000, "rejected checkout must not debit buyer");
        assertEq(token.balanceOf(SELLER_A), 0, "rejected checkout must not credit seller");
    }
}
