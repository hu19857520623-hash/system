type DevApi = {
  create: (payload: Record<string, unknown>) => Promise<{ id: number | string }>
  update: (id: number, payload: Record<string, unknown>) => Promise<unknown>
  submit: (id: number) => Promise<unknown>
}

/** Keep the confirmed draft identity before the second request can fail. */
export async function saveAndSubmitProductDev(api: DevApi, id: number | null, payload: Record<string, unknown>, onCreated: (id: number) => void) {
  let targetId = id
  if (targetId) await api.update(targetId, payload)
  else {
    const created = await api.create({ ...payload, status: 'draft' })
    targetId = Number(created.id)
    if (!Number.isSafeInteger(targetId) || targetId <= 0) throw new Error('创建结果暂无法确认，请返回列表核对，请勿重复新建')
    onCreated(targetId)
  }
  return api.submit(targetId)
}
