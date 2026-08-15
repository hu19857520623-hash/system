import { Shield } from 'lucide-react'
import { useRole } from '../../auth/RoleContext'

/** Identity is server-issued; this is an admin identity badge, not a role picker. */
export default function RoleSwitcher() {
  const { role, roleLabel } = useRole()
  if (role !== 'sys_admin') return null
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-muted px-3 py-2 text-xs font-medium text-text-secondary">
      <Shield className="h-3.5 w-3.5 text-primary-600" />
      <span>{roleLabel}</span>
    </div>
  )
}
