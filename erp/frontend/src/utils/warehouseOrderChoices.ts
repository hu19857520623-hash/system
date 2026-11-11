const activeStatuses = ['arrived', 'receiving', 'pending_putaway', 'exception']

/** Publish a complete selection only; a failed later page must not hide older jobs. */
export async function loadWarehouseOrderChoices(
  api: { listWorkOrders: (query: { warehouseCode: string; page: number; pageSize: number }) => Promise<any> },
  warehouseCode: string,
  isCurrent: () => boolean = () => true,
): Promise<any[] | null> {
  const choices: any[] = [], seen = new Set<string>()
  let total = 0, loaded = 0
  for (let page = 1; page === 1 || loaded < total; page++) {
    if (!isCurrent()) return null
    const result = await api.listWorkOrders({ warehouseCode, page, pageSize: 200 })
    if (!isCurrent()) return null
    if (!Array.isArray(result.items) || !Number.isSafeInteger(result.total) || result.total < 0
      || (page > 1 && result.total !== total)) {
      throw new Error('作业单范围已变化或读取不完整，请刷新作业单后重新选择')
    }
    total = result.total
    if ((!result.items.length && loaded < total) || loaded + result.items.length > total) {
      throw new Error('作业单读取不完整，请刷新作业单后重新选择')
    }
    for (const row of result.items) {
      const id = String(row?.id ?? '')
      if (!id || seen.has(id)) throw new Error('作业单在读取期间发生变化，请刷新后重新选择')
      seen.add(id)
      if (row.warehouseCode === warehouseCode && activeStatuses.includes(row.status) && !row.readOnly) {
        if (!Number.isSafeInteger(Number(row.id)) || Number(row.id) <= 0) throw new Error('作业单编号无效，请刷新后核对')
        choices.push(row)
      }
    }
    loaded += result.items.length
  }
  return choices
}
