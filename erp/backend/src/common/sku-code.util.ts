/** 系统内部 SKU：{客户代码}-{客户SKU}，同客户重复时追加 -2、-3 */

export function sanitizeCustomerSkuPart(value: string): string {
  return value.trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24)
}

export function buildInternalSku(
  customerCode: string,
  customerSku: string,
  existingInternalSkus: string[] = [],
): string {
  const code = customerCode.trim().toUpperCase()
  const part = sanitizeCustomerSkuPart(customerSku)
  if (!code) throw new Error('缺少客户编码')
  if (!part) throw new Error('请填写 SKU')

  let base = `${code}-${part}`.slice(0, 30)
  const existing = new Set(existingInternalSkus.map(s => s.trim().toLowerCase()).filter(Boolean))
  if (!existing.has(base.toLowerCase())) return base

  let n = 2
  while (existing.has(`${base}-${n}`.toLowerCase())) n += 1
  return `${base}-${n}`.slice(0, 30)
}

/** 从内部 SKU 前缀解析客户编码（TK- 等平台 SKU 不解析） */
export function deriveCustomerCodeFromInternalSku(sku: string): string {
  const m = /^([A-Z][A-Z0-9]*)-/.exec(sku.trim())
  if (!m) return ''
  const code = m[1].toUpperCase()
  if (code === 'TK') return ''
  return code
}

/** 从内部 SKU 去掉客户编码前缀得到客户 SKU */
export function deriveCustomerSkuFromInternalSku(sku: string, customerCode: string): string {
  if (!customerCode?.trim() || !sku?.trim()) return ''
  const prefix = `${customerCode.trim().toUpperCase()}-`
  const trimmed = sku.trim()
  if (trimmed.toUpperCase().startsWith(prefix)) {
    return trimmed.slice(customerCode.trim().length + 1)
  }
  return ''
}

export async function nextTklCustomerCode(
  prisma: { customer: { findMany: (args: object) => Promise<{ customerCode: string }[]> } },
): Promise<string> {
  const rows = await prisma.customer.findMany({
    where: { customerCode: { startsWith: 'TKL' } },
    select: { customerCode: true },
  })
  let max = 0
  for (const row of rows) {
    const m = /^TKL(\d+)$/i.exec(row.customerCode.trim())
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return `TKL${String(max + 1).padStart(4, '0')}`
}
