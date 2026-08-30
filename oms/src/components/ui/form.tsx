import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  type ReactElement,
  type ReactNode,
} from 'react'
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

const NATIVE_CONTROLS = new Set(['input', 'select', 'textarea'])

function mergeDescribedBy(existing: unknown, hintId?: string) {
  return [existing, hintId].filter(Boolean).join(' ') || undefined
}

function bindFieldControl(node: ReactNode, fieldId: string, hintId?: string): ReactNode {
  if (!isValidElement(node)) return node

  const props = node.props as Record<string, unknown>
  const type = node.type

  if (typeof type === 'string' && NATIVE_CONTROLS.has(type)) {
    return cloneElement(node as ReactElement<Record<string, unknown>>, {
      id: (typeof props.id === 'string' && props.id) || fieldId,
      'aria-describedby': mergeDescribedBy(props['aria-describedby'], hintId),
    })
  }

  if (typeof type !== 'string') {
    return cloneElement(node as ReactElement<Record<string, unknown>>, {
      id: (typeof props.id === 'string' && props.id) || fieldId,
      'aria-describedby': mergeDescribedBy(props['aria-describedby'], hintId),
    })
  }

  if (props.children == null) return node

  let bound = false
  const nextChildren = Children.map(props.children as ReactNode, child => {
    if (bound || !isValidElement(child)) return child
    const next = bindFieldControl(child, fieldId, hintId)
    if (next !== child) bound = true
    return next
  })
  return cloneElement(node as ReactElement<Record<string, unknown>>, { children: nextChildren })
}

function bindFirstControl(nodes: ReactNode, fieldId: string, hintId?: string): ReactNode {
  let bound = false
  return Children.map(nodes, child => {
    if (bound || !isValidElement(child)) return child
    const next = bindFieldControl(child, fieldId, hintId)
    if (next !== child) bound = true
    return next
  })
}

export function FormField({
  label, required, hint, children, className = '', htmlFor,
}: {
  label: string
  required?: boolean
  hint?: string
  children: React.ReactNode
  className?: string
  htmlFor?: string
}) {
  const autoId = useId()
  const fieldId = htmlFor || autoId
  const hintId = hint ? `${fieldId}-hint` : undefined

  return (
    <div className={className}>
      <label htmlFor={fieldId} className="mb-1 flex items-center gap-1 text-xs font-medium text-text-secondary">
        {required && <span className="text-red-500" aria-hidden="true">*</span>}
        {label}
      </label>
      {bindFirstControl(children, fieldId, hintId)}
      {hint && (
        <p id={hintId} className="mt-1 text-[10px] leading-relaxed text-amber-600">
          {hint}
        </p>
      )}
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
