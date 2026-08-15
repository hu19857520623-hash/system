import { useState } from 'react'
import { Bell } from 'lucide-react'
import { Badge, Button, Card, PageHeader, FilterChip } from '../components/ui'
import { markSystemMessagesRead, useSystemMessages } from '../data/entityStore'

const typeLabels = { inbound: '入库', outbound: '出库', billing: '费用', system: '系统' }
const typeColors = { inbound: 'bg-orange-50 text-orange-700', outbound: 'bg-blue-50 text-blue-700', billing: 'bg-amber-50 text-amber-700', system: 'bg-slate-100 text-slate-700' }

export default function MessagesPage() {
  const systemMessages = useSystemMessages()
  const [tab, setTab] = useState<'all' | 'unread'>('all')
  const [saving, setSaving] = useState(false)
  const list = systemMessages.filter(m => tab === 'all' || !m.read)

  const markRead = async (ids?: string[]) => {
    setSaving(true)
    try {
      await markSystemMessagesRead(ids)
    } catch (error) {
      window.alert(`标记已读失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page-shell">
      <PageHeader
        title="消息中心"
        desc="入库、出库、费用与系统通知"
        action={<Button variant="secondary" size="sm" disabled={saving || !systemMessages.some(message => !message.read)} onClick={() => void markRead()}>全部已读</Button>}
      />
      <div className="mb-4 flex gap-2">
        <FilterChip active={tab === 'all'} onClick={() => setTab('all')}>全部 ({systemMessages.length})</FilterChip>
        <FilterChip active={tab === 'unread'} onClick={() => setTab('unread')} alert={systemMessages.some(m => !m.read)}>
          未读 ({systemMessages.filter(m => !m.read).length})
        </FilterChip>
      </div>
      <Card className="divide-y divide-border-light">
        {list.map(m => (
          <button
            type="button"
            key={m.id}
            onClick={() => { if (!m.read) void markRead([m.id]) }}
            className={`flex w-full gap-4 px-5 py-4 text-left ${!m.read ? 'bg-primary-50/30 hover:bg-primary-50/60' : ''}`}
          >
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${typeColors[m.type]}`}>
              <Bell className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-text-primary">{m.title}</p>
                {!m.read && <Badge status="pending" label="未读" />}
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${typeColors[m.type]}`}>{typeLabels[m.type]}</span>
              </div>
              <p className="mt-1 text-xs text-text-secondary">{m.content}</p>
              <p className="mt-1 text-[10px] text-text-muted">{m.createdAt}</p>
            </div>
          </button>
        ))}
      </Card>
    </div>
  )
}
