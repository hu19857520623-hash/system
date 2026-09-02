<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { erpConfirm } from '@/utils/messageBox'
import { usersApi, permissionsApi } from '@/api/client.js'
import { mapUser } from '@/api/mappers.ts'
import { withAction } from '@/composables/useListLoader.ts'
import { useAppStore } from '@/stores/app'
import ListPagination from '@/components/ListPagination.vue'
import { PERM_GROUPS as FALLBACK_PERM_GROUPS } from '@erp/shared/permissions.catalog'

const app = useAppStore()

interface BackendRole {
  roleCode: string
  roleName: string
}

interface PermGroup {
  label: string
  perms: { id: string; label: string }[]
}

type StatusFilter = 'all' | 'active' | 'disabled'

const permGroupsUI = ref<PermGroup[]>([...FALLBACK_PERM_GROUPS])
const permSearch = ref('')
const permCollapseActive = ref<string[]>(FALLBACK_PERM_GROUPS.map((g) => g.label))
const ALL_PERM_IDS = computed(() => permGroupsUI.value.flatMap((g) => g.perms.map((p) => p.id)))

const filteredPermGroups = computed(() => {
  const q = permSearch.value.trim().toLowerCase()
  if (!q) return permGroupsUI.value
  return permGroupsUI.value
    .map((group) => ({
      ...group,
      perms: group.perms.filter(
        (p) => p.label.toLowerCase().includes(q) || p.id.toLowerCase().includes(q),
      ),
    }))
    .filter((group) => group.perms.length > 0)
})

function groupSelectedCount(perms: { id: string }[]) {
  return perms.filter((p) => selectedPerms.value.includes(p.id)).length
}

const statusFilter = ref<StatusFilter>('all')
const roleFilter = ref('all')
const searchQ = ref('')
const page = ref(1)
const pageSize = ref(20)
const listTotal = ref(0)
const loading = ref(false)
const rows = ref<ReturnType<typeof mapUser>[]>([])
const backendRoles = ref<BackendRole[]>([])

const statusCounts = ref({ all: 0, active: 0, disabled: 0 })

const canManage = computed(() => app.hasPerm('permissions.manage'))

const filterTabs = computed(() => [
  { value: 'all' as const, label: '全部', count: statusCounts.value.all },
  { value: 'active' as const, label: '正常', count: statusCounts.value.active },
  { value: 'disabled' as const, label: '停用', count: statusCounts.value.disabled },
])

const roleOptions = computed(() => [
  { value: 'all', label: '全部角色' },
  ...backendRoles.value.map((r) => ({ value: r.roleCode, label: r.roleName })),
])

function resolveRoleName(roleCode: string) {
  return backendRoles.value.find((r) => r.roleCode === roleCode)?.roleName || roleCode
}

function buildParams(extra: Record<string, unknown> = {}) {
  const params: Record<string, unknown> = { page: page.value, pageSize: pageSize.value, ...extra }
  if (statusFilter.value !== 'all') params.status = statusFilter.value
  if (roleFilter.value !== 'all') params.roleCode = roleFilter.value
  const q = searchQ.value.trim()
  if (q) params.keyword = q
  return params
}

async function refreshCounts() {
  try {
    const [all, active, disabled] = await Promise.all([
      usersApi.list({ pageSize: 1 }),
      usersApi.list({ pageSize: 1, status: 'active' }),
      usersApi.list({ pageSize: 1, status: 'disabled' }),
    ])
    statusCounts.value = {
      all: all.total ?? 0,
      active: active.total ?? 0,
      disabled: disabled.total ?? 0,
    }
  } catch {
    // ignore
  }
}

async function load() {
  loading.value = true
  try {
    const res = await usersApi.list(buildParams())
    rows.value = (res.items || []).map(mapUser)
    listTotal.value = res.total ?? rows.value.length
  } catch (e: any) {
    ElMessage.error(e?.message || '加载失败')
  } finally {
    loading.value = false
  }
}

async function reloadAll() {
  await Promise.all([load(), refreshCounts()])
}

function resetFilters() {
  searchQ.value = ''
  roleFilter.value = 'all'
  page.value = 1
  load()
}

// ── 创建 ──
const createVisible = ref(false)
const createForm = ref({
  username: '',
  password: '123456',
  realName: '',
  roleCode: 'cs',
  phone: '',
  email: '',
  status: 1,
})

function openCreate() {
  createForm.value = {
    username: '',
    password: '123456',
    realName: '',
    roleCode: backendRoles.value[0]?.roleCode || 'cs',
    phone: '',
    email: '',
    status: 1,
  }
  createVisible.value = true
}

