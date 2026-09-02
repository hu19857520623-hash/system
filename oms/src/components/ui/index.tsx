import { X } from 'lucide-react'
import { statusColors, statusLabels, ExceptionType } from '../../data/mockData'

export function Badge({ status, label }: { status: string; label?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColors[status] ?? 'bg-slate-100 text-slate-600'}`}>
      {label ?? statusLabels[status] ?? status}
    </span>
  )
}

export function ExceptionBadge({ type }: { type: ExceptionType }) {
  if (!type) return <span className="text-xs text-text-muted">—</span>
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColors[type]}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
      {statusLabels[type]}
    </span>
  )
}

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'toolbar' | 'ghost' | 'danger' | 'danger-outline'
  size?: 'sm' | 'md'
}

export function Button({ variant = 'primary', size = 'md', className = '', children, disabled, ...props }: ButtonProps) {
  const base = 'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none'
  const variants = {
    primary: 'bg-primary-600 text-white shadow-sm hover:bg-primary-700 active:scale-[0.98]',
    secondary: 'bg-white text-text-primary border border-border hover:bg-surface-muted shadow-sm',
    toolbar: 'bg-slate-700 text-white shadow-sm hover:bg-slate-800 active:scale-[0.98]',
    ghost: 'text-text-secondary hover:bg-surface-subtle hover:text-text-primary',
    danger: 'bg-red-600 text-white hover:bg-red-700 shadow-sm',
    'danger-outline': 'border border-red-200 text-red-600 hover:bg-red-50',
  }
  const sizes = { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2 text-sm' }
  return <button className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} disabled={disabled} {...props}>{children}</button>
}

export function Card({ children, className = '', padding = false }: { children: React.ReactNode; className?: string; padding?: boolean }) {
  return (
    <div className={`rounded-2xl border border-border-light bg-white shadow-soft ${padding ? 'p-5' : ''} ${className}`}>
      {children}
    </div>
  )
}

export function CardHeader({ title, action, desc }: { title: string; action?: React.ReactNode; desc?: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border-light px-5 py-4">
      <div>
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
        {desc && <p className="mt-0.5 text-xs text-text-muted">{desc}</p>}
      </div>
      {action}
    </div>
  )
}

export function MonoCode({ children }: { children: string }) {
  return <span className="mono-code">{children}</span>
}

export function PageHeader({ title, desc, action }: { title: string; desc?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-text-primary">{title}</h1>
        {desc && <p className="mt-1 text-sm text-text-secondary">{desc}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  )
}

export function StatCard({ label, value, sub, alert, icon: Icon }: {
  label: string; value: string | number; sub?: string; alert?: boolean
  icon?: React.ComponentType<{ className?: string }>
}) {
  return (
    <div className="rounded-2xl border border-border-light bg-white p-5 shadow-soft transition-shadow hover:shadow-card">
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text-secondary">{label}</p>
          <p className={`mt-2 text-2xl font-semibold tracking-tight ${alert ? 'text-red-600' : 'text-text-primary'}`}>{value}</p>
          {sub && <p className="mt-1 text-xs text-text-muted">{sub}</p>}
        </div>
        {Icon && (
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${alert ? 'bg-red-50 text-red-500' : 'bg-primary-50 text-primary-600'}`}>
            <Icon className="h-5 w-5" />
          </div>
        )}
      </div>
    </div>
  )
}

export function SearchInput({ placeholder, value, onChange, className = '' }: { placeholder?: string; value?: string; onChange?: (v: string) => void; className?: string }) {
  return (
    <div className={`relative ${className}`}>
      <input
        type="search"
        placeholder={placeholder ?? '搜索...'}
        value={value}
        onChange={e => onChange?.(e.target.value)}
        className="w-full rounded-lg border border-border bg-white py-2 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
      />
      <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
    </div>
  )
}

export function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-text-secondary">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)} className="w-full rounded-lg border border-border bg-white py-2 pl-3 pr-8 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20">
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

export function Drawer({ open, onClose, title, subtitle, children, footer }: {
  open: boolean; onClose: () => void; title: string; subtitle?: React.ReactNode
  children: React.ReactNode; footer?: React.ReactNode
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/20 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-lg flex-col bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-border-light px-6 py-5">
          <div>
            <MonoCode>{title}</MonoCode>
            {subtitle && <div className="mt-3 flex flex-wrap items-center gap-2">{subtitle}</div>}
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-text-muted hover:bg-surface-muted hover:text-text-primary"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin">{children}</div>
        {footer && <div className="border-t border-border-light bg-surface-muted/50 px-6 py-4">{footer}</div>}
      </div>
    </div>
  )
}

