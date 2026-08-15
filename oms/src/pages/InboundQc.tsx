import { Download } from 'lucide-react'
import { Button, Card, PageHeader, MonoCode, Table, TableFooter } from '../components/ui'
import { useQcReports } from '../data/entityStore'
import { exportQcReportsCsv, printQcReport } from '../data/listExport'

const resultLabels = { pass: '合格', partial: '部分合格', fail: '不合格' }
const resultColors = { pass: 'bg-emerald-100 text-emerald-800', partial: 'bg-amber-100 text-amber-800', fail: 'bg-red-100 text-red-800' }

export default function InboundQcPage() {
  const qcReports = useQcReports()
  return (
    <div className="page-shell">
      <PageHeader
        title="质检报告"
        desc="入库验收质检结果查询与报告下载"
        action={(
          <Button variant="secondary" size="sm" onClick={() => exportQcReportsCsv(qcReports)}>
            <Download className="h-3.5 w-3.5" /> 导出
          </Button>
        )}
      />
      <Card className="overflow-hidden">
        <Table>
          <thead className="table-head">
            <tr>
              <th>入库单号</th>
              <th>SKU</th>
              <th>产品名称</th>
              <th>抽检数</th>
              <th>合格</th>
              <th>不合格</th>
              <th>结果</th>
              <th>报告日期</th>
              <th></th>
            </tr>
          </thead>
          <tbody className="table-body">
            {qcReports.map(r => (
              <tr key={r.id} className="table-row">
                <td className="table-cell"><MonoCode>{r.inboundNo}</MonoCode></td>
                <td className="table-cell"><MonoCode>{r.sku}</MonoCode></td>
                <td className="table-cell text-xs">{r.productName}</td>
                <td className="table-cell text-xs">{r.sampleQty}</td>
                <td className="table-cell text-xs text-emerald-600 font-semibold">{r.passQty}</td>
                <td className="table-cell text-xs text-red-600">{r.failQty > 0 ? r.failQty : '—'}</td>
                <td className="table-cell">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${resultColors[r.result]}`}>{resultLabels[r.result]}</span>
                </td>
                <td className="table-cell text-xs text-text-muted">{r.reportDate}</td>
                <td className="table-cell">
                  <Button variant="ghost" size="sm" onClick={() => printQcReport(r)}>查看报告</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        <TableFooter total={qcReports.length} />
      </Card>
    </div>
  )
}
