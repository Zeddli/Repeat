// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Atomic payments and seller-scoped loyalty for one immutable demo currency.
/// @dev Paid history proves checkout payments, not delivery, reputation or unique demand.
contract LegacyLoyaltyCheckout is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Offer {
        uint256 basePrice;
        uint256 spendThreshold;
        uint16 discountBps;
        uint64 version;
        bool enabled;
    }

    struct Stats {
        uint256 paid;
        uint256 purchaseCount;
    }

    struct PaidOrder {
        address merchant;
        bytes32 sku;
        uint256 amount;
        uint64 offerVersion;
    }

    struct Quote {
        uint256 price;
        uint16 appliedBps;
        uint256 priorPaid;
        uint256 purchaseCount;
        uint64 offerVersion;
    }

    error InvalidPaymentToken();
    error InvalidOffer();
    error OfferDisabled();
    error DuplicateOrder();
    error StaleOffer();
    error ExpiredQuote();
    error AmountExceedsMaximum();

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

    IERC20 public immutable paymentToken;

    mapping(address merchant => mapping(bytes32 sku => Offer)) private _offers;
    mapping(address buyer => mapping(address merchant => Stats)) private _stats;
    mapping(address buyer => mapping(bytes32 orderId => PaidOrder)) private _orders;
    mapping(address buyer => mapping(bytes32 orderId => bool)) private _used;

    constructor(address token) {
        if (token.code.length == 0) revert InvalidPaymentToken();
        paymentToken = IERC20(token);
    }

    /// @notice Each merchant publishes policies only in its own address bucket.
    function setOffer(bytes32 sku, uint256 basePrice, uint256 spendThreshold, uint16 discountBps, bool enabled)
        external
    {
        if (basePrice == 0 || spendThreshold == 0 || discountBps > 2000) revert InvalidOffer();
        uint64 version = _offers[msg.sender][sku].version + 1;
        _offers[msg.sender][sku] = Offer(basePrice, spendThreshold, discountBps, version, enabled);
    }

    function offer(address merchant, bytes32 sku) external view returns (Offer memory) {
        return _offers[merchant][sku];
    }

    /// @notice Price uses prior net payments across all SKUs at the same merchant.
    function preview(address buyer, address merchant, bytes32 sku)
        external
        view
        returns (uint256 price, uint16 appliedBps, uint256 priorPaid, uint256 purchaseCount, uint64 offerVersion)
    {
        Quote memory quote = _quote(buyer, merchant, sku);
        return (quote.price, quote.appliedBps, quote.priorPaid, quote.purchaseCount, quote.offerVersion);
    }

    /// @notice The immediate caller pays and owns the resulting history and entitlement.
    /// @dev A failed transfer reverts the order marker, entitlement and paid statistics atomically.
    function checkout(
        address merchant,
        bytes32 sku,
        bytes32 orderId,
        uint256 maxAmount,
        uint64 expectedVersion,
        uint256 deadline
    ) external nonReentrant {
        // Timestamp is the explicit quote expiry bound, not a randomness source.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > deadline) revert ExpiredQuote();
        if (_used[msg.sender][orderId]) revert DuplicateOrder();
        Quote memory quote = _quote(msg.sender, merchant, sku);
        if (quote.offerVersion != expectedVersion) revert StaleOffer();
        if (quote.price > maxAmount) revert AmountExceedsMaximum();

        _used[msg.sender][orderId] = true;
        _stats[msg.sender][merchant] = Stats(quote.priorPaid + quote.price, quote.purchaseCount + 1);
        _orders[msg.sender][orderId] = PaidOrder(merchant, sku, quote.price, quote.offerVersion);
        paymentToken.safeTransferFrom(msg.sender, merchant, quote.price);

        _emitPayment(merchant, sku, orderId, quote);
    }

    function stats(address buyer, address merchant) external view returns (Stats memory) {
        return _stats[buyer][merchant];
    }

    /// @notice Absent orders return a zero merchant and amount.
    function orders(address buyer, bytes32 orderId) external view returns (PaidOrder memory) {
        return _orders[buyer][orderId];
    }

    function _quote(address buyer, address merchant, bytes32 sku) private view returns (Quote memory quote) {
        Offer storage terms = _offers[merchant][sku];
        if (!terms.enabled) revert OfferDisabled();
        Stats storage history = _stats[buyer][merchant];
        quote.priorPaid = history.paid;
        quote.purchaseCount = history.purchaseCount;
        quote.offerVersion = terms.version;
        quote.appliedBps = history.paid >= terms.spendThreshold ? terms.discountBps : 0;
        quote.price = terms.basePrice - Math.mulDiv(terms.basePrice, quote.appliedBps, 10_000);
    }

    function _emitPayment(address merchant, bytes32 sku, bytes32 orderId, Quote memory quote) private {
        emit OrderPaid(
            msg.sender,
            merchant,
            orderId,
            sku,
            _offers[merchant][sku].basePrice,
            quote.price,
            quote.appliedBps,
            quote.priorPaid,
            quote.priorPaid + quote.price,
            quote.offerVersion
        );
    }
}
