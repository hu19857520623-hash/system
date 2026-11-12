/** 易仓同款单号：入库 RV{客户}-{YYMMDD}-{序号}，出库 DO{客户}-{YYMMDD}-{序号}，箱唛 RV{客户}-{YYMMDD}-{箱序号} */
export declare const WMS_FALLBACK_CUSTOMER = "TKL";
export type WmsScanKind = 'inbound_no' | 'outbound_no' | 'carton';
export interface WmsScanHit {
    kind: WmsScanKind;
    value: string;
    inboundNo?: string;
    outboundNo?: string;
    boxSeq?: number;
}
export declare function sanitizeWmsCustomerCode(value?: string | null): string;
export declare function resolveWmsCustomerCode(value?: string | null): string;
export declare function wmsDocYymmdd(date?: Date): string;
export declare function inboundNoPrefix(customerCode?: string | null, date?: Date): string;
export declare function outboundNoPrefix(customerCode?: string | null, date?: Date): string;
export declare function nextSeqFromNos(existingNos: string[], prefix: string): number;
export declare function buildInboundNo(customerCode?: string | null, date?: Date, seq?: number): string;
export declare function buildOutboundNo(customerCode?: string | null, date?: Date, seq?: number): string;
export declare function rvDocPrefix(docNo: string): string | null;
/** 箱唛：入库单号-箱序号，例如 RVFUR-260921-0001-1 / -2 / -3。 */
export declare function buildCartonCode(inboundNo: string, boxSeq: number): string;
export declare function isGeneratedCartonCode(code: string, inboundNo: string, boxSeq?: number): boolean;
export declare function parseWmsScan(raw: string): WmsScanHit | null;
export declare function inboundNoFromScan(raw: string): string;
export declare function isOutboundDocNo(raw: string): boolean;
export declare function matchCartonByScan<T extends {
    boxCode: string;
    boxSeq: number;
}>(cartons: T[], scan: string, inboundNo: string): T | null;
