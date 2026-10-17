import { parseAbi } from 'viem';
export const checkoutAbi=parseAbi([
 'error StaleOffer()',
 'error ExpiredQuote()',
 'error DuplicateOrder()',
 'error OfferDisabled()',
 'error AmountExceedsMaximum()',
 'function loyaltyScope() pure returns (bytes32)',
 'function paymentToken() view returns (address)',
 'function setOffer(bytes32 sku, uint256 basePrice, uint256 spendThreshold, uint16 discountBps, bool enabled)',
 'function offer(address merchant, bytes32 sku) view returns ((uint256 basePrice, uint256 spendThreshold, uint16 discountBps, uint64 version, bool enabled))',
 'function preview(address buyer, address merchant, bytes32 sku) view returns (uint256 price, uint16 appliedBps, uint256 priorPaid, uint256 purchaseCount, uint64 offerVersion)',
 'function checkout(address merchant, bytes32 sku, bytes32 orderId, uint256 maxAmount, uint64 expectedVersion, uint256 deadline)',
 'function stats(address buyer, address merchant, bytes32 sku) view returns ((uint256 paid, uint256 purchaseCount))',
 'function orders(address buyer, bytes32 orderId) view returns ((address merchant, bytes32 sku, uint256 amount, uint64 offerVersion))',
 'event OrderPaid(address indexed buyer, address indexed merchant, bytes32 indexed orderId, bytes32 sku, uint256 basePrice, uint256 amount, uint16 appliedBps, uint256 priorPaid, uint256 newPaid, uint64 offerVersion)'
]);
export const tokenAbi=parseAbi([
 'function balanceOf(address) view returns (uint256)',
 'function allowance(address,address) view returns (uint256)',
 'function approve(address,uint256) returns (bool)',
 'function mint(address,uint256)',
 'function decimals() view returns (uint8)'
]);
