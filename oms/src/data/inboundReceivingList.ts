/** 易仓同款入库清单 / Packing List HTML（A4）。与 erp/shared/inbound-receiving-list.ts 保持一致。 */

import { code128Svg } from './code128'
import { buildCartonCode } from './wmsDocNo'

export type InboundReceivingListBox = {
  boxNo: number
  boxCode?: string
  expectedQty: number
  receivedQty?: number | null
}

export type InboundReceivingListSku = {
  sku: string
  name: string
  ref?: string
  customCode?: string
  firstArrival?: boolean
  weightKg?: number | null
  lengthCm?: number | null
  widthCm?: number | null
  heightCm?: number | null
  boxes: InboundReceivingListBox[]
}

export type InboundReceivingListDoc = {
  inboundNo: string
  createdAt: string
  shipWarehouse: string
  destWarehouse: string
  customerCode: string
  trackingNo?: string
  referenceNo?: string
  dutyType?: string
  customsType?: string
  remark?: string
  csRemark?: string
  printedAt: string
  skus: InboundReceivingListSku[]
}

export function printInboundWarehouseCode(code?: string | null): string {
  const raw = String(code || '').trim()
  if (!raw || /^jhb/i.test(raw)) return 'TKL'
  return raw.toUpperCase()
}

export function formatInboundListDateTime(value?: Date | string | null): string {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    return String(value).replace('T', ' ').slice(0, 19)
  }
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function escapeHtml(value: string) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatWeight(value?: number | null) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return ''
  return n.toFixed(3)
}

function formatDims(sku: InboundReceivingListSku) {
  const l = Number(sku.lengthCm)
  const w = Number(sku.widthCm)
  const h = Number(sku.heightCm)
  if (![l, w, h].every((n) => Number.isFinite(n) && n > 0)) return ''
  return `${l.toFixed(2)}*${w.toFixed(2)}*${h.toFixed(2)}`
}

function truncateName(name: string, max = 16) {
  const text = String(name || '').trim()
  if (text.length <= max) return text
  return `${text.slice(0, max)}...`
}

function boxCodeOf(inboundNo: string, box: InboundReceivingListBox) {
  return String(box.boxCode || '').trim() || buildCartonCode(inboundNo, box.boxNo)
}

const STYLE = `@page{size:A4;margin:10mm}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff;color:#000;font:12px/1.4 Arial,"Microsoft YaHei","PingFang SC",sans-serif}
.sheet{min-height:270mm;page-break-after:always}
.sheet:last-child{page-break-after:auto}
.head{display:flex;align-items:flex-start;gap:8mm;margin-bottom:3mm}
.barcode-wrap{width:68mm;height:14mm;flex:0 0 68mm}
.barcode-wrap svg{width:68mm;height:14mm;display:block}
.title{flex:1;margin:2mm 0 0;font:700 28px/1.1 Arial,"Microsoft YaHei",sans-serif;text-align:center}
.page-flag{margin:0;font:400 12px/1 Arial,sans-serif;white-space:nowrap}
.meta{display:grid;grid-template-columns:1fr 1fr;column-gap:12mm;row-gap:1px;margin:0 0 6px;font-size:12px}
.meta span{color:#111}
table.grid{width:100%;border-collapse:collapse;table-layout:fixed}
table.grid th,table.grid td{border:1px solid #000;padding:5px 6px;vertical-align:middle;text-align:center}
table.grid th{font-weight:700;background:#fff}
.sku-info{text-align:left;font-size:12px;line-height:1.45}
.sku-info .line{white-space:nowrap}
.sku-info .name{border-bottom:1px solid #333;padding-bottom:2px;margin-bottom:4px}
.sku-info .flag{margin-top:10px}
.num{width:36px}
.weight{width:72px}
.dims{width:110px}
.box{width:48px}
.qty{width:58px}
.recv{width:58px}
.foot{display:flex;justify-content:space-between;align-items:flex-end;margin-top:10px;font-size:12px}
.pack-head{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:2mm}
.pack-title{margin:4mm 0 0;font:700 28px/1 Arial,sans-serif;flex:1;text-align:center}
.pack-badge{display:flex;align-items:stretch;margin-top:1mm}
.pack-a{width:18mm;height:14mm;background:#000;color:#fff;font:700 32px/14mm Arial,sans-serif;text-align:center}
.pack-n{width:18mm;height:14mm;border:1px solid #000;border-left:0;font:700 13px/14mm Arial,sans-serif;text-align:center}
.pack-meta{display:flex;justify-content:space-between;align-items:flex-end;margin:1mm 0 4mm;font-size:12px}
.pack-ref{margin-top:6px}
.pack-bottom{margin-top:8px;text-align:right;font:700 18px/1 Arial,sans-serif}
@media print{html,body{width:auto}.sheet{min-height:0}}`

