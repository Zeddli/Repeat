// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {LoyaltyCheckout} from "./LoyaltyCheckout.sol";

interface ILegacyCheckout {
    function paymentToken() external view returns (address);
    function offer(address merchant, bytes32 sku) external view returns (LoyaltyCheckout.Offer memory);
    function orders(address buyer, bytes32 orderId) external view returns (LoyaltyCheckout.PaidOrder memory);
}

/// @notice Service-scoped checkout preserving offers and entitlements from a fixed earlier checkout.
/// @dev History is credited from verified paid orders, never from the old merchant-wide aggregate.
contract ServiceLoyaltyMigration is LoyaltyCheckout {
    error InvalidLegacyCheckout();
    error UnknownLegacyOrder();

    address public immutable previousCheckout;
    mapping(address buyer => mapping(bytes32 orderId => bool)) public historyImported;

    event HistoryImported(
        address indexed buyer, address indexed merchant, bytes32 indexed orderId, bytes32 sku, uint256 amount
    );

    constructor(address token, address previous) LoyaltyCheckout(token) {
        if (previous.code.length == 0 || ILegacyCheckout(previous).paymentToken() != token) {
            revert InvalidLegacyCheckout();
        }
        previousCheckout = previous;
    }

    /// @notice Anyone may relay actual old order IDs; each buyer/order is credited at most once.
    /// @dev No token transfer occurs. The immutable source binds buyer, merchant, SKU and net amount.
    function importHistory(address buyer, bytes32[] calldata orderIds) external {
        ILegacyCheckout source = ILegacyCheckout(previousCheckout);
        for (uint256 i; i < orderIds.length; ++i) {
            bytes32 orderId = orderIds[i];
            if (historyImported[buyer][orderId]) continue;
            PaidOrder memory paid = source.orders(buyer, orderId);
            if (paid.merchant == address(0) || paid.amount == 0) revert UnknownLegacyOrder();
            historyImported[buyer][orderId] = true;
            Stats storage history = _stats[buyer][paid.merchant][paid.sku];
            history.paid += paid.amount;
            history.purchaseCount += 1;
            emit HistoryImported(buyer, paid.merchant, orderId, paid.sku, paid.amount);
        }
    }

    function _terms(address merchant, bytes32 sku) internal view override returns (Offer memory terms) {
        terms = super._terms(merchant, sku);
        if (terms.version == 0) terms = ILegacyCheckout(previousCheckout).offer(merchant, sku);
    }

    function _paidOrder(address buyer, bytes32 orderId) internal view override returns (PaidOrder memory paid) {
        paid = super._paidOrder(buyer, orderId);
        if (paid.amount == 0) paid = ILegacyCheckout(previousCheckout).orders(buyer, orderId);
    }

    function _wasUsed(address buyer, bytes32 orderId) internal view override returns (bool) {
        return super._wasUsed(buyer, orderId) || ILegacyCheckout(previousCheckout).orders(buyer, orderId).amount > 0;
    }
}
