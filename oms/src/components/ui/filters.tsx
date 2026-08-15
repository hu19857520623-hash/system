import { ChevronDown } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { Button } from './index'

export type TriState = 'all' | 'yes' | 'no'
export type SearchMode = 'exact' | 'fuzzy'

export const inputCls =
  'w-full rounded-lg border border-border bg-white px-3 py-2 text-xs focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20'

export function TriToggle({ label, value, onChange }: { label: string; value: TriState; onChange: (v: TriState) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="w-[72px] shrink-0 text-text-secondary">{label}</span>
      {(['all', 'yes', 'no'] as TriState[]).map(v => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
            value === v ? 'bg-primary-600 text-white shadow-sm' : 'bg-surface-muted text-text-secondary hover:bg-surface-subtle'
          }`}
        >
          {v === 'all' ? '全部' : v === 'yes' ? '是' : '否'}
        </button>
      ))}
    </div>
  )
}

export function SearchField({
  label, value, onChange, mode, onModeChange, placeholder = '支持多个，空格分隔',
}: {
  label: string; value: string; onChange: (v: string) => void
  mode: SearchMode; onModeChange: (m: SearchMode) => void; placeholder?: string
}) {
  return (
    <div>
      <label className="mb-1 flex items-center justify-between text-[11px] font-medium text-text-muted">
        <span>{label}</span>
        <select
          value={mode}
          onChange={e => onModeChange(e.target.value as SearchMode)}
          className="rounded border-0 bg-transparent py-0 pl-0 pr-4 text-[10px] text-primary-600 focus:ring-0"
        >
          <option value="exact">精确查询</option>
          <option value="fuzzy">模糊查询</option>
        </select>
      </label>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={inputCls} />
    </div>
  )
}

export function RangeField({
  label, min, max, onMinChange, onMaxChange, placeholderMin = '最小', placeholderMax = '最大',
}: {
  label: string; min: string; max: string
  onMinChange: (v: string) => void; onMaxChange: (v: string) => void
  placeholderMin?: string; placeholderMax?: string
}) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium text-text-muted">{label}</label>
      <div className="flex items-center gap-1">
        <input value={min} onChange={e => onMinChange(e.target.value)} placeholder={placeholderMin} className={inputCls} />
        <span className="shrink-0 text-text-muted">—</span>
        <input value={max} onChange={e => onMaxChange(e.target.value)} placeholder={placeholderMax} className={inputCls} />
      </div>
    </div>
  )
}

export function FilterActions({ onQuery, onReset, align = 'right' }: { onQuery: () => void; onReset: () => void; align?: 'left' | 'right' }) {
  return (
    <div className={`flex items-end gap-2 ${align === 'left' ? 'justify-start' : 'justify-end'}`}>
      <Button variant="secondary" size="sm" onClick={onReset}>重置</Button>
      <Button size="sm" onClick={onQuery}>查询</Button>
    </div>
  )
}

export function DropdownBtn({ label, icon, items, variant = 'secondary' }: {
  label: string
  icon?: React.ReactNode
  items: { label: string; onClick?: () => void }[]
  variant?: 'secondary' | 'toolbar'
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [])
  return (
    <div className="relative" ref={ref}>
      <Button variant={variant} size="sm" onClick={() => setOpen(v => !v)}>
        {icon}{label} <ChevronDown className="h-3 w-3" />
      </Button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 min-w-[140px] rounded-lg border border-border-light bg-white py-1 shadow-card">
          {items.map(item => (
            <button
              key={item.label}
              type="button"
              onClick={() => { item.onClick?.(); setOpen(false) }}
              className="block w-full px-3 py-2 text-left text-xs text-text-secondary hover:bg-surface-muted hover:text-text-primary"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function matchTriState(field: boolean, filter: TriState) {
  if (filter === 'all') return true
  return filter === 'yes' ? field : !field
}

export function matchText(value: string, query: string, mode: SearchMode) {
  if (!query) return true
  const terms = query.trim().split(/\s+/).filter(Boolean)
  const v = value.toLowerCase()
  if (terms.length > 1 || query.includes(' ')) {
    return terms.some(q => mode === 'exact' ? v === q.toLowerCase() : v.includes(q.toLowerCase()))
  }
  const q = query.toLowerCase().trim()
  return mode === 'exact' ? v === q : v.includes(q)
}