function skuInfoHtml(sku: InboundReceivingListSku) {
  return `<div class="sku-info">
    <div class="line">sku: ${escapeHtml(sku.sku)}</div>
    <div class="line name">name: ${escapeHtml(truncateName(sku.name))}</div>
    <div class="line">ref: ${escapeHtml(sku.ref || '')}</div>
    ${sku.firstArrival ? '<div class="flag">首次到货</div>' : ''}
  </div>`
}

function receivingSheet(doc: InboundReceivingListDoc) {
  const inboundNo = String(doc.inboundNo || '').trim()
  const rows = doc.skus.map((sku, index) => {
    const boxes = sku.boxes.length ? sku.boxes : [{ boxNo: 1, expectedQty: 0 }]
    const span = boxes.length
    return boxes.map((box, boxIndex) => {
      const head = boxIndex === 0
        ? `<td class="num" rowspan="${span}">${index + 1}</td>
           <td rowspan="${span}">${skuInfoHtml(sku)}</td>
           <td class="weight" rowspan="${span}">${escapeHtml(formatWeight(sku.weightKg))}</td>
           <td class="dims" rowspan="${span}">${escapeHtml(formatDims(sku))}</td>`
        : ''
      return `<tr>
        ${head}
        <td class="box">${box.boxNo}</td>
        <td class="qty">${box.expectedQty || ''}</td>
        <td class="recv">${box.receivedQty == null ? '' : box.receivedQty}</td>
      </tr>`
    }).join('')
  }).join('')

  const boxTotal = doc.skus.reduce((max, sku) => {
    const local = sku.boxes.reduce((m, box) => Math.max(m, box.boxNo), 0)
    return Math.max(max, local)
  }, 0)

  return `<section class="sheet">
  <div class="head">
    <div class="barcode-wrap">${code128Svg(inboundNo, 40)}</div>
    <h1 class="title">入库清单</h1>
    <p class="page-flag">1/1 P</p>
  </div>
  <div class="meta">
    <div>入库单: ${escapeHtml(inboundNo)}</div>
    <div>创建时间: ${escapeHtml(doc.createdAt || '')}</div>
    <div>交货仓库/目的仓库: ${escapeHtml(doc.shipWarehouse || 'TKL')}/${escapeHtml(doc.destWarehouse || 'TKL')}</div>
    <div>客户代码: ${escapeHtml(doc.customerCode || '')}</div>
    <div>跟踪号: ${escapeHtml(doc.trackingNo || '')}</div>
    <div>参考号: ${escapeHtml(doc.referenceNo || '')}</div>
    <div>关税类型: ${escapeHtml(doc.dutyType || '')}</div>
    <div>报关类型: ${escapeHtml(doc.customsType || '')}</div>
    <div>备注: ${escapeHtml(doc.remark || '')}</div>
    <div></div>
  </div>
  <table class="grid">
    <thead>
      <tr>
        <th class="num">NO.</th>
        <th>Sku Information</th>
        <th class="weight">产品单重 /<br/>KG</th>
        <th class="dims">长*宽*高 / CM</th>
        <th class="box">箱号</th>
        <th class="qty">预期数</th>
        <th class="recv">收货数</th>
      </tr>
    </thead>
    <tbody>${rows || '<tr><td colspan="7">暂无明细</td></tr>'}</tbody>
  </table>
  <div class="foot">
    <div>客服备注: ${escapeHtml(doc.csRemark || '')}<br/>打印时间： ${escapeHtml(doc.printedAt || '')}</div>
    <div>总箱数: ${boxTotal}</div>
    <div>收货日期:____________</div>
  </div>
</section>`
}

