/** Customer-facing inbound SKU; strip only this order's known customer prefix. */
export declare function inboundCustomerSku(item: {
    sku?: string | null;
    customerSku?: string | null;
}, customerCode?: string | null): string;
