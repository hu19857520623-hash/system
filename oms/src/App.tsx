import { Routes, Route, Navigate } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import Layout from './components/layout/Layout'
import { useRole } from './auth/RoleContext'
import { DataBootstrap } from './data/DataBootstrap'

const Login = lazy(() => import('./pages/Login'))
const ChangePassword = lazy(() => import('./pages/ChangePassword'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const InventoryPage = lazy(() => import('./pages/Inventory'))
const BillingPage = lazy(() => import('./pages/Billing'))
const BillingTemplates = lazy(() => import('./pages/BillingTemplates'))
const RegionTemplates = lazy(() => import('./pages/RegionTemplates'))
const ReturnApply = lazy(() => import('./pages/ReturnApply'))
const ReturnProcessing = lazy(() => import('./pages/ReturnProcessing'))
const Catalog = lazy(() => import('./pages/Catalog'))
const Products = lazy(() => import('./pages/Products'))
const ProductCreate = lazy(() => import('./pages/ProductCreate'))
const ProductDetail = lazy(() => import('./pages/ProductDetail'))
const Codes = lazy(() => import('./pages/Codes'))
const Inbound = lazy(() => import('./pages/Inbound'))
const InboundRecords = lazy(() => import('./pages/InboundRecords'))
const InboundQc = lazy(() => import('./pages/InboundQc'))
const Outbound = lazy(() => import('./pages/Outbound'))
const OutboundRecords = lazy(() => import('./pages/OutboundRecords'))
const Messages = lazy(() => import('./pages/Messages'))
const Reports = lazy(() => import('./pages/Reports'))
const Accounts = lazy(() => import('./pages/Accounts'))

function BusinessGate() {
  const { authReady, authToken, isLoggedIn, mustChangePassword } = useRole()
  if (!authReady) return <div className="min-h-screen bg-surface-muted" />
  if (!isLoggedIn || !authToken) return <Navigate to="/login" replace />
  if (mustChangePassword) return <Navigate to="/change-password" replace />
  return (
    <DataBootstrap>
      <Layout />
    </DataBootstrap>
  )
}

function LoginGate() {
  const { authReady, isLoggedIn, mustChangePassword } = useRole()
  if (!authReady) return <div className="min-h-screen bg-surface-muted" />
  if (isLoggedIn) {
    return <Navigate to={mustChangePassword ? '/change-password' : '/'} replace />
  }
  return <Login />
}

function ChangePasswordGate() {
  const { authReady, isLoggedIn, mustChangePassword } = useRole()
  if (!authReady) return <div className="min-h-screen bg-surface-muted" />
  if (!isLoggedIn) return <Navigate to="/login" replace />
  if (!mustChangePassword) return <Navigate to="/" replace />
  return <ChangePassword />
}

export default function App() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-text-muted">页面加载中…</div>}>
      <Routes>
      <Route path="/login" element={<LoginGate />} />
      <Route path="/change-password" element={<ChangePasswordGate />} />
      <Route element={<BusinessGate />}>
        <Route index element={<Dashboard />} />
        <Route path="home/welcome" element={<Dashboard />} />
        <Route path="orders" element={<Navigate to="/outbound/records" replace />} />
        <Route path="catalog" element={<Catalog />} />
        <Route path="products" element={<Products />} />
        <Route path="products/new" element={<ProductCreate />} />
        <Route path="products/:id/edit" element={<ProductCreate />} />
        <Route path="products/:id" element={<ProductDetail />} />
        <Route path="platform-bindings" element={<Navigate to="/codes?tab=platform" replace />} />
        <Route path="codes" element={<Codes />} />
        <Route path="inbound" element={<Inbound />} />
        <Route path="inbound/new" element={<Navigate to="/inbound" replace />} />
        <Route path="inbound/records" element={<InboundRecords />} />
        <Route path="inbound/qc" element={<InboundQc />} />
        <Route path="outbound/orders" element={<Navigate to="/outbound/records" replace />} />
        <Route path="outbound" element={<Outbound />} />
        <Route path="outbound/new" element={<Navigate to="/outbound" replace />} />
        <Route path="outbound/records" element={<OutboundRecords />} />
        <Route path="inventory" element={<InventoryPage />} />
        <Route path="inventory/alerts" element={<InventoryPage alertsOnly />} />
        <Route path="shipping" element={<Navigate to="/outbound" replace />} />
        <Route path="logistics" element={<Navigate to="/outbound/records" replace />} />
        <Route path="returns" element={<Navigate to="/returns/processing" replace />} />
        <Route path="returns/apply" element={<ReturnApply />} />
        <Route path="returns/processing" element={<ReturnProcessing />} />
        <Route path="messages" element={<Messages />} />
        <Route path="billing" element={<BillingPage />} />
        <Route path="billing/recharge" element={<BillingPage rechargeOnly />} />
        <Route path="system/price-template" element={<BillingTemplates />} />
        <Route path="system/region-template" element={<RegionTemplates />} />
        <Route path="billing/templates" element={<Navigate to="/system/price-template" replace />} />
        <Route path="billing/regions" element={<Navigate to="/system/region-template" replace />} />
        <Route path="stores" element={<Navigate to="/" replace />} />
        <Route path="accounts" element={<Accounts />} />
        <Route path="reports" element={<Reports />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