async function submitCreate() {
  const f = createForm.value
  if (!f.username || !f.password || !f.realName || !f.roleCode) {
    ElMessage.warning('请填写登录名、密码、姓名和角色')
    return
  }
  const ok = await withAction(async () => {
    const user = await usersApi.create({
      username: f.username,
      password: f.password,
      realName: f.realName,
      roleCode: f.roleCode,
      phone: f.phone || undefined,
      email: f.email || undefined,
      status: f.status,
    })
    const roleName = resolveRoleName(f.roleCode)
    await usersApi.setPermissions(user.id, app.templatePermsForRole(roleName))
    await reloadAll()
  }, '用户已创建，已绑定角色默认权限')
  if (ok) createVisible.value = false
}

// ── 编辑 + 权限绑定 ──
const editVisible = ref(false)
const editSaving = ref(false)
const editingId = ref<number | null>(null)
const editForm = ref({
  login: '',
  realName: '',
  roleCode: '',
  phone: '',
  email: '',
  status: 1,
  password: '',
})
const selectedPerms = ref<string[]>([])
const permSource = ref<'custom' | 'role'>('role')

async function openEdit(row: any) {
  editingId.value = row.id
  editForm.value = {
    login: row.login,
    realName: row.name,
    roleCode: row.roleCode || row._raw?.roleCode || '',
    phone: row.phone || '',
    email: row.email || '',
    status: row.statusCode ?? (row.status === 'ok' ? 1 : 0),
    password: '',
  }
  try {
    const res = await usersApi.getPermissions(row.id)
    selectedPerms.value = res.permissions || []
    permSource.value = row._raw?.hasCustomPermissions ? 'custom' : 'role'
  } catch {
    selectedPerms.value = [...app.templatePermsForRole(row.role)]
    permSource.value = 'role'
  }
  editVisible.value = true
}

function onRoleChange(roleCode: string) {
  const roleName = resolveRoleName(roleCode)
  selectedPerms.value = [...app.templatePermsForRole(roleName)]
  permSource.value = 'role'
  ElMessage.info(`已切换为「${roleName}」默认权限，可继续手动勾选调整`)
}

function applyRoleTemplate() {
  const roleName = resolveRoleName(editForm.value.roleCode)
  selectedPerms.value = app.templatePermsForRole(roleName)
  permSource.value = 'role'
  ElMessage.success(`已加载「${roleName}」角色默认权限`)
}

function togglePerm(permId: string, checked: boolean) {
  permSource.value = 'custom'
  const set = new Set(selectedPerms.value)
  if (checked) set.add(permId)
  else set.delete(permId)
  selectedPerms.value = [...set]
}

function toggleGroup(perms: { id: string }[], checked: boolean) {
  permSource.value = 'custom'
  const set = new Set(selectedPerms.value)
  perms.forEach((p) => (checked ? set.add(p.id) : set.delete(p.id)))
  selectedPerms.value = [...set]
}

function isGroupAllChecked(perms: { id: string }[]) {
  return perms.every((p) => selectedPerms.value.includes(p.id))
}

function isGroupIndeterminate(perms: { id: string }[]) {
  const n = perms.filter((p) => selectedPerms.value.includes(p.id)).length
  return n > 0 && n < perms.length
}

function selectAllPerms() {
  permSource.value = 'custom'
  selectedPerms.value = [...ALL_PERM_IDS.value]
}

function clearAllPerms() {
  permSource.value = 'custom'
  selectedPerms.value = []
}

async function submitEdit() {
  if (!editingId.value) return
  if (!editForm.value.realName || !editForm.value.roleCode) {
    ElMessage.warning('请填写姓名和角色')
    return
  }
  if (editingId.value === app.authenticatedUser?.id && editForm.value.status === 0) {
    ElMessage.warning('不能停用当前登录账号')
    return
  }
  editSaving.value = true
  try {
    const payload: Record<string, unknown> = {
      realName: editForm.value.realName,
      roleCode: editForm.value.roleCode,
      phone: editForm.value.phone || undefined,
      email: editForm.value.email || undefined,
      status: editForm.value.status,
    }
    if (editForm.value.password) payload.password = editForm.value.password
    await usersApi.update(editingId.value, payload)
    await usersApi.setPermissions(editingId.value, selectedPerms.value)
    if (app.authenticatedUser?.id === editingId.value) {
      await app.refreshProfile()
    }
    ElMessage.success('用户信息与岗位权限已保存')
    editVisible.value = false
    await reloadAll()
  } catch (e: any) {
    ElMessage.error(e?.message || '保存失败')
  } finally {
    editSaving.value = false
  }
}

