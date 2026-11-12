export type SkuDisplayValue = string | null | undefined | {
    sku?: string | number | null;
    internalSku?: string | null;
    customerSku?: string | null;
    customerCode?: string | null;
    omsCustomerCode?: string | null;
    _raw?: {
        customerSku?: string | null;
        customerCode?: string | null;
    };
};
/** Presentation only. Keep the original SKU as the option value/API identity. */
export declare function displaySku(value: SkuDisplayValue, customerCode?: string | null): string;
/** Summaries and UI feedback can contain several internal SKUs. */
export declare function displaySkuText(value: unknown): string;
export declare function formatSku(row: SkuDisplayValue, column?: {
    property?: string;
}, value?: string): string;
