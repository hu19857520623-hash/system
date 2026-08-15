import { downloadCsv } from './csvImportExport'
import type { FeeRecord, InventoryItem } from './mockData'
import { STOCK_SOURCE_LABELS, warehouseLabel, getInventoryStatus, statusLabels } from './mockData'

export function exportInventoryCsv(items: InventoryItem[]) {
  const rows = [[
    'SKU', '商品名称', '规格', 'EAN', '自定义编号', '仓库', '库存来源',
    '可用', '待上架', '待出库', '锁定', '在途', '不良品', '已出库', '状态',
  ]]
  for (const item of items) {
    const st = getInventoryStatus(item)
    rows.push([
      item.sku,
      item.name,
      item.spec ?? '',
      item.ean ?? '',
      item.customCode ?? '',
      warehouseLabel(item.warehouse),
      STOCK_SOURCE_LABELS[item.stockSource],
      String(item.available),
      String(item.pendingShelving),
      String(item.pendingOutbound),
      String(item.locked),
      String(item.inTransit),
      String(item.defective),
      String(item.shipped),
      statusLabels[st] ?? st,
    ])
  }
  downloadCsv('OMS-库存导出.csv', rows)
}

export function exportFeeRecordsCsv(records: FeeRecord[]) {
  const rows = [['日期', '类型', '关联单号', '说明', '金额', '方式', '客户代码']]
  for (const f of records) {
    rows.push([
      f.date,
      f.type,
      f.refNo ?? '—',
      f.desc,
      String(f.amount),
      f.method ?? '',
      f.customerCode ?? '',
    ])
  }
  downloadCsv('OMS-费用流水.csv', rows)
}

export function exportQcReportsCsv(
  reports: { inboundNo: string; sku: string; productName: string; sampleQty: number; passQty: number; failQty: number; result: string; reportDate: string }[],
) {
  const resultLabels: Record<string, string> = { pass: '合格', partial: '部分合格', fail: '不合格' }
  const rows = [['入库单号', 'SKU', '产品名称', '抽检数', '合格', '不合格', '结果', '报告日期']]
  for (const r of reports) {
    rows.push([
      r.inboundNo,
      r.sku,
      r.productName,
      String(r.sampleQty),
      String(r.passQty),
      String(r.failQty),
      resultLabels[r.result] ?? r.result,
      r.reportDate,
    ])
  }
  downloadCsv('OMS-质检报告.csv', rows)
}

export function printQcReport(report: {
  inboundNo: string
  sku: string
  productName: string
  sampleQty: number
  passQty: number
  failQty: number
  result: string
  reportDate: string
}) {
  const resultLabels: Record<string, string> = { pass: '合格', partial: '部分合格', fail: '不合格' }
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>质检报告-${report.inboundNo}</title>
<style>body{font-family:Arial,sans-serif;padding:24px;color:#0f172a}h1{font-size:20px}table{border-collapse:collapse;width:100%;margin-top:16px}td,th{border:1px solid #cbd5e1;padding:8px;text-align:left;font-size:13px}th{background:#f1f5f9}</style>
</head><body>
<h1>入库质检报告</h1>
<table>
<tr><th>入库单号</th><td>${report.inboundNo}</td></tr>
<tr><th>SKU</th><td>${report.sku}</td></tr>
<tr><th>产品名称</th><td>${report.productName}</td></tr>
<tr><th>抽检数</th><td>${report.sampleQty}</td></tr>
<tr><th>合格</th><td>${report.passQty}</td></tr>
<tr><th>不合格</th><td>${report.failQty}</td></tr>
<tr><th>结果</th><td>${resultLabels[report.result] ?? report.result}</td></tr>
<tr><th>报告日期</th><td>${report.reportDate}</td></tr>
</table>
<p style="margin-top:24px;font-size:12px;color:#64748b">OMS 质检报告 · 打印时间 ${new Date().toLocaleString()}</p>
</body></html>`
  const win = window.open('', '_blank', 'width=800,height=640')
  if (!win) {
    window.alert('浏览器拦截了打印窗口，请允许弹出窗口后重试')
    return false
  }
  win.document.write(html)
  win.document.close()
  win.focus()
  window.setTimeout(() => win.print(), 200)
  return true
}
