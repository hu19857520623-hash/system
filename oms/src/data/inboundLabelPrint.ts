import type { InboundOrder } from './mockData'

export type InboundLabelKind = '箱唛' | 'SKU 标签'

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function buildLabelHtml(order: InboundOrder, kind: InboundLabelKind): string {
  const lines = order.lineItems?.length
    ? order.lineItems
    : [{ sku: order.skuHint ?? '—', name: order.inboundNo, qty: order.totalQty, boxNo: 1, packType: '', stockType: '' }]

  const labels: string[] = []

  if (kind === '箱唛') {
    const boxNos = [...new Set(lines.map(l => l.boxNo ?? 1))].sort((a, b) => a - b)
    for (const boxNo of boxNos) {
      const boxLines = lines.filter(l => (l.boxNo ?? 1) === boxNo)
      const skuList = boxLines.map(l => `${l.sku} × ${l.qty}`).join('<br/>')
      labels.push(`
        <article class="label box">
          <p class="kind">入库箱唛</p>
          <p class="no">${escapeHtml(order.inboundNo)}</p>
          <p class="meta">箱 ${boxNo} / ${order.boxCount} · ${escapeHtml(order.warehouse)}</p>
          <p class="meta">${escapeHtml(order.trackingNo ?? order.referenceNo ?? '')}</p>
          <div class="skus">${skuList}</div>
        </article>
      `)
    }
  } else {
    for (const line of lines) {
      const count = Math.max(1, Math.min(line.qty, 50))
      for (let i = 0; i < count; i += 1) {
        labels.push(`
          <article class="label sku">
            <p class="kind">SKU 标签</p>
            <p class="code">${escapeHtml(line.sku)}</p>
            <p class="name">${escapeHtml(line.name || line.sku)}</p>
            <p class="meta">${escapeHtml(order.inboundNo)} · 箱 ${line.boxNo ?? 1}</p>
          </article>
        `)
      }
    }
  }

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(order.inboundNo)}-${kind}</title>
<style>
  @page { size: A4; margin: 10mm }
  * { box-sizing: border-box }
  body { margin: 0; font-family: Arial, sans-serif; color: #0f172a }
  .sheet { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8mm; padding: 8mm }
  .label { border: 1px dashed #94a3b8; border-radius: 4px; padding: 6mm; min-height: 42mm; break-inside: avoid }
  .label.box { min-height: 56mm }
  .kind { margin: 0; font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: #64748b }
  .no, .code { margin: 4mm 0 2mm; font-size: 18px; font-weight: 700; font-family: monospace }
  .name { margin: 0 0 2mm; font-size: 12px; font-weight: 600 }
  .meta { margin: 0; font-size: 10px; color: #475569 }
  .skus { margin-top: 3mm; font-size: 11px; line-height: 1.4 }
</style></head><body><main class="sheet">${labels.join('')}</main></body></html>`
}

export function printInboundLabels(order: InboundOrder, kind: InboundLabelKind) {
  const html = buildLabelHtml(order, kind)
  const win = window.open('', '_blank', 'width=900,height=720')
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

export function downloadInboundLabelHtml(order: InboundOrder, kind: InboundLabelKind) {
  const html = buildLabelHtml(order, kind)
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${order.inboundNo}-${kind}.html`
  anchor.click()
  URL.revokeObjectURL(url)
}
