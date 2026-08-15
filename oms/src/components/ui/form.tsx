import { inputCls } from './filters'

export function FormSection({ num, title, children, action }: {
  num: number; title: string; children: React.ReactNode; action?: React.ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border-light bg-white">
      <div className="flex items-center justify-between border-b border-primary-100 bg-primary-50/60 px-5 py-3">
        <h3 className="text-sm font-semibold text-primary-800">{num}、{title}</h3>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  )
}

export function FormGrid({ cols = 3, children }: { cols?: 2 | 3 | 4; children: React.ReactNode }) {
  const cls = cols === 2 ? 'sm:grid-cols-2' : cols === 4 ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-2 lg:grid-cols-3'
  return <div className={`grid gap-4 ${cls}`}>{children}</div>
}

export function FormField({
  label, required, hint, children, className = '',
}: {
  label: string; required?: boolean; hint?: string
  children: React.ReactNode; className?: string
}) {
  return (
    <div className={className}>
      <label className="mb-1 flex items-center gap-1 text-xs font-medium text-text-secondary">
        {required && <span className="text-red-500">*</span>}
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-[10px] leading-relaxed text-amber-600">{hint}</p>}
    </div>
  )
}

export function formInput(extra = '') {
  return `${inputCls} text-sm py-2.5 ${extra}`
}

export function formSelect(extra = '') {
  return `${inputCls} text-sm py-2.5 ${extra}`
}

export function formTextarea(extra = '') {
  return `${inputCls} text-sm py-2.5 min-h-[80px] resize-y ${extra}`
}
