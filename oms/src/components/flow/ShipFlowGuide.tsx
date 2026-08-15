import { Link } from 'react-router-dom'
import { ExternalLink, ChevronRight } from 'lucide-react'
import { Card } from '../ui'
import type { FlowKind, ShipFlowStep } from '../../data/customerShipFlows'

interface ShipFlowGuideProps {
  title: string
  steps: ShipFlowStep[]
  kind?: FlowKind
  /** 高亮当前步骤 id */
  activeStepId?: string
  compact?: boolean
}

export default function ShipFlowGuide({ title, steps, kind, activeStepId, compact }: ShipFlowGuideProps) {
  const activeIdx = activeStepId ? steps.findIndex(s => s.id === activeStepId) : -1

  if (compact) {
    return (
      <div className="rounded-xl bg-surface-muted/50 p-3 ring-1 ring-border-light">
        <p className="mb-2 text-xs font-semibold text-text-primary">{title}</p>
        <div className="flex flex-wrap items-center gap-1">
          {steps.map((step, i) => (
            <span key={step.id} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3 w-3 shrink-0 text-text-muted" />}
              {step.route && !step.external ? (
                <Link
                  to={step.route}
                  className={`rounded-md px-2 py-0.5 text-[11px] font-medium hover:underline ${
                    step.id === activeStepId ? 'bg-primary-100 text-primary-800' : 'text-primary-700'
                  }`}
                >
                  {step.order}. {step.title}
                </Link>
              ) : (
                <span className={`rounded-md px-2 py-0.5 text-[11px] ${
                  step.external ? 'bg-orange-50 text-orange-800' : 'text-text-secondary'
                } ${step.id === activeStepId ? 'ring-1 ring-primary-200' : ''}`}>
                  {step.order}. {step.title}
                </span>
              )}
            </span>
          ))}
        </div>
      </div>
    )
  }

  return (
    <Card className={`overflow-hidden ${kind === 'manual' ? 'ring-1 ring-violet-100' : ''}`}>
      <div className="border-b border-border-light bg-gradient-to-r from-primary-50/60 to-white px-5 py-4">
        <p className="text-sm font-semibold text-text-primary">{title}</p>
        <p className="mt-0.5 text-xs text-text-muted">共 {steps.length} 步 · 按顺序操作</p>
      </div>
      <ol className="divide-y divide-border-light">
        {steps.map((step, i) => {
          const isActive = step.id === activeStepId
          const isDone = activeIdx >= 0 && i < activeIdx
          return (
            <li
              key={step.id}
              className={`flex gap-4 px-5 py-4 ${isActive ? 'bg-primary-50/50' : ''}`}
            >
              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                isActive ? 'bg-primary-600 text-white'
                  : isDone ? 'bg-emerald-100 text-emerald-700'
                    : step.external ? 'bg-orange-100 text-orange-700'
                      : 'bg-surface-muted text-text-secondary'
              }`}>
                {step.order}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-text-primary">{step.title}</p>
                  {step.external && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-orange-50 px-2 py-0.5 text-[10px] font-semibold text-orange-700">
                      <ExternalLink className="h-3 w-3" /> {step.externalLabel ?? '外部平台'}
                    </span>
                  )}
                  <span className="text-[10px] text-text-muted">{step.module}</span>
                </div>
                <p className="mt-1 text-xs text-text-secondary">{step.desc}</p>
                {step.route && !step.external && (
                  <Link to={step.route} className="mt-2 inline-block text-xs font-medium text-primary-600 hover:underline">
                    前往操作 →
                  </Link>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </Card>
  )
}