async function toggleStatus(row: any) {
  if (!canManage.value || row.id === app.authenticatedUser?.id) return
  const enabling = row.status !== 'ok'
  const label = enabling ? '启用' : '停用'
  try {
    await erpConfirm(`确认${label}账号「${row.name}（${row.login}）」？`, `${label}用户`, { type: 'warning' })
  } catch {
    return
  }
  const ok = await withAction(async () => {
    await usersApi.update(row.id, { status: enabling ? 1 : 0 })
    await reloadAll()
  }, `用户已${label}`)
  if (ok && app.authenticatedUser?.id === row.id) await app.refreshProfile()
}

async function removeUser(row: any) {
  if (!canManage.value || row.id === app.authenticatedUser?.id) return
  try {
    await erpConfirm(`删除后不可恢复，确认删除「${row.login}」？`, '删除用户', { type: 'warning' })
  } catch {
    return
  }
  const ok = await withAction(async () => {
    await usersApi.remove(row.id)
    await reloadAll()
  }, '用户已删除')
  if (ok && editVisible.value && editingId.value === row.id) editVisible.value = false
}

async function loadCatalog() {
  try {
    const data = await permissionsApi.catalog()
    if (Array.isArray(data?.groups) && data.groups.length) {
      permGroupsUI.value = data.groups
      permCollapseActive.value = data.groups.map((g: PermGroup) => g.label)
    }
    if (Array.isArray(data?.roleDefinitions) && data.roleDefinitions.length && !backendRoles.value.length) {
      backendRoles.value = data.roleDefinitions.map((r: any) => ({
        roleCode: r.roleCode,
        roleName: r.roleName,
      }))
    }
  } catch {
    // fallback catalog
  }
}

async function loadRoles() {
  try {
    backendRoles.value = await usersApi.roles()
  } catch {
    backendRoles.value = [
      { roleCode: 'admin', roleName: '系统管理员' },
      { roleCode: 'ops_manager', roleName: '采购主管' },
      { roleCode: 'purchaser', roleName: '采购' },
      { roleCode: 'warehouse', roleName: '仓库' },
      { roleCode: 'finance', roleName: '财务' },
      { roleCode: 'cs', roleName: '销售' },
      { roleCode: 'sales_manager', roleName: '销售主管' },
      { roleCode: 'dev_manager', roleName: '产品开发主管' },
      { roleCode: 'viewer', roleName: '产品开发' },
      { roleCode: 'coach', roleName: '陪跑' },
      { roleCode: 'coach1', roleName: '陪跑1' },
      { roleCode: 'coach2', roleName: '陪跑2' },
    ]
  }
}

watch([statusFilter, roleFilter, page, pageSize], () => load())
watch(statusFilter, () => { page.value = 1 })
watch(roleFilter, () => { page.value = 1 })

onMounted(async () => {
  await loadCatalog()
  await loadRoles()
  await reloadAll()
})
</script>

