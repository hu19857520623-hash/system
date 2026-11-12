/** 50×50mm SKU 标签：二维码 + 编码文本（ERP 前端 / 后端共用布局） */
export interface BarcodeLabelInput {
    /** 条码内容，如 TKL-TK-99001（货盘）或 TKL0001-SKU-xxx（客户持有） */
    code: string;
    /** 同一条码打印份数 */
    copies?: number;
}
export declare function escapeHtml(value: string): string;
/** 解析条码：优先 barcode 字段，否则 customerCode + sku */
export declare function resolveBarcodeLabelCode(input: {
    sku: string;
    customerCode?: string;
    barcode?: string;
}): string;
export declare const BARCODE_LABEL_STYLE = "@page{size:50mm 50mm;margin:0}\n*{box-sizing:border-box}\nhtml,body{margin:0;padding:0;background:#fff;color:#000;font-family:Arial,Helvetica,sans-serif}\nbody{display:block}\n.label{width:50mm;height:50mm;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2mm 2mm 1.5mm;overflow:hidden;page-break-after:always}\n.barcode-wrap{flex:1 1 auto;display:flex;align-items:center;justify-content:center;width:100%;min-height:0;max-height:40mm}\n.barcode-wrap svg{width:38mm;height:38mm;display:block}\n.code{margin:1mm 0 0;padding:0;font:700 9px/1.15 Arial,Helvetica,sans-serif;text-align:center;letter-spacing:.02em;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}\n@media print{html,body{width:50mm;height:50mm}.label{page-break-inside:avoid}}";
export declare function buildBarcodeLabelArticle(code: string, svgMarkup: string): string;
export declare function buildBarcodeLabelHtml(articles: string, title?: string): string;
export declare function normalizeBarcodeLabelCopies(copies?: number): number;
