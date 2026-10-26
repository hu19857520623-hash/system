export const RETURN_DEPARTMENTS = ['电商', '货盘', '其他退货'] as const

export const CATALOG_RETURN_FILE_KINDS = {
  reasonScreenshot: 'takealot_return_reason_screenshot',
  sales30d: 'takealot_return_sales_30d',
  returns30d: 'takealot_return_returns_30d',
} as const

/** 历史自填部门保留原资料要求，只有明确选电商或其他退货才使用简化表单。 */
export function usesCatalogReturnTemplate(department: string): boolean {
  return Boolean(department.trim()) && department !== '电商' && department !== '其他退货'
}

/** 切换到简化表单后，不把隐藏的货盘资料随草稿或正式退货一起提交。 */
export function attachmentsForReturnDepartment<T extends { kind: string; fileType?: string }>(attachments: T[], department: string): T[] {
  if (usesCatalogReturnTemplate(department)) return attachments
  const kinds: readonly string[] = Object.values(CATALOG_RETURN_FILE_KINDS)
  return attachments.filter(file => !kinds.includes(file.kind) && !kinds.includes(file.fileType || ''))
}