<template>
  <el-card>
    <template #header>
      <div class="page-header">
        <span class="page-title">用户管理</span>
        <div v-if="canManage" class="header-actions">
          <el-button type="primary" size="small" @click="openCreate">创建</el-button>
        </div>
      </div>
    </template>

    <div class="status-row">
      <el-radio-group v-model="statusFilter" size="small">
        <el-radio-button v-for="tab in filterTabs" :key="tab.value" :value="tab.value">
          {{ tab.label }}<span v-if="tab.count" class="tab-count">({{ tab.count }})</span>
        </el-radio-button>
      </el-radio-group>
    </div>

    <div class="filter-panel">
      <div class="filter-line">
        <span class="filter-label">系统角色</span>
        <el-select v-model="roleFilter" size="small" style="width:140px">
          <el-option v-for="r in roleOptions" :key="r.value" :label="r.label" :value="r.value" />
        </el-select>
        <span class="filter-label ml">用户账号</span>
        <el-input
          v-model="searchQ"
          size="small"
          clearable
          placeholder="登录名 / 姓名"
          style="width:200px"
          @keyup.enter="page = 1; load()"
        />
        <el-button type="primary" size="small" @click="page = 1; load()">查询</el-button>
        <el-button size="small" @click="resetFilters">重置</el-button>
      </div>
    </div>

    <el-table v-loading="loading" :data="rows" stripe border size="small">
      <el-table-column type="index" label="NO." width="52" :index="(i: number) => (page - 1) * pageSize + i + 1" />
      <el-table-column label="用户账号" min-width="160">
        <template #default="{ row }">
          <div class="cell-stack">
            <span class="mono primary">{{ row.login }}</span>
            <span class="sub">系统角色: {{ row.role }}</span>
            <el-tag v-if="row._raw?.hasCustomPermissions" size="small" type="warning" class="mini-tag">已自定义权限</el-tag>
          </div>
        </template>
      </el-table-column>
      <el-table-column prop="name" label="用户名" width="100" />
      <el-table-column prop="phone" label="手机" width="120">
        <template #default="{ row }">{{ row.phone || '—' }}</template>
      </el-table-column>
      <el-table-column label="状态" width="80">
        <template #default="{ row }">
          <el-tag :type="row.status === 'ok' ? 'success' : 'info'" size="small">
            {{ row.status === 'ok' ? '正常' : '停用' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="lastLogin" label="最后登录" width="130" />
      <el-table-column label="操作" width="200" fixed="right">
        <template #default="{ row }">
          <el-button v-if="canManage" link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
          <el-button
            v-if="canManage && row.id !== app.authenticatedUser?.id"
            link
            :type="row.status === 'ok' ? 'warning' : 'success'"
            size="small"
            @click="toggleStatus(row)"
          >{{ row.status === 'ok' ? '停用' : '启用' }}</el-button>
          <el-button
            v-if="canManage && row.id !== app.authenticatedUser?.id"
            link
            type="danger"
            size="small"
            @click="removeUser(row)"
          >删除</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-empty v-if="!loading && !rows.length" description="暂无用户" />
    <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="listTotal" />

    <!-- 创建 -->
    <el-dialog v-model="createVisible" title="创建用户" width="480px" destroy-on-close>
      <el-form label-width="88px" size="small">
        <el-form-item label="登录名" required>
          <el-input v-model="createForm.username" placeholder="如 zhangsan" />
        </el-form-item>
        <el-form-item label="初始密码" required>
          <el-input v-model="createForm.password" type="password" show-password />
        </el-form-item>
        <el-form-item label="姓名" required>
          <el-input v-model="createForm.realName" />
        </el-form-item>
        <el-form-item label="系统角色" required>
          <el-select v-model="createForm.roleCode" style="width:100%">
            <el-option v-for="r in backendRoles" :key="r.roleCode" :label="r.roleName" :value="r.roleCode" />
          </el-select>
        </el-form-item>
        <el-form-item label="手机"><el-input v-model="createForm.phone" /></el-form-item>
        <el-form-item label="邮箱"><el-input v-model="createForm.email" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" @click="submitCreate">创建</el-button>
      </template>
    </el-dialog>

    <!-- 编辑：账号 + 岗位权限直接绑定 -->
    <el-dialog
      v-model="editVisible"
      :title="`编辑用户 · ${editForm.realName}`"
      width="760px"
      top="4vh"
      destroy-on-close
      class="edit-dialog"
    >
      <div class="edit-hint">
        权限直接绑定到该账号。切换「系统角色」会加载岗位默认权限，之后可手动勾选各模块权限并保存。
        <el-tag v-if="permSource === 'custom'" size="small" type="warning">当前为自定义权限</el-tag>
        <el-tag v-else size="small" type="info">跟随角色模板</el-tag>
      </div>

      <el-form label-width="88px" size="small" class="edit-form">
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="登录名"><el-input v-model="editForm.login" disabled /></el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="姓名" required><el-input v-model="editForm.realName" /></el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="系统角色" required>
              <el-select v-model="editForm.roleCode" style="width:100%" @change="onRoleChange">
                <el-option v-for="r in backendRoles" :key="r.roleCode" :label="r.roleName" :value="r.roleCode" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="状态">
              <el-radio-group v-model="editForm.status">
                <el-radio :value="1">正常</el-radio>
                <el-radio :value="0">停用</el-radio>
              </el-radio-group>
            </el-form-item>
          </el-col>
          <el-col :span="12"><el-form-item label="手机"><el-input v-model="editForm.phone" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="邮箱"><el-input v-model="editForm.email" /></el-form-item></el-col>
          <el-col :span="24">
            <el-form-item label="重置密码">
              <el-input v-model="editForm.password" type="password" show-password placeholder="留空不修改" style="max-width:280px" />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>

      <div class="perm-section">
        <div class="perm-toolbar">
          <span class="perm-title">岗位权限（已选 {{ selectedPerms.length }} / {{ ALL_PERM_IDS.length }} 项）</span>
          <div class="perm-actions">
            <el-button link type="primary" size="small" @click="applyRoleTemplate">加载角色默认</el-button>
            <el-button link type="primary" size="small" @click="selectAllPerms">全选</el-button>
            <el-button link size="small" @click="clearAllPerms">清空</el-button>
          </div>
        </div>
        <el-input
          v-model="permSearch"
          placeholder="搜索权限名称或编码"
          clearable
          size="small"
          class="perm-search"
        />
        <el-collapse v-model="permCollapseActive" class="perm-collapse">
          <el-collapse-item
            v-for="group in filteredPermGroups"
            :key="group.label"
            :name="group.label"
          >
            <template #title>
              <div class="perm-group-title">
                <el-checkbox
                  :model-value="isGroupAllChecked(group.perms)"
                  :indeterminate="isGroupIndeterminate(group.perms)"
                  @click.stop
                  @change="(v: unknown) => toggleGroup(group.perms, Boolean(v))"
                />
                <span>{{ group.label }}</span>
                <span class="perm-group-count">{{ groupSelectedCount(group.perms) }}/{{ group.perms.length }}</span>
              </div>
            </template>
            <div class="perm-grid">
              <el-checkbox
                v-for="p in group.perms"
                :key="p.id"
                :model-value="selectedPerms.includes(p.id)"
                class="perm-item"
                @change="(v: unknown) => togglePerm(p.id, Boolean(v))"
              >
                <span class="perm-label">{{ p.label }}</span>
                <span class="perm-code">{{ p.id }}</span>
              </el-checkbox>
            </div>
          </el-collapse-item>
        </el-collapse>
        <el-empty v-if="!filteredPermGroups.length" description="没有匹配的权限项" :image-size="48" />
      </div>

      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="editSaving" @click="submitEdit">保存权限绑定</el-button>
      </template>
    </el-dialog>
  </el-card>
</template>

<style scoped>
.page-header { display:flex; align-items:center; justify-content:space-between; }
.page-title { font-weight:600; font-size:15px; }
.status-row { margin-bottom:12px; }
.tab-count { margin-left:2px; font-size:11px; opacity:0.85; }
.filter-panel {
  background:#f8fafc;
  border:1px solid var(--el-border-color-lighter);
  border-radius:8px;
  padding:12px 14px;
  margin-bottom:12px;
}
.filter-line { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.filter-label { font-size:12px; color:var(--el-text-color-secondary); }
.filter-label.ml { margin-left:8px; }
.cell-stack { display:flex; flex-direction:column; gap:2px; font-size:12px; }
.sub { color:var(--el-text-color-secondary); font-size:11px; }
.mono { font-family:var(--font-mono,Consolas,monospace); }
.primary { color:var(--el-color-primary); font-weight:600; }
.mini-tag { align-self:flex-start; margin-top:2px; }
.edit-hint {
  font-size:12px;
  color:var(--el-text-color-secondary);
  background:#f5f7fa;
  padding:8px 12px;
  border-radius:6px;
  margin-bottom:12px;
  display:flex;
  align-items:center;
  gap:8px;
  flex-wrap:wrap;
}
.perm-section { margin-top:8px; border-top:1px solid var(--el-border-color-lighter); padding-top:12px; }
.perm-toolbar { display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; gap:8px; flex-wrap:wrap; }
.perm-title { font-weight:600; font-size:13px; }
.perm-search { margin-bottom:10px; max-width:360px; }
.perm-collapse {
  border:none;
  max-height:420px;
  overflow-y:auto;
}
.perm-collapse :deep(.el-collapse-item__header) {
  height:auto; min-height:40px; line-height:1.4; padding:6px 0; border-bottom:1px solid var(--el-border-color-lighter);
}
.perm-collapse :deep(.el-collapse-item__wrap) { border-bottom:none; }
.perm-group-title { display:flex; align-items:center; gap:8px; width:100%; font-weight:600; font-size:13px; }
.perm-group-count { margin-left:auto; font-size:12px; color:var(--el-text-color-secondary); font-weight:500; }
.perm-grid {
  display:grid;
  grid-template-columns:repeat(2,1fr);
  gap:6px 12px;
  padding:4px 0 8px 28px;
}
@media (min-width:900px) { .perm-grid { grid-template-columns:repeat(3,1fr); } }
.perm-item { display:flex; align-items:flex-start; margin:0; height:auto; min-height:28px; }
.perm-item :deep(.el-checkbox__label) {
  display:flex; flex-direction:column; gap:1px; white-space:normal; line-height:1.35; padding-bottom:2px;
}
.perm-label { font-size:12px; color:var(--el-text-color-primary); }
.perm-code { font-size:10px; color:var(--el-text-color-secondary); font-family:var(--font-mono,Consolas,monospace); }
</style>
