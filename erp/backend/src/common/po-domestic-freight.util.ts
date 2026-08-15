/** 采购单国内运费：行级优先，否则按 PO 总额按数量分摊 */

export type PoDomesticFreightLine = {
  id: bigint | number | string
  quantity: number
  domesticFreight?: unknown
}

export type PoDomesticFreightOrder = {
  domesticFreight?: unknown
  items: PoDomesticFreightLine[]
}

export function allocatePoDomesticFreight(po: PoDomesticFreightOrder) {
  const orderDomestic = po.domesticFreight != null && po.domesticFreight !== '' ? Number(po.domesticFreight) : 0
  const totalQty = po.items.reduce((s, i) => s + (Number(i.quantity) || 0), 0)
  const perLine = new Map<string, number>()
  let total = 0
  for (const line of po.items) {
    let lineDomestic = line.domesticFreight != null && line.domesticFreight !== '' ? Number(line.domesticFreight) : 0
    if (!lineDomestic && orderDomestic > 0 && totalQty > 0) {
      lineDomestic = (orderDomestic * (Number(line.quantity) || 0)) / totalQty
    }
    const key = String(line.id)
    perLine.set(key, lineDomestic)
    total += lineDomestic
  }
  return { perLine, total: Math.round(total * 100) / 100 }
}
