import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  Eye, EyeOff, ArrowDownToLine, ArrowUpFromLine, Package, Wallet,
  Lock, User,
} from 'lucide-react'
import { Button, Card } from '../components/ui'
import { FormField, formInput } from '../components/ui/form'
import { useRole } from '../auth/RoleContext'

const LOGIN_USERNAME_KEY = 'oms-login-username'
const LOGIN_EMAIL_KEY = 'oms-login-email'
const REMEMBER_KEY = 'oms-remember-login'

function readSavedUsername() {
  try {
    const saved = localStorage.getItem(LOGIN_USERNAME_KEY)
    if (saved) return saved
    const legacy = localStorage.getItem(LOGIN_EMAIL_KEY) || ''
    return legacy.includes('@') ? '' : legacy
  } catch {
    return ''
  }
}

function readRememberPreference() {
  try {
    return localStorage.getItem(REMEMBER_KEY) !== '0'
  } catch {
    return true
  }
}

const FEATURES = [
  { icon: ArrowDownToLine, label: '预约入库', desc: '预报单 · 箱唛标签' },
  { icon: ArrowUpFromLine, label: '预约发货', desc: 'Takealot 入仓' },
  { icon: Package, label: '库存查询', desc: '自有 / 货盘双池' },
  { icon: Wallet, label: '费用管理', desc: '预扣 · 充值 · 账单' },
]

function OmsLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`flex items-center gap-2.5 ${compact ? '' : ''}`}>
      <div className={`flex shrink-0 items-center justify-center rounded bg-white/20 font-bold text-white ${compact ? 'h-8 w-8 text-xs' : 'h-9 w-9 text-sm'}`}>
        Ai
      </div>
      <div>
        <p className={`font-semibold text-white ${compact ? 'text-sm' : 'text-base'}`}>OMS-订单管理系统</p>
        {!compact && <p className="text-[11px] text-white/70">Takealot Overseas Warehouse</p>}
      </div>
    </div>
  )
}

