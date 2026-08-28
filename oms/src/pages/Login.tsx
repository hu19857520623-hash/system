import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  Eye, EyeOff,
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

export default function Login() {
  const navigate = useNavigate()
  const { login, isLoggedIn, mustChangePassword, authReady } = useRole()
  const [username, setUsername] = useState(readSavedUsername)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [remember, setRemember] = useState(readRememberPreference)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

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
      } else {
        setError(loginError instanceof Error ? loginError.message : '登录失败，请稍后重试')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#f3f5f8] px-4 py-10">
      <div className="w-full max-w-[420px]">
        <header className="mb-8 flex flex-col items-center text-center">
          <img
            src="/ketuo-logo.png"
            alt="特柯洛海外仓"
            className="h-24 w-24 rounded-full object-cover shadow-[0_12px_32px_rgba(15,23,42,0.18)] ring-4 ring-white"
          />
          <h1 className="mt-5 text-[22px] font-semibold tracking-wide text-slate-900">
            特柯洛海外仓
          </h1>
          <p className="mt-1 text-sm text-slate-500">OMS 客户协同平台</p>
        </header>

        <Card className="overflow-hidden shadow-[0_18px_40px_rgba(15,23,42,0.08)]" padding>
          <div className="mb-5">
            <h2 className="text-lg font-semibold text-text-primary">登录</h2>
            <p className="mt-1 text-sm text-text-secondary">
              使用 ERP 为您开通的客户账号进入系统
            </p>
          </div>

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
  )
}
