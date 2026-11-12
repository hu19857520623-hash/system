"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inboundCustomerSku = inboundCustomerSku;
/** Customer-facing inbound SKU; strip only this order's known customer prefix. */
function inboundCustomerSku(item, customerCode) {
    const custom = String(item.customerSku || '').trim();
    if (custom)
        return custom;
    const sku = String(item.sku || '').trim();
    const prefix = `${String(customerCode || '').trim()}-`;
    return prefix.length > 1 && sku.toUpperCase().startsWith(prefix.toUpperCase())
        ? sku.slice(prefix.length)
        : sku;
}
//# sourceMappingURL=inbound-customer-sku.js.map