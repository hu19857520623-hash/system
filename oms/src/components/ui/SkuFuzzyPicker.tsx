import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { formInput } from './form'
import { searchProductsFuzzy } from '../../data/platformBindingUtils'
import { getCustomerSkuDisplay } from '../../data/skuCode'
import type { Product } from '../../data/mockData'

type SkuFuzzyPickerProps = {
  id?: string
  'aria-describedby'?: string
  value: string
  onChange: (value: string) => void
  onSelect?: (product: Product) => void
  placeholder?: string
  customerId?: string
  className?: string
}

export default function SkuFuzzyPicker({
  id,
  'aria-describedby': ariaDescribedBy,
  value,
  onChange,
  onSelect,
  placeholder = '输入 SKU / 品名模糊搜索',
  customerId,
  className = '',
}: SkuFuzzyPickerProps) {
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)

  const options = useMemo(
    () => searchProductsFuzzy(value, 10, customerId),
    [value, customerId],
  )

  useEffect(() => {
    setActiveIdx(0)
  }, [value, options.length])

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const pick = (product: Product) => {
    onChange(getCustomerSkuDisplay(product))
    onSelect?.(product)
    setOpen(false)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      setOpen(true)
      return
    }
    if (!open || options.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx(i => Math.min(i + 1, options.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      pick(options[activeIdx])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const showDropdown = open && value.trim().length > 0

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
        <input
          id={id}
          aria-describedby={ariaDescribedBy}
          value={value}
          onChange={e => {
            onChange(e.target.value)
            setOpen(true)
          }}
          onFocus={() => value.trim() && setOpen(true)}
          onKeyDown={onKeyDown}
          className={formInput('pl-8')}
          placeholder={placeholder}
          autoComplete="off"
        />
      </div>
      {showDropdown && (
        <div className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-border bg-white py-1 shadow-lg">
          {options.length === 0 ? (
            <p className="px-3 py-2 text-xs text-text-muted">无匹配 SKU，可直接输入编码后添加</p>
          ) : (
            options.map((p, idx) => (
              <button
                key={p.id}
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => pick(p)}
                className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-xs transition ${
                  idx === activeIdx ? 'bg-primary-50 text-primary-900' : 'hover:bg-surface-muted'
                }`}
              >
                <span className="font-mono font-semibold text-text-primary">{getCustomerSkuDisplay(p)}</span>
                <span className="line-clamp-1 text-text-secondary">{p.name}</span>
                {p.customCode && (
                  <span className="text-[10px] text-text-muted">自定义编号：{p.customCode}</span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
