import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Button, Card } from '../components/ui'
import { FormField, formInput } from '../components/ui/form'
import { useRole } from '../auth/RoleContext'

export default function ChangePassword() {
  const navigate = useNavigate()
  const { authReady, isLoggedIn, mustChangePassword, changePassword, logout } = useRole()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  if (!authReady) return <div className="min-h-screen bg-surface-muted" />
  if (!isLoggedIn) return <Navigate to="/login" replace />
  if (!mustChangePassword) return <Navigate to="/" replace />

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    if (!currentPassword) {
      setError('请输入当前临时密码')
      return
    }
    if (
      newPassword.length < 6
      || newPassword.length > 128
    ) {
      setError('新密码须为 6-128 位')
      return
    }
    if (newPassword !== confirmation) {
      setError('两次输入的新密码不一致')
      return
    }
    setSaving(true)
    try {
      await changePassword(currentPassword, newPassword)
      navigate('/', { replace: true })
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : '密码修改失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-muted p-6">
      <Card padding className="w-full max-w-md shadow-card">
        <h1 className="text-xl font-semibold text-text-primary">首次登录，请修改密码</h1>
        <p className="mt-2 text-sm text-text-muted">完成密码修改后才能进入业务系统。</p>
        <form className="mt-6 space-y-4" onSubmit={submit}>
          <FormField label="当前临时密码" required>
            <input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={event => setCurrentPassword(event.target.value)}
              className={formInput()}
            />
          </FormField>
          <FormField label="新密码" hint="6-128 位" required>
            <input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={event => setNewPassword(event.target.value)}
              className={formInput()}
            />
          </FormField>
          <FormField label="确认新密码" required>
            <input
              type="password"
              autoComplete="new-password"
              value={confirmation}
              onChange={event => setConfirmation(event.target.value)}
              className={formInput()}
            />
          </FormField>
          {error && <p className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{error}</p>}
          <Button type="submit" className="w-full" disabled={saving}>
            {saving ? '保存中…' : '修改密码并进入系统'}
          </Button>
          <button
            type="button"
            className="w-full text-xs text-text-muted hover:text-text-secondary"
            onClick={() => { void logout(); navigate('/login', { replace: true }) }}
          >
            退出登录
          </button>
        </form>
      </Card>
    </div>
  )
}