export function DrawerTabs({ tabs, active, onChange }: { tabs: { id: string; label: string }[]; active: string; onChange: (id: string) => void }) {
  return (
    <div className="flex gap-1 border-b border-border-light bg-surface-muted/30 px-4">
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`relative px-4 py-3 text-sm font-medium transition-colors ${
            active === tab.id ? 'text-primary-600' : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          {tab.label}
          {active === tab.id && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary-600" />}
        </button>
      ))}
    </div>
  )
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">{children}</h4>
}

export function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex py-2 text-sm">
      <span className="w-28 shrink-0 text-text-secondary">{label}</span>
      <span className="text-text-primary">{value}</span>
    </div>
  )
}

export function Tabs({ tabs, active, onChange }: { tabs: { id: string; label: string; count?: number }[]; active: string; onChange: (id: string) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-surface-muted/50 p-1">
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
            active === tab.id ? 'bg-white text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          {tab.label}
          {tab.count !== undefined && <span className="ml-1 text-text-muted">({tab.count})</span>}
        </button>
      ))}
    </div>
  )
}

export function PlaceholderPage({ title, desc }: { title: string; desc?: string }) {
  return (
    <div className="page-shell">
      <PageHeader title={title} desc={desc} />
      <Card padding className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-sm font-medium text-text-secondary">暂无数据</p>
      </Card>
    </div>
  )
}

export function Table({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="w-full min-w-max text-sm">{children}</table>
    </div>
  )
}

export function TableFooter({
  total, page = 1, pageSize = 20, onPageChange, onPageSizeChange,
}: {
  total: number; page?: number; pageSize?: number
  onPageChange?: (p: number) => void; onPageSizeChange?: (s: number) => void
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(page, pages)
  const go = (p: number) => onPageChange?.(Math.max(1, Math.min(pages, p)))
  const paginated = Boolean(onPageChange)

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-light px-4 py-3 text-xs text-text-muted">
      <span>共 {total} 条</span>
      {paginated && (
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => go(1)} disabled={safePage <= 1} className="rounded px-2 py-1 hover:bg-surface-muted disabled:opacity-40">首页</button>
          <button type="button" onClick={() => go(safePage - 1)} disabled={safePage <= 1} className="rounded px-2 py-1 hover:bg-surface-muted disabled:opacity-40">上一页</button>
          {Array.from({ length: Math.min(pages, 5) }, (_, i) => {
            const start = Math.max(1, Math.min(safePage - 2, pages - 4))
            const p = start + i
            if (p > pages) return null
            return (
              <button
                key={p}
                type="button"
                onClick={() => go(p)}
                className={`min-w-[28px] rounded-lg px-2 py-1 font-medium transition-colors ${
                  p === safePage ? 'bg-primary-600 text-white shadow-sm' : 'hover:bg-surface-muted text-text-secondary'
                }`}
              >
                {p}
              </button>
            )
          })}
          <button type="button" onClick={() => go(safePage + 1)} disabled={safePage >= pages} className="rounded px-2 py-1 hover:bg-surface-muted disabled:opacity-40">下一页</button>
          <button type="button" onClick={() => go(pages)} disabled={safePage >= pages} className="rounded px-2 py-1 hover:bg-surface-muted disabled:opacity-40">末页</button>
        </div>
        <select
          value={pageSize}
          onChange={e => onPageSizeChange?.(Number(e.target.value))}
          className="rounded-lg border border-border bg-white px-2 py-1 text-xs"
        >
          {[10, 20, 50].map(s => <option key={s} value={s}>{s} 条/页</option>)}
        </select>
      </div>
      )}
    </div>
  )
}

export function FilterChip({ active, onClick, children, alert }: {
  active: boolean; onClick: () => void; children: React.ReactNode; alert?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-3.5 py-1.5 text-xs font-medium transition-all ${
        active
          ? 'bg-primary-600 text-white shadow-sm'
          : alert
          ? 'bg-white text-red-600 ring-1 ring-red-100 hover:bg-red-50'
          : 'bg-white text-text-secondary ring-1 ring-border hover:bg-surface-muted hover:text-text-primary'
      }`}
    >
      {children}
    </button>
  )
}
