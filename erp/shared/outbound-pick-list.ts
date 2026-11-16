/** Single-order downloads and batch printing share the same paper layout. */
export interface PickListOrder {
  outboundNo: string; warehouseCode: string; customerName?: string; customerCode?: string
  pickerName?: string; pickerWorkstation?: string
  items: Array<{ sku: string; productName?: string; qty: number; locationUncovered?: number
    suggestedLocations?: Array<{ locationCode: string; pickQty: number }>
    pickAllocations?: Array<{ locationCode: string; qty: number; status?: string }> }>
}
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!)

export function renderPickListHtml(orders: PickListOrder[], printedAt = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })) {
  const pages = orders.map(order => {
    const total = order.items.reduce((sum, item) => sum + item.qty, 0)
    const rows = order.items.map((item, index) => {
      const actual = (item.pickAllocations || []).filter(a => a.status !== 'cancelled')
      const locations = actual.length ? actual.map(a => ({ locationCode: a.locationCode, pickQty: a.qty })) : item.suggestedLocations || []
      const missing = item.locationUncovered || Math.max(0, item.qty - locations.reduce((sum, a) => sum + a.pickQty, 0))
      return `<tr><td class="index">${index + 1}</td><td><div class="sku">${escapeHtml(item.sku)}</div><div class="name">${escapeHtml(item.productName || '未填写品名')}</div></td>
<td>${locations.map(a => `<div class="location"><strong>${escapeHtml(a.locationCode)}</strong><span>拿 <b>${a.pickQty}</b> 件</span></div>`).join('') || '<div>待确认库位</div>'}${missing > 0 ? `<div class="warning">缺 ${missing} 件库位库存，请核对</div>` : ''}</td>
<td class="qty">${item.qty}</td><td><div class="write-line"></div></td><td class="check"><span class="checkbox"></span></td></tr>`
    }).join('')
    return `<section class="sheet"><header><div><div class="eyebrow">仓库作业 · PICK LIST</div><h1>出库拣货清单</h1></div><div class="summary"><strong>${order.items.length}</strong> 种商品 <i>/</i> <strong>${total}</strong> 件</div></header>
<div class="order-number">${escapeHtml(order.outboundNo)}</div>
<div class="meta"><div><span>客户</span><b>${escapeHtml([order.customerCode, order.customerName].filter(Boolean).join(' · ') || '—')}</b></div><div><span>仓库</span><b>${escapeHtml(order.warehouseCode)}</b></div><div><span>拣货员</span><b>${escapeHtml([order.pickerName, order.pickerWorkstation].filter(Boolean).join(' · ') || '未分配')}</b></div></div>
<p class="instruction">按库位取货 → 核对商品与数量 → 填实拣并勾选</p>
<table><colgroup><col style="width:5%"><col style="width:31%"><col style="width:32%"><col style="width:10%"><col style="width:13%"><col style="width:9%"></colgroup><thead><tr><th>序号</th><th>商品 / SKU</th><th>取货库位 · 数量</th><th>应拣</th><th>实拣</th><th>完成</th></tr></thead><tbody>${rows}</tbody></table>
<div class="notice">库位为取货参考；缺货或库位不符时，请先核对并反馈。</div>
<footer><div>拣货签名：<span class="signature"></span></div><div>完成时间：<span class="signature"></span></div></footer><div class="print-time">打印时间：${escapeHtml(printedAt)}（北京时间）</div></section>`
  }).join('')
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>出库拣货清单</title><style>
@page{size:A4;margin:14mm}*{box-sizing:border-box}body{margin:0;color:#18212b;font:13px Arial,"Microsoft YaHei",sans-serif;background:#edf0f3}.sheet{max-width:190mm;margin:24px auto;padding:10mm;background:white}header{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #202b36;padding-bottom:16px}.eyebrow{font-size:10px;letter-spacing:1.5px;color:#596571}h1{font-size:25px;margin:7px 0 0;letter-spacing:1px}.summary{white-space:nowrap;font-size:12px}.summary strong{font-size:24px}.summary i{font-style:normal;margin:0 8px;color:#888}.order-number{font:700 19px Consolas,monospace;margin:18px 0;overflow-wrap:anywhere}.meta{display:grid;grid-template-columns:1.5fr 1fr 1fr;gap:16px}.meta span{display:block;font-size:11px;color:#596571;margin-bottom:6px}.meta b{font-size:13px;overflow-wrap:anywhere}.instruction{margin:22px 0 12px;font-size:12px;font-weight:bold}table{width:100%;border-collapse:collapse;table-layout:fixed}thead{display:table-header-group}tr{break-inside:avoid}th{text-align:left;font-size:11px;background:#eef1f4;border-top:1px solid #73808c;border-bottom:1px solid #73808c;padding:11px 6px}th:first-child{white-space:nowrap;font-size:10px;padding-left:2px;padding-right:2px}td{padding:16px 6px;border-bottom:1px solid #cbd1d7;vertical-align:middle;overflow-wrap:anywhere}.index{color:#687480;text-align:center}.sku{font:700 14px Consolas,monospace;overflow-wrap:anywhere}.name{font-size:12px;margin-top:7px;line-height:1.5}.location{line-height:1.6;margin:4px 0}.location strong{display:block;font:700 14px Consolas,monospace}.location span{font-size:12px}.qty{text-align:center;font-size:23px;font-weight:bold}.check{text-align:center}.checkbox{display:inline-block;width:17px;height:17px;border:1.5px solid #47525d}.write-line{border-bottom:1px solid #687480;height:22px;margin:0 5px}.warning{font-size:11px;font-weight:bold;border:1px solid #687480;padding:5px;margin-top:6px}.notice{font-size:11px;color:#596571;margin:14px 0 30px}footer{display:flex;justify-content:space-between;gap:16px;font-size:12px;break-inside:avoid}.signature{display:inline-block;width:100px;height:18px;border-bottom:1px solid #73808c}.print-time{font-size:10px;color:#687480;margin-top:24px}.toolbar{text-align:center;padding:14px}.toolbar button{padding:10px 28px;cursor:pointer}@media print{body{background:white;color:#000}.sheet{margin:0;max-width:none;padding:0;break-after:page}.sheet:last-child{break-after:auto}.toolbar{display:none}th{background:white}}
</style></head><body><div class="toolbar"><button onclick="window.print()">打印清单</button></div>${pages}<script>window.onload=function(){window.print()}<\/script></body></html>`
}
