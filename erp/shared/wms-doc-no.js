"use strict";
/** 易仓同款单号：入库 RV{客户}-{YYMMDD}-{序号}，出库 DO{客户}-{YYMMDD}-{序号}，箱唛 RV{客户}-{YYMMDD}-{箱序号} */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WMS_FALLBACK_CUSTOMER = void 0;
exports.sanitizeWmsCustomerCode = sanitizeWmsCustomerCode;
exports.resolveWmsCustomerCode = resolveWmsCustomerCode;
exports.wmsDocYymmdd = wmsDocYymmdd;
exports.inboundNoPrefix = inboundNoPrefix;
exports.outboundNoPrefix = outboundNoPrefix;
exports.nextSeqFromNos = nextSeqFromNos;
exports.buildInboundNo = buildInboundNo;
exports.buildOutboundNo = buildOutboundNo;
exports.rvDocPrefix = rvDocPrefix;
exports.buildCartonCode = buildCartonCode;
exports.isGeneratedCartonCode = isGeneratedCartonCode;
exports.parseWmsScan = parseWmsScan;
exports.inboundNoFromScan = inboundNoFromScan;
exports.isOutboundDocNo = isOutboundDocNo;
exports.matchCartonByScan = matchCartonByScan;
exports.WMS_FALLBACK_CUSTOMER = 'TKL';
function sanitizeWmsCustomerCode(value) {
    const raw = String(value || '').trim().toUpperCase();
    if (!raw || raw === '—' || raw === '-')
        return '';
    return raw.replace(/[^A-Z0-9]/g, '').slice(0, 16);
}
function resolveWmsCustomerCode(value) {
    return sanitizeWmsCustomerCode(value) || exports.WMS_FALLBACK_CUSTOMER;
}
function wmsDocYymmdd(date = new Date()) {
    const y = String(date.getFullYear() % 100).padStart(2, '0');
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
}
function padSeq(seq) {
    const n = Math.max(1, Math.floor(Number(seq) || 1));
    return String(n).padStart(4, '0');
}
function inboundNoPrefix(customerCode, date = new Date()) {
    return `RV${resolveWmsCustomerCode(customerCode)}-${wmsDocYymmdd(date)}-`;
}
function outboundNoPrefix(customerCode, date = new Date()) {
    return `DO${resolveWmsCustomerCode(customerCode)}-${wmsDocYymmdd(date)}-`;
}
function nextSeqFromNos(existingNos, prefix) {
    const needle = prefix.toUpperCase();
    let max = 0;
    for (const raw of existingNos) {
        const no = String(raw || '').trim().toUpperCase();
        if (!no.startsWith(needle))
            continue;
        const seq = Number.parseInt(no.slice(needle.length), 10);
        if (Number.isFinite(seq))
            max = Math.max(max, seq);
    }
    return max + 1;
}
function buildInboundNo(customerCode, date = new Date(), seq = 1) {
    return `${inboundNoPrefix(customerCode, date)}${padSeq(seq)}`;
}
function buildOutboundNo(customerCode, date = new Date(), seq = 1) {
    return `${outboundNoPrefix(customerCode, date)}${padSeq(seq)}`;
}
const RV_DOC_PREFIX = /^(RV[A-Z0-9]+-\d{6})-\d+$/i;
function rvDocPrefix(docNo) {
    const m = RV_DOC_PREFIX.exec(String(docNo || '').trim());
    return m ? m[1].toUpperCase() : null;
}
function cartonBaseInbound(inboundNo) {
    const raw = String(inboundNo || '').trim();
    const parsed = parseWmsScan(raw);
    if (parsed?.kind === 'carton')
        return parsed.inboundNo || raw;
    if (parsed?.kind === 'inbound_no')
        return parsed.inboundNo || parsed.value;
    return raw;
}
function buildCartonCode(inboundNo, boxSeq) {
    const seq = Math.max(1, Math.floor(Number(boxSeq) || 1));
    const raw = String(inboundNo || '').trim();
    if (!raw)
        return padSeq(seq);
    const base = cartonBaseInbound(raw);
    const prefix = rvDocPrefix(base);
    if (prefix)
        return `${prefix}-${padSeq(seq)}`;
    return `${base}-${padSeq(seq)}`;
}
function isGeneratedCartonCode(code, inboundNo, boxSeq) {
    const token = String(code || '').trim().toUpperCase();
    const inbound = String(inboundNo || '').trim().toUpperCase();
    if (!token || !inbound)
        return false;
    if (boxSeq != null && token === buildCartonCode(inbound, boxSeq).toUpperCase())
        return true;
    if (token === inbound)
        return true;
    if (token.startsWith(`${inbound}-`))
        return true;
    const prefix = rvDocPrefix(inbound);
    return Boolean(prefix && token.startsWith(`${prefix}-`) && /-\d+$/.test(token));
}
const RV_CARTON = /^(RV[A-Z0-9]+-\d{6}-\d{4})-(\d+)$/i;
const RV_INBOUND = /^(RV[A-Z0-9]+-\d{6}-\d{4})$/i;
const DO_OUTBOUND = /^(DO[A-Z0-9]+-\d{6}-\d{4})$/i;
const IPI_INBOUND = /^(IPI[A-Z0-9]+\d{6}\d{4})$/i;
const LEGACY_CARTON = /^(IN[-_][A-Z0-9-]+)-C(\d{3,})$/i;
const LEGACY_INBOUND = /^(IN[-_].+)$/i;
const LEGACY_OUTBOUND = /^(OUT[-_].+|OB[-_].+)$/i;
function parseWmsScan(raw) {
    const value = String(raw || '').trim().toUpperCase();
    if (!value)
        return null;
    const rvCarton = RV_CARTON.exec(value);
    if (rvCarton) {
        return { kind: 'carton', value, inboundNo: rvCarton[1].toUpperCase(), boxSeq: Number(rvCarton[2]) };
    }
    const rvIn = RV_INBOUND.exec(value);
    if (rvIn)
        return { kind: 'inbound_no', value, inboundNo: rvIn[1].toUpperCase() };
    const ipi = IPI_INBOUND.exec(value);
    if (ipi)
        return { kind: 'inbound_no', value, inboundNo: ipi[1].toUpperCase() };
    const dout = DO_OUTBOUND.exec(value);
    if (dout)
        return { kind: 'outbound_no', value, outboundNo: dout[1].toUpperCase() };
    const legacyCarton = LEGACY_CARTON.exec(value);
    if (legacyCarton) {
        return {
            kind: 'carton',
            value,
            inboundNo: legacyCarton[1].toUpperCase(),
            boxSeq: Number(legacyCarton[2]),
        };
    }
    if (LEGACY_INBOUND.test(value))
        return { kind: 'inbound_no', value, inboundNo: value };
    if (LEGACY_OUTBOUND.test(value))
        return { kind: 'outbound_no', value, outboundNo: value };
    return null;
}
function inboundNoFromScan(raw) {
    const parsed = parseWmsScan(raw);
    if (parsed?.kind === 'carton')
        return parsed.inboundNo || '';
    if (parsed?.kind === 'inbound_no')
        return parsed.inboundNo || parsed.value;
    return String(raw || '').trim();
}
function isOutboundDocNo(raw) {
    return parseWmsScan(raw)?.kind === 'outbound_no';
}
function matchCartonByScan(cartons, scan, inboundNo) {
    const token = String(scan || '').trim().toUpperCase();
    if (!token || !cartons.length)
        return null;
    const exact = cartons.find((c) => String(c.boxCode || '').trim().toUpperCase() === token);
    if (exact)
        return exact;
    const orderNo = String(inboundNo || '').trim().toUpperCase();
    const byGenerated = cartons.find((c) => buildCartonCode(orderNo, c.boxSeq).toUpperCase() === token);
    if (byGenerated)
        return byGenerated;
    const parsed = parseWmsScan(token);
    if (parsed?.kind === 'carton' && parsed.inboundNo === orderNo) {
        return cartons.find((c) => c.boxSeq === parsed.boxSeq) || null;
    }
    const scanPrefix = rvDocPrefix(token);
    const orderPrefix = rvDocPrefix(orderNo);
    if (scanPrefix && scanPrefix === orderPrefix) {
        const seq = Number.parseInt(token.slice(token.lastIndexOf('-') + 1), 10);
        if (Number.isFinite(seq))
            return cartons.find((c) => c.boxSeq === seq) || null;
    }
    const cSuffix = token.match(/-C(\d{3,})$/);
    if (cSuffix) {
        const seq = Number(cSuffix[1]);
        return cartons.find((c) => c.boxSeq === seq || String(c.boxCode || '').toUpperCase().endsWith(cSuffix[0])) || null;
    }
    return null;
}
//# sourceMappingURL=wms-doc-no.js.map