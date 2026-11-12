"use strict";
/** 50×50mm SKU 标签：二维码 + 编码文本（ERP 前端 / 后端共用布局） */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BARCODE_LABEL_STYLE = void 0;
exports.escapeHtml = escapeHtml;
exports.resolveBarcodeLabelCode = resolveBarcodeLabelCode;
exports.buildBarcodeLabelArticle = buildBarcodeLabelArticle;
exports.buildBarcodeLabelHtml = buildBarcodeLabelHtml;
exports.normalizeBarcodeLabelCopies = normalizeBarcodeLabelCopies;
function escapeHtml(value) {
    return value.replace(/[<>&"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[char] || char));
}
/** 解析条码：优先 barcode 字段，否则 customerCode + sku */
function resolveBarcodeLabelCode(input) {
    const explicit = String(input.barcode || '').trim();
    if (explicit)
        return explicit;
    const sku = String(input.sku || '').trim();
    if (!sku)
        return '';
    const code = String(input.customerCode || '').trim().toUpperCase();
    if (!code && sku.toUpperCase().startsWith('TKL-')) {
        return sku;
    }
    if (code && !sku.toUpperCase().startsWith(`${code}-`)) {
        return `${code}-${sku}`;
    }
    return sku;
}
exports.BARCODE_LABEL_STYLE = `@page{size:50mm 50mm;margin:0}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff;color:#000;font-family:Arial,Helvetica,sans-serif}
body{display:block}
.label{width:50mm;height:50mm;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2mm 2mm 1.5mm;overflow:hidden;page-break-after:always}
.barcode-wrap{flex:1 1 auto;display:flex;align-items:center;justify-content:center;width:100%;min-height:0;max-height:40mm}
.barcode-wrap svg{width:38mm;height:38mm;display:block}
.code{margin:1mm 0 0;padding:0;font:700 9px/1.15 Arial,Helvetica,sans-serif;text-align:center;letter-spacing:.02em;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}
@media print{html,body{width:50mm;height:50mm}.label{page-break-inside:avoid}}`;
function buildBarcodeLabelArticle(code, svgMarkup) {
    return `<article class="label"><div class="barcode-wrap">${svgMarkup}</div><p class="code">${escapeHtml(code)}</p></article>`;
}
function buildBarcodeLabelHtml(articles, title = '条码标签') {
    return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${exports.BARCODE_LABEL_STYLE}</style></head><body>${articles}</body></html>`;
}
function normalizeBarcodeLabelCopies(copies) {
    return Math.max(1, Math.min(Number(copies) || 1, 500));
}
//# sourceMappingURL=barcode-label.js.map