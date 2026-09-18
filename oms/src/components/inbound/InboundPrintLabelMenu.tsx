import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Printer } from 'lucide-react'
import { actionLinkClass } from '../outbound/PodReceiptModals'
import { INBOUND_DOWNLOAD_ITEMS } from '../../data/customerShipFlows'
import { printInboundLabels, type InboundLabelKind } from '../../data/inboundLabelPrint'
import { printInboundReceivingList } from '../../data/inboundReceivingListPrint'
import { useProducts } from '../../data/inventoryStore'
import type { InboundOrder, InboundStatus } from '../../data/mockData'

export function canPrintInboundLabels(status: InboundStatus) {
  return !['draft', 'voided'].includes(status)
}

export function InboundPrintLabelMenu({ order }: { order: InboundOrder }) {
  const products = useProducts()
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  useEffect(() => {
    if (!open || !buttonRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    const menuWidth = 136
    setPos({
      top: rect.bottom + 4,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - menuWidth - 8)),
    })
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const onScroll = () => setOpen(false)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  if (!canPrintInboundLabels(order.status)) return null

  const items = [
    {
      label: '入库清单',
      run: () => { printInboundReceivingList(order, products) },
    },
    ...INBOUND_DOWNLOAD_ITEMS.map(label => ({
      label,
      run: () => { void printInboundLabels(order, label as InboundLabelKind) },
    })),
  ]

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={actionLinkClass()}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(value => !value)}
      >
        <Printer className="h-3 w-3 shrink-0" />
        <span>打印标签</span>
        <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          role="menu"
          className="fixed z-50 min-w-[132px] overflow-hidden rounded-lg border border-border-light bg-white py-1 shadow-[0_8px_24px_rgba(15,23,42,0.12)]"
          style={{ top: pos.top, left: pos.left }}
        >
          {items.map(item => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className="block w-full px-3 py-1.5 text-left text-xs font-medium text-text-secondary hover:bg-primary-50 hover:text-primary-700"
              onClick={() => {
                item.run()
                setOpen(false)
              }}
            >
              {item.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}
