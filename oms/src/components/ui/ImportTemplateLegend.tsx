import type { CsvColumn } from '../../data/csvImportExport'
import { columnHeader } from '../../data/csvImportExport'

export function ImportTemplateLegend({ columns }: { columns: CsvColumn[] }) {
  const required = columns.filter(c => c.required)
  const optional = columns.filter(c => !c.required)

  return (
    <div className="mb-3 rounded-lg border border-border-light bg-surface-muted/40 px-3 py-2 text-[11px] leading-relaxed text-text-secondary">
      <p>
        批量导入字段：<span className="font-semibold text-red-600">*</span> 为<strong className="text-text-primary">必填</strong>，
        无 <span className="font-semibold text-red-600">*</span> 为<strong className="text-text-primary">选填</strong>。
        请下载模板填写，可直接上传 XLS 模板，也可另存为 CSV (UTF-8) 后上传。
      </p>
      <p className="mt-1">
        必填：{required.map(c => columnHeader(c)).join('、')}
        {optional.length > 0 && (
          <span className="text-text-muted"> · 选填：{optional.map(c => c.header).join('、')}</span>
        )}
      </p>
    </div>
  )
}
