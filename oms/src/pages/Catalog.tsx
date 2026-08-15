import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, ShoppingCart, Trash2 } from 'lucide-react'
import { Badge, Button, Card, Drawer, MonoCode, PageHeader, SearchInput, Tabs } from '../components/ui'
import ShipFlowGuide from '../components/flow/ShipFlowGuide'
import { CATALOG_SHIP_FLOW } from '../data/customerShipFlows'
import { formatCurrency } from '../data/mockData'
import {
  useProducts,
  purchaseCatalogProductViaErp,
  getCatalogAvailableQty,
  mergeErpCatalogIntoState,
} from '../data/inventoryStore'
import { getErpCatalog } from '../api/erp'
import { getErpBalance } from '../api/erp'
import { getCreditBalance, setCreditBalanceFromErp, useBilling } from '../data/billingStore'
import { useRole } from '../auth/RoleContext'
import { getCustomerCode, getCustomerIdForRole } from '../data/dataScope'
import { getCustomerSkuDisplay } from '../data/skuCode'

interface CatalogCartLine {
  internalSku: string
  name: string
  spec: string
  price: number
  qty: number
  image: string
  maxAvailable: number
}

interface CheckoutLine extends CatalogCartLine {}

function lineTotal(line: { price: number; qty: number }) {
  return Math.round(line.price * line.qty * 100) / 100
}

