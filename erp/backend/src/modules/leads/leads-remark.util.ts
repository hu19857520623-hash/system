/** 导入线索时在 remark 里拼接的结构化前缀（留资/获客/对接等），展示与入库前应剥离。 */
const LEADING_IMPORT_SEGMENT =
  /^(?:(?:\s*(?:留资|前端|获客|对接|再对接|销售情况):[^|]*)\s*(?:\|\s*)?)+/u

/** 去掉 remark 开头的导入元数据，保留真实备注正文。 */
export function stripLeadRemarkImportPrefix(remark?: string | null): string {
  let text = String(remark || '').trim()
  if (!text) return ''
  text = text.replace(LEADING_IMPORT_SEGMENT, '').trim()
  text = text.replace(/^备注:\s*/u, '').trim()
  return text
}
