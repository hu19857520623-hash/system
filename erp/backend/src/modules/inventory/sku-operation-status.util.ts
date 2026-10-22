/** 客户商品档案状态，不表示货盘销售权限或实际库存。 */
export function skuOperationStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    available: '可用', active: '可用', 正式: '可用', 正式产品: '可用',
    draft: '草稿', reviewing: '审核中', pending: '待完善', 待完善: '待完善',
    discarded: '废弃', inactive: '停用', 停用: '停用', 停用产品: '停用',
    rejected: '审核未通过',
  }
  return labels[status] || status || '未知'
}
