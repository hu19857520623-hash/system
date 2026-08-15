import { useEffect, useState, type ReactNode } from 'react'
import { apiGet, type BootstrapData } from '../api/client'
import { hydrateEntities, setEntityError } from './entityStore'
import { hydrateInventory } from './inventoryStore'
import { hydrateOutbound } from './outboundStore'
import { hydrateLogistics } from './logisticsStore'
import { hydrateBilling } from './billingStore'
import { hydrateFeeTemplates } from './feeTemplateStore'
import { hydratePaymentMethods } from './paymentMethodStore'
import { hydrateAccounts } from '../auth/accountStore'
import { useRole } from '../auth/RoleContext'

let bootPromise: Promise<void> | null = null
let bootSessionKey = ''
let bootGeneration = 0

export async function bootstrapFromApi(sessionKey: string, force = false) {
  if (!sessionKey) throw new Error('登录状态已失效，请重新登录')
  if (force || bootSessionKey !== sessionKey) {
    bootPromise = null
    bootSessionKey = sessionKey
  }
  if (!bootPromise) {
    const generation = ++bootGeneration
    bootPromise = (async () => {
      const data = await apiGet<BootstrapData>('/bootstrap')
      if (generation !== bootGeneration) return
      hydrateEntities(data)
      hydrateInventory({
        inventory: data.inventory,
        products: data.products,
        purchases: data.purchases,
        accounts: data.accounts,
      })
      hydrateOutbound(data.outboundOrders)
      hydrateLogistics(data.logistics)
      hydrateBilling({
        creditBalance: data.billing?.creditBalance ?? 0,
        feeRecords: data.feeRecords,
      })
      hydrateFeeTemplates(data.feeTemplates)
      hydratePaymentMethods(data.paymentMethods)
      hydrateAccounts(data.accounts)
    })().catch(err => {
      if (generation === bootGeneration) {
        bootPromise = null
        setEntityError(err instanceof Error ? err.message : String(err))
      }
      throw err
    })
  }
  return bootPromise
}

export function DataBootstrap({ children }: { children: ReactNode }) {
  const { isLoggedIn, authReady, authToken, mustChangePassword } = useRole()
  const [bootedSessionKey, setBootedSessionKey] = useState('')
  const [bootingSessionKey, setBootingSessionKey] = useState('')
  const [bootError, setBootError] = useState('')

  useEffect(() => {
    if (!authReady || !isLoggedIn || !authToken || mustChangePassword) {
      setBootedSessionKey('')
      setBootingSessionKey('')
      setBootError('')
      return
    }
    let cancelled = false
    setBootingSessionKey(authToken)
    setBootError('')
    bootstrapFromApi(authToken)
      .then(() => {
        if (!cancelled) setBootedSessionKey(authToken)
      })
      .catch(error => {
        if (!cancelled) setBootError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (!cancelled) setBootingSessionKey('')
      })
    return () => { cancelled = true }
  }, [authReady, authToken, isLoggedIn, mustChangePassword])

  if (!authReady) {
    return <div className="min-h-screen bg-slate-50" />
  }

  if (!isLoggedIn || !authToken || mustChangePassword) return <>{children}</>

  if (bootError && bootingSessionKey !== authToken) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-6">
        <div className="max-w-md text-center space-y-3">
          <div className="text-lg font-semibold text-slate-800">无法连接数据库 API</div>
          <p className="text-sm text-slate-500 break-all">{bootError}</p>
          <button
            type="button"
            className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm"
            onClick={() => window.location.reload()}
          >
            重试
          </button>
        </div>
      </div>
    )
  }

  if (bootedSessionKey !== authToken) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-600">
        <div className="text-center space-y-2">
          <div className="text-sm font-medium">正在从数据库加载数据…</div>
          <div className="text-xs text-slate-400">请确认 API 服务已启动（npm run dev）</div>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