export default function Catalog() {
  const { role } = useRole()
  const showCatalogMeta = role === 'catalog' || role === 'hybrid' || role === 'sys_admin'
  const customerId = getCustomerIdForRole(role)
  const customerCode = getCustomerCode(customerId ?? undefined)
  const billing = useBilling()
  const allProducts = useProducts()
  const catalogProducts = allProducts.filter(p => p.inCatalog && p.productStatus === 'available')
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('all')
  const [qtyMap, setQtyMap] = useState<Record<string, string>>({})
  const [cart, setCart] = useState<Record<string, CatalogCartLine>>({})
  const [cartOpen, setCartOpen] = useState(false)
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [checkoutLines, setCheckoutLines] = useState<CheckoutLine[]>([])
  const [checkoutSource, setCheckoutSource] = useState<'cart' | 'buy_now'>('buy_now')
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [busySku, setBusySku] = useState<string | null>(null)
  const [checkoutBusy, setCheckoutBusy] = useState(false)
  const [loadingCatalog, setLoadingCatalog] = useState(false)
  const [syncedAt, setSyncedAt] = useState<string | null>(null)

  const cartCount = useMemo(
    () => Object.values(cart).reduce((sum, item) => sum + item.qty, 0),
    [cart],
  )

  const checkoutTotal = useMemo(
    () => checkoutLines.reduce((sum, line) => sum + lineTotal(line), 0),
    [checkoutLines],
  )

  const refreshFromErp = async () => {
    setLoadingCatalog(true)
    try {
      const catalog = await getErpCatalog()
      await mergeErpCatalogIntoState(catalog.items || [])
      setSyncedAt(catalog.syncedAt)
      if (customerCode && customerCode !== '—') {
        const bal = await getErpBalance(customerCode)
        await setCreditBalanceFromErp(bal.balance)
      }
      setMsg({
        type: 'ok',
        text: `已从 ERP 同步货盘 ${catalog.total} 个 SKU` +
          (customerCode && customerCode !== '—' ? ` · 客户 ${customerCode}` : ''),
      })
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setLoadingCatalog(false)
      setTimeout(() => setMsg(null), 5000)
    }
  }

  useEffect(() => {
    void refreshFromErp()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerCode])

  const filtered = catalogProducts.filter(p => {
    const matchSearch = !search || p.name.includes(search) || p.internalSku.includes(search)
    const matchTab = tab === 'all' || p.category === tab
    return matchSearch && matchTab
  })
  const categories = useMemo(
    () => ['all', ...new Set(catalogProducts.map(p => p.category))],
    [catalogProducts],
  )

  const getQty = (internalSku: string) => {
    const raw = Number(qtyMap[internalSku] || 10)
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 1
  }

  const buildLine = (internalSku: string, qty: number): CatalogCartLine | null => {
    const product = catalogProducts.find(p => p.internalSku === internalSku)
    if (!product) return null
    const maxAvailable = getCatalogAvailableQty(internalSku)
    if (maxAvailable <= 0) return null
    return {
      internalSku,
      name: product.name,
      spec: product.spec || '',
      price: product.price,
      qty: Math.min(Math.max(1, qty), maxAvailable),
      image: product.image,
      maxAvailable,
    }
  }

  const showMsg = (type: 'ok' | 'err', text: string) => {
    setMsg({ type, text })
    setTimeout(() => setMsg(null), 6000)
  }

  const syncCatalogAfterPurchase = async () => {
    try {
      const catalog = await getErpCatalog()
      await mergeErpCatalogIntoState(catalog.items || [])
      setSyncedAt(catalog.syncedAt)
    } catch { /* ignore */ }
  }

  const addToCart = (internalSku: string) => {
    const qty = getQty(internalSku)
    const line = buildLine(internalSku, qty)
    if (!line) {
      showMsg('err', '商品不可售或库存不足')
      return
    }
    setCart(prev => {
      const existing = prev[internalSku]
      const mergedQty = Math.min(
        (existing?.qty ?? 0) + qty,
        line.maxAvailable,
      )
      return {
        ...prev,
        [internalSku]: { ...line, qty: mergedQty },
      }
    })
    showMsg('ok', `已加入购物车 · ${line.name} × ${qty}`)
  }

  const openBuyNow = (internalSku: string) => {
    const qty = getQty(internalSku)
    const line = buildLine(internalSku, qty)
    if (!line) {
      showMsg('err', '商品不可售或库存不足')
      return
    }
    setCheckoutLines([line])
    setCheckoutSource('buy_now')
    setCheckoutOpen(true)
  }

  const openCartCheckout = () => {
    const lines = Object.values(cart)
    if (!lines.length) {
      showMsg('err', '购物车为空')
      return
    }
    setCheckoutLines(lines.map(l => ({ ...l })))
    setCheckoutSource('cart')
    setCheckoutOpen(true)
  }

  const updateCheckoutQty = (internalSku: string, qty: number) => {
    setCheckoutLines(prev => prev.map(line => {
      if (line.internalSku !== internalSku) return line
      const next = Math.min(Math.max(1, Math.floor(qty)), line.maxAvailable)
      return { ...line, qty: next }
    }))
  }

  const removeFromCart = (internalSku: string) => {
    setCart(prev => {
      const next = { ...prev }
      delete next[internalSku]
      return next
    })
  }

  const updateCartQty = (internalSku: string, qty: number) => {
    setCart(prev => {
      const item = prev[internalSku]
      if (!item) return prev
      const nextQty = Math.min(Math.max(1, Math.floor(qty)), item.maxAvailable)
      return { ...prev, [internalSku]: { ...item, qty: nextQty } }
    })
  }

  const confirmCheckout = async () => {
    if (!checkoutLines.length) return
    if (!customerId) {
      showMsg('err', '系统管理员不绑定客户身份，请使用已开通的客户账号申购')
      return
    }
    setCheckoutBusy(true)
    const purchased: string[] = []
    const errors: string[] = []

    for (const line of checkoutLines) {
      setBusySku(line.internalSku)
      const result = await purchaseCatalogProductViaErp(line.internalSku, line.qty, customerId)
      setBusySku(null)
      if (result.ok) {
        purchased.push(`${line.name} × ${line.qty}`)
        if (checkoutSource === 'cart') {
          removeFromCart(line.internalSku)
        }
      } else {
        errors.push(`${line.name}: ${result.error}`)
      }
    }

    await syncCatalogAfterPurchase()
    setCheckoutBusy(false)
    setCheckoutOpen(false)
    setCheckoutLines([])

    if (purchased.length && !errors.length) {
      showMsg(
        'ok',
        `申购成功 ${purchased.length} 项 · 余额 ¥${getCreditBalance().toFixed(2)} · ${purchased.join('；')}`,
      )
      if (checkoutSource === 'cart') setCartOpen(false)
    } else if (purchased.length && errors.length) {
      showMsg('err', `部分成功：${purchased.join('；')}；失败：${errors.join('；')}`)
    } else {
      showMsg('err', errors[0] || '申购失败')
    }
  }

  return (
    <div className="page-shell">
      <PageHeader
        title="货盘选品"
        desc={`对接 ERP 货盘目录与申购 · 客户 ${customerCode}` +
          (syncedAt ? ` · 同步 ${new Date(syncedAt).toLocaleString()}` : '')}
        action={
          <div className="flex items-center gap-2">
            <span className="hidden text-xs text-text-muted sm:inline">
              ERP 余额 {formatCurrency(billing.creditBalance)}
            </span>
            <Button size="sm" variant="secondary" className="relative" onClick={() => setCartOpen(true)}>
              <ShoppingCart className="h-3.5 w-3.5" />
              购物车
              {cartCount > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary-600 px-1 text-[10px] font-bold text-white">
                  {cartCount > 99 ? '99+' : cartCount}
                </span>
              )}
            </Button>
            <Button size="sm" variant="secondary" disabled={loadingCatalog} onClick={() => void refreshFromErp()}>
              <RefreshCw className={`h-3.5 w-3.5 ${loadingCatalog ? 'animate-spin' : ''}`} />
              同步 ERP
            </Button>
          </div>
        }
      />
      <div className="mb-4">
        <ShipFlowGuide title="货盘客户流程" steps={CATALOG_SHIP_FLOW} kind="catalog" activeStepId="catalog-buy" compact />
      </div>

      {msg && (
        <div className={`mb-4 rounded-lg px-4 py-3 text-sm ${msg.type === 'ok' ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-100' : 'bg-red-50 text-red-800 ring-1 ring-red-100'}`}>
          {msg.text}
        </div>
      )}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs tabs={categories.map(c => ({ id: c, label: c === 'all' ? '全部' : c, count: c === 'all' ? catalogProducts.length : catalogProducts.filter(p => p.category === c).length }))} active={tab} onChange={setTab} />
        <div className="flex gap-2">
          <SearchInput placeholder="搜索商品名称或 SKU..." value={search} onChange={setSearch} className="w-64" />
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card className="p-8 text-center text-sm text-text-muted">
          {loadingCatalog ? '正在从 ERP 拉取货盘…' : '暂无 ERP 可售货盘。请先在 ERP 定价中心确认售价并「同步 OMS」。'}
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {filtered.map(p => {
            const available = getCatalogAvailableQty(p.internalSku)
            const canBuy = available > 0 && p.productStatus === 'available'
            const displaySku = getCustomerSkuDisplay(p, customerCode)
            return (
              <Card key={p.id} className="group overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card">
                <div className="relative aspect-[5/4] overflow-hidden bg-surface-subtle">
                  <img src={p.image} alt={p.name} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                  <div className="absolute left-2 top-2 scale-90 origin-top-left"><Badge status="active" label={p.category} /></div>
                  {available < 500 && available > 0 && (
                    <div className="absolute right-2 top-2 rounded-md bg-amber-500 px-1.5 py-0.5 text-[9px] font-semibold text-white shadow-sm">
                      库存紧张
                    </div>
                  )}
                </div>
                <div className="p-2.5">
                  <h3 className="truncate text-xs font-semibold text-text-primary" title={p.name}>{p.name}</h3>
                  <p className="mt-0.5 truncate text-[10px] text-text-muted">{p.spec || '—'}</p>
                  <div className="mt-1.5 text-[10px]"><MonoCode>{displaySku}</MonoCode></div>
                  <div className="mt-2">
                    <p className="text-base font-bold leading-tight text-primary-600">{formatCurrency(p.price)}</p>
                    <p className="text-[10px] text-text-muted">可售 {available.toLocaleString()} 件</p>
                    {showCatalogMeta && (
                      <div className="mt-1.5 space-y-0.5 text-[10px] text-text-muted">
                        <p>
                          库存池 {(p.catalogStockPool ?? available).toLocaleString()} ·
                          已售 {(p.catalogSoldQty ?? 0).toLocaleString()}
                        </p>
                        <p>
                          ERP {p.catalogVisibleOnOms ? '已发布' : '未发布'} ·
                          {p.catalogOrderableOnOms ? ' 可下单' : ' 不可下单'}
                        </p>
                        {p.catalogSyncedAt && (
                          <p>SKU 同步 {new Date(p.catalogSyncedAt).toLocaleString()}</p>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="mt-2 space-y-1.5">
                    <input
                      type="number"
                      min={1}
                      max={available}
                      value={qtyMap[p.internalSku] ?? '10'}
                      onChange={e => setQtyMap(prev => ({ ...prev, [p.internalSku]: e.target.value }))}
                      className="w-full rounded-md border border-border px-2 py-1 text-[11px]"
                      placeholder="数量"
                    />
                    <div className="grid grid-cols-2 gap-1.5">
                      <Button
                        size="sm"
                        variant="secondary"
                        className="!px-2 !py-1 !text-[10px]"
                        title="加入购物车"
                        disabled={!canBuy}
                        onClick={() => addToCart(p.internalSku)}
                      >
                        加购
                      </Button>
                      <Button
                        size="sm"
                        className="!px-2 !py-1 !text-[10px]"
                        title="立即购买"
                        disabled={busySku === p.internalSku || !canBuy}
                        onClick={() => openBuyNow(p.internalSku)}
                      >
                        购买
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <Drawer
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        title="购物车"
        subtitle={<span className="text-xs text-text-muted">共 {cartCount} 件 · 来自 ERP 货盘</span>}
        footer={
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm">
              <span className="text-text-muted">合计 </span>
              <span className="font-bold text-primary-600">
                {formatCurrency(Object.values(cart).reduce((s, l) => s + lineTotal(l), 0))}
              </span>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setCartOpen(false)}>继续选品</Button>
              <Button size="sm" disabled={!cartCount} onClick={openCartCheckout}>去结算</Button>
            </div>
          </div>
        }
      >
        <div className="p-4">
          {!Object.keys(cart).length ? (
            <p className="py-12 text-center text-sm text-text-muted">购物车为空，选品后点击「加入购物车」</p>
          ) : (
            <ul className="space-y-3">
              {Object.values(cart).map(item => (
                <li key={item.internalSku} className="flex gap-3 rounded-xl border border-border-light p-3">
                  <img src={item.image} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-text-primary">{item.name}</p>
                    <p className="mt-0.5 text-xs text-text-muted">{item.spec || '—'}</p>
                    <MonoCode>{getCustomerSkuDisplay({ internalSku: item.internalSku, customerSku: undefined }, customerCode)}</MonoCode>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        max={item.maxAvailable}
                        value={item.qty}
                        onChange={e => updateCartQty(item.internalSku, Number(e.target.value))}
                        className="w-16 rounded border border-border px-2 py-1 text-xs"
                      />
                      <span className="text-xs text-text-muted">× {formatCurrency(item.price)}</span>
                      <span className="text-xs font-semibold text-primary-600">{formatCurrency(lineTotal(item))}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 rounded-lg p-2 text-text-muted hover:bg-red-50 hover:text-red-600"
                    onClick={() => removeFromCart(item.internalSku)}
                    aria-label="移除"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Drawer>

      {checkoutOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/25 p-4 backdrop-blur-sm" onClick={() => !checkoutBusy && setCheckoutOpen(false)}>
          <div
            className="w-full max-w-lg rounded-2xl border border-border-light bg-white shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="border-b border-border-light px-6 py-4">
              <h2 className="text-lg font-semibold text-text-primary">
                {checkoutSource === 'buy_now' ? '立即购买 · 确认清单' : '购物车结算 · 确认清单'}
              </h2>
              <p className="mt-1 text-xs text-text-muted">
                请核对 SKU 与数量，确认后将从 ERP 余额扣款并完成申购
              </p>
            </div>
            <div className="max-h-[50vh] overflow-y-auto px-6 py-4">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border-light text-xs text-text-muted">
                    <th className="pb-2 font-medium">商品</th>
                    <th className="pb-2 font-medium w-20 text-right">数量</th>
                    <th className="pb-2 font-medium w-20 text-right">小计</th>
                  </tr>
                </thead>
                <tbody>
                  {checkoutLines.map(line => (
                    <tr key={line.internalSku} className="border-b border-border-light/80">
                      <td className="py-3 pr-2">
                        <p className="font-medium text-text-primary">{line.name}</p>
                        <p className="mt-0.5 text-xs text-text-muted">
                          {getCustomerSkuDisplay({ internalSku: line.internalSku, customerSku: undefined }, customerCode)}
                        </p>
                        <p className="text-xs text-text-muted">{formatCurrency(line.price)} / 件</p>
                      </td>
                      <td className="py-3 text-right align-top">
                        <input
                          type="number"
                          min={1}
                          max={line.maxAvailable}
                          value={line.qty}
                          disabled={checkoutBusy}
                          onChange={e => updateCheckoutQty(line.internalSku, Number(e.target.value))}
                          className="w-16 rounded border border-border px-2 py-1 text-xs text-right"
                        />
                      </td>
                      <td className="py-3 text-right align-top font-medium">{formatCurrency(lineTotal(line))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-border-light bg-surface-muted/40 px-6 py-4">
              <div className="mb-4 flex items-center justify-between text-sm">
                <span className="text-text-muted">合计（{checkoutLines.length} 项）</span>
                <span className="text-lg font-bold text-primary-600">{formatCurrency(checkoutTotal)}</span>
              </div>
              <div className="mb-4 text-xs text-text-muted">
                当前 ERP 余额 {formatCurrency(billing.creditBalance)}
                {checkoutTotal > billing.creditBalance && (
                  <span className="ml-2 text-red-600">余额不足</span>
                )}
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" size="sm" disabled={checkoutBusy} onClick={() => setCheckoutOpen(false)}>
                  取消
                </Button>
                <Button
                  size="sm"
                  disabled={checkoutBusy || checkoutTotal > billing.creditBalance || !checkoutLines.length}
                  onClick={() => void confirmCheckout()}
                >
                  {checkoutBusy ? '提交 ERP…' : '确认购买'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
