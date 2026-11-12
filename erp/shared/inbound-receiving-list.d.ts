/** 易仓同款入库清单 / Packing List HTML（A4）。条码为入库单号 RVAFU0430-260910-0002 及箱码 -1。 */
export type InboundReceivingListBox = {
    boxNo: number;
    boxCode?: string;
    expectedQty: number;
    receivedQty?: number | null;
};
export type InboundReceivingListSku = {
    sku: string;
    name: string;
    ref?: string;
    customCode?: string;
    firstArrival?: boolean;
    weightKg?: number | null;
    lengthCm?: number | null;
    widthCm?: number | null;
    heightCm?: number | null;
    boxes: InboundReceivingListBox[];
};
export type InboundReceivingListDoc = {
    inboundNo: string;
    createdAt: string;
    shipWarehouse: string;
    destWarehouse: string;
    customerCode: string;
    trackingNo?: string;
    referenceNo?: string;
    dutyType?: string;
    customsType?: string;
    remark?: string;
    csRemark?: string;
    printedAt: string;
    skus: InboundReceivingListSku[];
};
export declare function printInboundWarehouseCode(code?: string | null): string;
export declare function formatInboundListDateTime(value?: Date | string | null): string;
export declare function buildInboundReceivingListHtml(doc: InboundReceivingListDoc): string;
export declare function groupReceivingListSkus(input: {
    inboundNo: string;
    items: Array<{
        sku: string;
        name?: string;
        expectedQty?: number;
        actualQty?: number | null;
        ref?: string;
        customCode?: string;
        firstArrival?: boolean;
        weightKg?: number | null;
        lengthCm?: number | null;
        widthCm?: number | null;
        heightCm?: number | null;
        boxNo?: number;
    }>;
    cartons?: Array<{
        boxSeq?: number;
        boxCode?: string;
        items?: Array<{
            sku: string;
            qty?: number;
        }>;
    }>;
}): InboundReceivingListSku[];