function packingSheets(doc: InboundReceivingListDoc) {
  const inboundNo = String(doc.inboundNo || '').trim()
  const byBox = new Map<number, { box: InboundReceivingListBox; lines: { sku: string; customCode?: string; name: string; qty: number }[] }>()
  for (const sku of doc.skus) {
    for (const box of sku.boxes) {
      const current = byBox.get(box.boxNo) || { box, lines: [] }
      current.lines.push({
        sku: sku.sku,
        customCode: sku.customCode,
        name: sku.name,
        qty: box.expectedQty,
      })
      byBox.set(box.boxNo, current)
    }
  }
  const pages = [...byBox.entries()].sort((a, b) => a[0] - b[0])
  const total = pages.length || 1
  if (!pages.length) return ''

  return pages.map(([boxNo, page], index) => {
    const cartonCode = boxCodeOf(inboundNo, { ...page.box, boxNo })
    const rows = page.lines.map((line, lineIndex) => `<tr>
      <td>${lineIndex + 1}</td>
      <td>${escapeHtml(line.sku)}</td>
      <td>${escapeHtml(line.customCode || '')}</td>
      <td>${escapeHtml(line.name)}</td>
      <td>${line.qty}</td>
    </tr>`).join('')
    return `<section class="sheet">
  <div class="pack-head">
    <div class="barcode-wrap">${code128Svg(cartonCode, 40)}</div>
    <h1 class="pack-title">Packing List</h1>
    <div class="pack-badge">
      <div class="pack-a">A</div>
      <div class="pack-n">${total}pack</div>
    </div>
    <p class="page-flag">${index + 1}/${total} P</p>
  </div>
  <div class="pack-meta">
    <div>RO:${escapeHtml(cartonCode)}</div>
    <div>Wh:${escapeHtml(doc.destWarehouse || 'TKL')}</div>
    <div>Customer<br/>Code : ${escapeHtml(doc.customerCode || '')}</div>
  </div>
  <table class="grid">
    <thead>
      <tr>
        <th class="num">No.</th>
        <th>Product Code</th>
        <th>Custom coding</th>
        <th>Product Name</th>
        <th class="qty">Qty</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="pack-ref">Ref No : ${escapeHtml(doc.referenceNo || '')}</div>
  <div class="pack-bottom">${index + 1} / ${total} b</div>
</section>`
  }).join('')
}

export function buildInboundReceivingListHtml(doc: InboundReceivingListDoc) {
  const inboundNo = String(doc.inboundNo || '').trim() || 'inbound'
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>入库清单 ${escapeHtml(inboundNo)}</title>
<style>${STYLE}</style></head><body>
${receivingSheet(doc)}
${packingSheets(doc)}
<script>window.onload=function(){window.print()}<\/script>
</body></html>`
}

export function groupReceivingListSkus(input: {
  inboundNo: string
  items: Array<{
    sku: string
    name?: string
    expectedQty?: number
    actualQty?: number | null
    ref?: string
    customCode?: string
    firstArrival?: boolean
    weightKg?: number | null
    lengthCm?: number | null
    widthCm?: number | null
    heightCm?: number | null
    boxNo?: number
  }>
  cartons?: Array<{
    boxSeq?: number
    boxCode?: string
    items?: Array<{ sku: string; qty?: number }>
  }>
}): InboundReceivingListSku[] {
  const inboundNo = String(input.inboundNo || '').trim()
  const bySku = new Map<string, InboundReceivingListSku>()

  const ensure = (item: (typeof input.items)[number]) => {
    const sku = String(item.sku || '').trim()
    if (!sku) return null
    const current = bySku.get(sku) || {
      sku,
      name: item.name || sku,
      ref: item.ref || '',
      customCode: item.customCode || '',
      firstArrival: !!item.firstArrival,
      weightKg: item.weightKg ?? null,
      lengthCm: item.lengthCm ?? null,
      widthCm: item.widthCm ?? null,
      heightCm: item.heightCm ?? null,
      boxes: [],
    }
    if (!current.name && item.name) current.name = item.name
    if (item.firstArrival) current.firstArrival = true
    if (item.weightKg != null) current.weightKg = item.weightKg
    if (item.lengthCm != null) current.lengthCm = item.lengthCm
    if (item.widthCm != null) current.widthCm = item.widthCm
    if (item.heightCm != null) current.heightCm = item.heightCm
    bySku.set(sku, current)
    return current
  }

  for (const item of input.items || []) ensure(item)

  const cartons = (input.cartons || []).filter((c) => (c.items || []).length)
  if (cartons.length) {
    for (const carton of cartons) {
      const boxNo = Math.max(1, Number(carton.boxSeq) || 1)
      const boxCode = String(carton.boxCode || '').trim() || buildCartonCode(inboundNo, boxNo)
      for (const line of carton.items || []) {
        const sku = String(line.sku || '').trim()
        if (!sku) continue
        const current = bySku.get(sku) || ensure({ sku, name: sku })
        if (!current) continue
        current.boxes.push({
          boxNo,
          boxCode,
          expectedQty: Math.max(0, Number(line.qty) || 0),
        })
      }
    }
  } else {
    for (const item of input.items || []) {
      const current = ensure(item)
      if (!current) continue
      current.boxes.push({
        boxNo: Math.max(1, Number(item.boxNo) || 1),
        boxCode: buildCartonCode(inboundNo, Math.max(1, Number(item.boxNo) || 1)),
        expectedQty: Math.max(0, Number(item.expectedQty) || 0),
        receivedQty: item.actualQty ?? null,
      })
    }
  }

  return [...bySku.values()].map((sku) => ({
    ...sku,
    boxes: sku.boxes.sort((a, b) => a.boxNo - b.boxNo),
  }))
}
