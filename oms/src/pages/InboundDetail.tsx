import { Link, useNavigate, useParams } from 'react-router-dom'
import InboundDetailDrawer from '../components/inbound/InboundDetailDrawer'
import { useInboundOrders } from '../data/entityStore'
import { useDataScope } from '../auth/useDataScope'

export default function InboundDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const orders = useInboundOrders()
  const dataScope = useDataScope()
  const order = dataScope.scopeInbound(orders).find(item => item.id === id)

  if (!order) {
    return (
      <div className="mx-auto max-w-5xl rounded-xl border border-border-light bg-white p-6">
        <p className="text-sm text-text-secondary">未找到该入库单，或当前账号无权查看。</p>
        <Link to="/inbound/records" className="mt-4 inline-block text-sm text-primary-600 hover:underline">返回入库记录</Link>
      </div>
    )
  }

  return (
    <InboundDetailDrawer
      mode="page"
      order={order}
      onClose={() => navigate('/inbound/records')}
      onOrderChanged={next => { if (!next) navigate('/inbound/records') }}
    />
  )
}