export default function Login() {
  const navigate = useNavigate()
  const { login, isLoggedIn, mustChangePassword, authReady } = useRole()
  const [username, setUsername] = useState(readSavedUsername)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [remember, setRemember] = useState(readRememberPreference)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [apiOnline, setApiOnline] = useState<boolean | null>(null)

  useEffect(() => {
    fetch('/api/health')
      .then((res) => setApiOnline(res.ok))
      .catch(() => setApiOnline(false))
  }, [])

  useEffect(() => {
    if (!authReady || !isLoggedIn) return
    navigate(mustChangePassword ? '/change-password' : '/', { replace: true })
  }, [authReady, isLoggedIn, mustChangePassword, navigate])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!username.trim()) {
      setError('请输入登录账号')
      return
    }
    if (username.trim().length < 6) {
      setError('登录账号至少 6 个字符')
      return
    }
    if (!password) {
      setError('请输入密码')
      return
    }
    if (password.length < 6) {
      setError('密码至少 6 个字符')
      return
    }

    setSubmitting(true)
    try {
      const loginUsername = username.trim().toLowerCase()
      const user = await login(loginUsername, password, remember)
      try {
        localStorage.setItem(REMEMBER_KEY, remember ? '1' : '0')
        if (remember) localStorage.setItem(LOGIN_USERNAME_KEY, loginUsername)
        else localStorage.removeItem(LOGIN_USERNAME_KEY)
        localStorage.removeItem(LOGIN_EMAIL_KEY)
      } catch {
        /* ignore quota / private mode */
      }
      navigate(user.mustChangePassword ? '/change-password' : '/', { replace: true })
    } catch (loginError) {
      const status = (loginError as { status?: number } | null)?.status
      if (status === 401) {
        setError('账号或密码不正确，或账号已停用')
      } else if (status === 429) {
        setError('登录尝试过于频繁，请稍后再试')
      } else if (
        (loginError as { code?: string } | null)?.code === 'NETWORK'
        || loginError instanceof TypeError
      ) {
        setError('无法连接 OMS 服务（127.0.0.1:3001）。请运行仓库根目录 dev-local.ps1，或单独启动 oms。')
      } else {
        setError(loginError instanceof Error ? loginError.message : '登录失败，请稍后重试')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen bg-surface-muted">
      {/* 左侧品牌区 — 与首页看板 / 侧栏顶栏同系红色 */}
      <div className="relative hidden overflow-hidden lg:flex lg:w-[46%] xl:w-1/2 lg:flex-col lg:justify-between">
        <div className="absolute inset-0 bg-gradient-to-br from-primary-600 via-[#c62828] to-[#8b0000]" />
        <div className="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-white/5 blur-3xl" />
        <div className="absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-black/10 blur-3xl" />

        <div className="relative p-10 xl:p-12">
          <OmsLogo />
        </div>

        <div className="relative px-10 pb-4 xl:px-12">
          <p className="text-xs font-medium uppercase tracking-widest text-white/60">Overseas Warehouse System</p>
          <h1 className="mt-3 text-3xl font-semibold leading-tight text-white xl:text-4xl">
            海外仓客户协同平台
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-white/85">
            预约入库、预约发货、库存查询与费用管理 — 参考 Buffalo 海外仓 WMS 标准流程，服务 Takealot 南非履约场景。
          </p>

          <div className="mt-10 grid grid-cols-2 gap-3">
            {FEATURES.map(({ icon: Icon, label, desc }) => (
              <div
                key={label}
                className="rounded-xl bg-white/10 px-4 py-3.5 ring-1 ring-white/10 backdrop-blur-sm transition-colors hover:bg-white/15"
              >
                <Icon className="mb-2 h-5 w-5 text-white/90" />
                <p className="text-sm font-semibold text-white">{label}</p>
                <p className="mt-0.5 text-[11px] text-white/65">{desc}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="relative px-10 pb-8 text-[11px] text-white/45 xl:px-12">
          © 2026 Takealot OMS
        </p>
      </div>

      {/* 右侧登录表单 */}
      <div className="flex flex-1 flex-col">
        <div className="flex h-12 items-center gap-2 bg-primary-600 px-4 lg:hidden">
          <div className="flex h-7 w-7 items-center justify-center rounded bg-white/20 text-xs font-bold text-white">Ai</div>
          <span className="text-sm font-semibold text-white">OMS-订单管理系统</span>
        </div>

        <div className="flex flex-1 items-center justify-center p-6 sm:p-10">
          <div className="w-full max-w-[420px]">
            <div className="mb-8">
              <p className="text-[11px] font-medium uppercase tracking-wide text-primary-600">Sign In</p>
              <h2 className="mt-1 text-2xl font-semibold tracking-tight text-text-primary">欢迎登录</h2>
              <p className="mt-2 text-sm text-text-secondary">
                使用 ERP 为您开通的客户账号登录 OMS
              </p>
            </div>

            <Card className="overflow-hidden shadow-card" padding>
              {apiOnline === false && (
                <div className="mb-4 rounded-lg bg-red-50 px-3 py-2.5 text-xs text-red-700 ring-1 ring-red-100">
                  OMS 服务未启动（127.0.0.1:3001）。请运行仓库根目录 dev-local.ps1，或单独启动 oms。
                </div>
              )}
              <form className="space-y-5" onSubmit={handleSubmit}>
                <FormField label="登录账号" required>
                  <div className="relative">
                    <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                    <input
                      type="text"
                      autoComplete="username"
                      value={username}
                      onChange={e => { setUsername(e.target.value); setError('') }}
                      placeholder="至少 6 个字符"
                      disabled={submitting}
                      className={formInput('pl-10')}
                    />
                  </div>
                </FormField>

                <FormField label="登录密码" required>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      value={password}
                      onChange={e => { setPassword(e.target.value); setError('') }}
                      placeholder="至少 6 个字符"
                      disabled={submitting}
                      className={formInput('pl-10 pr-10')}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary"
                      aria-label={showPassword ? '隐藏密码' : '显示密码'}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </FormField>

                <div className="flex items-center justify-between text-xs">
                  <label className="flex cursor-pointer items-center gap-2 text-text-secondary">
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={e => setRemember(e.target.checked)}
                      className="rounded border-border text-primary-600 focus:ring-primary-500"
                    />
                    记住账号
                  </label>
                  <span className="text-text-muted">忘记密码请联系系统管理员重置</span>
                </div>

                {error && (
                  <div className="rounded-lg bg-red-50 px-3 py-2.5 text-xs text-red-700 ring-1 ring-red-100">
                    {error}
                  </div>
                )}

                <Button type="submit" size="md" className="w-full" disabled={submitting}>
                  {submitting ? '登录中…' : '登录'}
                  {!submitting && <ArrowRight className="h-4 w-4" />}
                </Button>
              </form>
            </Card>

            <p className="mt-6 text-center text-[11px] text-text-muted">
              首次登录后必须修改临时密码
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
