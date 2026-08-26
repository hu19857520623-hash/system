<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { erpConfirm } from '@/utils/messageBox'
import type { FormInstance, FormRules } from 'element-plus'
import { customerApi, warehouseApi } from '@/api/client.js'
import { mapCustomer } from '@/api/mappers.ts'
import { useAppStore } from '@/stores/app'
import ListPagination from '@/components/ListPagination.vue'
import {
  OMS_PERMISSION_TEMPLATES,
  OMS_PORTAL_PERMISSION_GROUPS,
  type OmsCustomerType,
  type OmsPortalPermission,
} from '@erp/shared/oms-portal.permissions'

const app = useAppStore()
const router = useRouter()
const route = useRoute()

type StatusFilter = 'all' | 'active' | 'disabled'

const statusFilter = ref<StatusFilter>('all')
const portalOnly = ref(false)
const searchQ = ref('')
const balanceMin = ref<number | undefined>()
const balanceMax = ref<number | undefined>()
const showMoreFilters = ref(false)

const page = ref(1)
const pageSize = ref(20)
const listTotal = ref(0)
const loading = ref(false)
const rows = ref<ReturnType<typeof mapCustomer>[]>([])

const statusCounts = ref({ all: 0, active: 0, disabled: 0 })

const canCreate = computed(() => app.hasPerm('budget_credit.create'))
const canEdit = computed(() => app.hasPerm('budget_credit.create'))
const canResetPortalPassword = computed(() => app.authenticatedUser?.roleCode === 'admin')

const filterTabs = computed(() => [
  { value: 'all' as const, label: '全部', count: statusCounts.value.all },
  { value: 'active' as const, label: '正常', count: statusCounts.value.active },
  { value: 'disabled' as const, label: '停用', count: statusCounts.value.disabled },
])

const createVisible = ref(false)
const editVisible = ref(false)
const detailVisible = ref(false)
const detailLoading = ref(false)
const detailRow = ref<ReturnType<typeof mapCustomer> | null>(null)
const skuHoldings = ref<{ sku: string; productName: string; quantity: number; unitPrice: number | null }[]>([])
const saving = ref(false)
const editingId = ref<number | null>(null)
const warehouseOptions = ref<{ code: string; name: string }[]>([])
const passwordVisible = ref(false)
const passwordCustomer = ref<ReturnType<typeof mapCustomer> | null>(null)
const passwordForm = ref({ username: '', temporaryPassword: '', confirmPassword: '' })
const createSuccessVisible = ref(false)
const createSuccess = ref<{ customerCode: string; username: string } | null>(null)

const emptyForm = () => ({
  customerCode: '',
  customerName: '',
  companyName: '',
  contactEmail: '',
  contactName: '',
  contactPhone: '',
  status: 1,
  omsType: 'ecommerce' as OmsCustomerType,
  warehouse: 'WMS-JHB-01',
  permissionMode: 'template' as 'template' | 'explicit',
  permissionTemplate: 'ecommerce' as OmsCustomerType,
  permissions: [...OMS_PERMISSION_TEMPLATES.ecommerce] as OmsPortalPermission[],
  username: '',
  temporaryPassword: '',
  confirmPassword: '',
})

const form = ref(emptyForm())
const createFormRef = ref<FormInstance>()
const editFormRef = ref<FormInstance>()
const passwordFormRef = ref<FormInstance>()

type ValidationCallback = (error?: Error) => void

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const USERNAME_PATTERN = /^[A-Za-z0-9._-]+$/

function usernameValidator(required: boolean) {
  return (_rule: unknown, value: unknown, callback: ValidationCallback) => {
    const username = String(value ?? '').trim().toLowerCase()
    if (!username) {
      callback(required ? new Error('请填写 OMS 登录账号') : undefined)
    } else if (username.length < 6) {
      callback(new Error('登录账号至少 6 个字符'))
    } else if (username.length > 50 || !USERNAME_PATTERN.test(username)) {
      callback(new Error('登录账号须为 6-50 位字母、数字、点、下划线或短横线'))
    } else {
      callback()
    }
  }
}

function requiredTextValidator(label: string, maxLength: number) {
  return (_rule: unknown, value: unknown, callback: ValidationCallback) => {
    const text = String(value ?? '').trim()
    if (!text) callback(new Error(`请填写${label}`))
    else if (text.length > maxLength) callback(new Error(`${label}不能超过 ${maxLength} 个字符`))
    else callback()
  }
}

function emailValidator(label: string, required: boolean, maxLength: number) {
  return (_rule: unknown, value: unknown, callback: ValidationCallback) => {
    const email = String(value ?? '').trim()
    if (!email) {
      callback(required ? new Error(`请填写${label}`) : undefined)
    } else if (email.length > maxLength || !EMAIL_PATTERN.test(email)) {
      callback(new Error(`请输入有效的${label}`))
    } else {
      callback()
    }
  }
}

function temporaryPasswordError(value: unknown) {
  const password = String(value ?? '')
  if (!password) return '请填写临时密码'
  if (password.length < 6) return '临时密码至少 6 位'
  if (password.length > 128) return '临时密码不能超过 128 位'
  return ''
}

function temporaryPasswordValidator(_rule: unknown, value: unknown, callback: ValidationCallback) {
  const error = temporaryPasswordError(value)
  callback(error ? new Error(error) : undefined)
}

function createPasswordConfirmationValidator(_rule: unknown, value: unknown, callback: ValidationCallback) {
  if (!value) callback(new Error('请再次输入临时密码'))
  else if (value !== form.value.temporaryPassword) callback(new Error('两次输入的临时密码不一致'))
  else callback()
}

function resetPasswordConfirmationValidator(_rule: unknown, value: unknown, callback: ValidationCallback) {
  if (!value) callback(new Error('请再次输入临时密码'))
  else if (value !== passwordForm.value.temporaryPassword) callback(new Error('两次输入的临时密码不一致'))
  else callback()
}

const customerCodeValidator = (_rule: unknown, value: unknown, callback: ValidationCallback) => {
  const code = String(value ?? '').trim()
  if (!code) callback(new Error('请填写客户代码'))
  else if (code.length > 30) callback(new Error('客户代码不能超过 30 个字符'))
  else if (!/^[A-Za-z0-9_-]+$/.test(code)) callback(new Error('客户代码只能包含字母、数字、下划线和短横线'))
  else callback()
}

const permissionsValidator = (_rule: unknown, value: unknown, callback: ValidationCallback) => {
  if (form.value.permissionMode === 'explicit' && (!Array.isArray(value) || !value.length)) {
    callback(new Error('请至少选择一项门户权限'))
  } else {
    callback()
  }
}

const createRules: FormRules = {
  customerCode: [{ validator: customerCodeValidator, trigger: 'blur' }],
  customerName: [{ validator: requiredTextValidator('客户名称', 200), trigger: 'blur' }],
  companyName: [{ max: 200, message: '公司名称不能超过 200 个字符', trigger: 'blur' }],
  contactEmail: [{ validator: emailValidator('联系邮箱', false, 120), trigger: 'blur' }],
  contactName: [{ max: 50, message: '联系人不能超过 50 个字符', trigger: 'blur' }],
  contactPhone: [{ max: 30, message: '联系电话不能超过 30 个字符', trigger: 'blur' }],
  omsType: [{ required: true, message: '请选择 OMS 客户类型', trigger: 'change' }],
  warehouse: [{ validator: requiredTextValidator('默认仓库', 100), trigger: 'change' }],
  permissionTemplate: [{ required: true, message: '请选择权限模板', trigger: 'change' }],
  permissions: [{ validator: permissionsValidator, trigger: 'change' }],
  username: [{ validator: usernameValidator(true), trigger: 'blur' }],
  temporaryPassword: [{ validator: temporaryPasswordValidator, trigger: 'blur' }],
  confirmPassword: [{ validator: createPasswordConfirmationValidator, trigger: 'blur' }],
}

const editRules: FormRules = {
  customerName: [{ validator: requiredTextValidator('客户名称', 200), trigger: 'blur' }],
  companyName: [{ max: 200, message: '公司名称不能超过 200 个字符', trigger: 'blur' }],
  contactEmail: [{ validator: emailValidator('邮箱', false, 120), trigger: 'blur' }],
  contactName: [{ max: 50, message: '联系人不能超过 50 个字符', trigger: 'blur' }],
  contactPhone: [{ max: 30, message: '联系电话不能超过 30 个字符', trigger: 'blur' }],
}

const passwordRules: FormRules = {
  username: [{ validator: usernameValidator(true), trigger: 'blur' }],
  temporaryPassword: [{ validator: temporaryPasswordValidator, trigger: 'blur' }],
  confirmPassword: [{ validator: resetPasswordConfirmationValidator, trigger: 'blur' }],
}

const passwordActionLabel = computed(() =>
  passwordCustomer.value?.portalReady ? '重置临时密码' : '设置临时密码',
)

async function validateForm(instance: FormInstance | undefined) {
  if (!instance) return false
  try {
    await instance.validate()
    return true
  } catch {
    return false
  }
}

function clearCreateSecrets() {
  form.value.temporaryPassword = ''
  form.value.confirmPassword = ''
}

function clearPasswordSecrets() {
  passwordForm.value.temporaryPassword = ''
  passwordForm.value.confirmPassword = ''
}

function handleCreateClosed() {
  clearCreateSecrets()
  createFormRef.value?.clearValidate()
}

function handlePasswordClosed() {
  passwordForm.value = { username: '', temporaryPassword: '', confirmPassword: '' }
  passwordCustomer.value = null
  passwordFormRef.value?.clearValidate()
}

function buildParams(extra: Record<string, unknown> = {}) {
  const params: Record<string, unknown> = {
    page: page.value,
    pageSize: pageSize.value,
    ...extra,
  }
  if (portalOnly.value) params.portalOnly = '1'
  if (statusFilter.value !== 'all') params.status = statusFilter.value
  const q = searchQ.value.trim()
  if (q) params.keyword = q
  if (balanceMin.value != null) params.balanceMin = balanceMin.value
  if (balanceMax.value != null) params.balanceMax = balanceMax.value
  return params
}

async function refreshCounts() {
  try {
    const [all, active, disabled] = await Promise.all([
      customerApi.list({ pageSize: 1, ...(portalOnly.value ? { portalOnly: '1' } : {}) }),
      customerApi.list({ pageSize: 1, status: 'active', ...(portalOnly.value ? { portalOnly: '1' } : {}) }),
      customerApi.list({ pageSize: 1, status: 'disabled', ...(portalOnly.value ? { portalOnly: '1' } : {}) }),
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
    const res = await customerApi.list(buildParams())
    rows.value = (res.items || []).map(mapCustomer)
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
  portalOnly.value = false
  balanceMin.value = undefined
  balanceMax.value = undefined
  page.value = 1
  load()
}

function openCreate() {
  form.value = emptyForm()
  editingId.value = null
  createVisible.value = true
}

function openEdit(row: any) {
  editingId.value = row.id
  form.value = {
    customerCode: row.code,
    customerName: row.company,
    companyName: row.companyName || '',
    contactEmail: row.email || '',
    contactName: row.contact,
    contactPhone: row.phone,
    status: row.statusCode,
    omsType: (row.omsType || 'ecommerce') as OmsCustomerType,
    warehouse: row.omsWarehouse || 'WMS-JHB-01',
    permissionMode: 'template',
    permissionTemplate: (row.omsType || 'ecommerce') as OmsCustomerType,
    permissions: [...(row.omsPermissions || [])] as OmsPortalPermission[],
    username: row.portalUsername || row.portalLoginEmail || '',
    temporaryPassword: '',
    confirmPassword: '',
  }
  editVisible.value = true
}

function handleOmsTypeChange(type: OmsCustomerType) {
  form.value.permissionTemplate = type
  if (form.value.permissionMode === 'explicit') {
    form.value.permissions = [...OMS_PERMISSION_TEMPLATES[type]]
  }
}

function handlePermissionModeChange(mode: string | number | boolean | undefined) {
  if (mode !== 'template' && mode !== 'explicit') return
  if (mode === 'template') {
    form.value.permissionTemplate = form.value.omsType
  } else {
    form.value.permissions = [...OMS_PERMISSION_TEMPLATES[form.value.omsType]]
  }
}

function suggestPortalUsername() {
  if (form.value.username) return
  const code = form.value.customerCode.trim().toLowerCase()
  if (USERNAME_PATTERN.test(code) && code.length >= 6 && code.length <= 50) {
    form.value.username = code
  }
}

function openPortalPassword(row: any) {
  passwordCustomer.value = row
  passwordForm.value = {
    username: row.portalUsername || row.portalLoginEmail || '',
    temporaryPassword: '',
    confirmPassword: '',
  }
  passwordVisible.value = true
}

async function submitPortalPassword() {
  const row = passwordCustomer.value
  const f = passwordForm.value
  if (!row || !(await validateForm(passwordFormRef.value))) return
  const actionLabel = row.portalReady ? '重置临时密码' : '设置临时密码'
  try {
    await erpConfirm(
      `${actionLabel}后现有密码立即失效，客户下次登录必须修改密码。确认继续？`,
      `确认${actionLabel}`,
      { type: 'warning', confirmButtonText: '确认', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  const payload = {
    username: f.username.trim().toLowerCase(),
    temporaryPassword: f.temporaryPassword,
  }
  clearPasswordSecrets()
  saving.value = true
  try {
    const result = await customerApi.resetPortalTemporaryPassword(row.id, payload)
    passwordVisible.value = false
    ElMessage.success(`${actionLabel}成功：${result.customerCode} · ${result.portalUsername || result.portalLoginEmail}`)
    await reloadAll()
  } catch (e: any) {
    ElMessage.error(`${e?.message || `${actionLabel}失败`}；临时密码未保留，请重新输入`)
  } finally {
    saving.value = false
  }
}

async function openDetail(row: any) {
  detailRow.value = row
  detailVisible.value = true
  detailLoading.value = true
  skuHoldings.value = []
  try {
    if (!row.readOnly && row.id > 0) {
      skuHoldings.value = await customerApi.skuInventory(row.id)
    }
  } catch {
    // ignore — 详情仍可展示基本信息
  } finally {
    detailLoading.value = false
  }
}

function goRecharge(row: any) {
  router.push({ path: '/customer-recharge', query: { customerId: String(row.id) } })
}

async function submitCreate() {
  const f = form.value
  if (!(await validateForm(createFormRef.value))) return
  const username = f.username.trim().toLowerCase()
  const payload = {
    customerCode: f.customerCode.trim(),
    customerName: f.customerName.trim(),
    companyName: f.companyName.trim() || undefined,
    contactEmail: f.contactEmail.trim().toLowerCase() || undefined,
    contactName: f.contactName.trim() || undefined,
    contactPhone: f.contactPhone.trim() || undefined,
    portalType: f.omsType,
    omsType: f.omsType,
    warehouse: f.warehouse.trim(),
    ...(f.permissionMode === 'template'
      ? { permissionTemplate: f.permissionTemplate }
      : { permissions: f.permissions }),
    username,
    temporaryPassword: f.temporaryPassword,
  }
  clearCreateSecrets()
  saving.value = true
  try {
    const result = await customerApi.create(payload)
    createSuccess.value = {
      customerCode: result.customerCode || payload.customerCode,
      username: result.oms?.portalUsername || result.oms?.portalLoginEmail || username,
    }
    form.value = emptyForm()
    createVisible.value = false
    createSuccessVisible.value = true
    await reloadAll()
  } catch (e: any) {
    ElMessage.error(`${e?.message || '开户失败'}；临时密码未保留，请重新输入`)
  } finally {
    saving.value = false
  }
}

async function loadWarehouses() {
  try {
    const res = await warehouseApi.list({ pageSize: 200 })
    const items = Array.isArray(res) ? res : (res.items || [])
    warehouseOptions.value = items
      .filter((item: any) => item.status === 1 || item.status == null)
      .map((item: any) => ({
        code: item.warehouseCode || item.code,
        name: item.warehouseName || item.name || item.warehouseCode || item.code,
      }))
      .filter((item: { code: string }) => Boolean(item.code))
  } catch {
    warehouseOptions.value = []
  }
}

async function submitEdit() {
  if (!editingId.value || !(await validateForm(editFormRef.value))) return
  saving.value = true
  try {
    await customerApi.update(editingId.value, {
      customerName: form.value.customerName.trim(),
      companyName: form.value.companyName.trim() || undefined,
      contactEmail: form.value.contactEmail.trim().toLowerCase() || undefined,
      contactName: form.value.contactName.trim() || undefined,
      contactPhone: form.value.contactPhone.trim() || undefined,
      status: form.value.status as 0 | 1,
    })
    ElMessage.success('已保存')
    editVisible.value = false
    await reloadAll()
  } catch (e: any) {
    ElMessage.error(e?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

watch([statusFilter, portalOnly, page, pageSize], () => load())
watch([statusFilter, portalOnly], () => { page.value = 1 })

onMounted(() => {
  const q = String(route.query.q || '').trim()
  if (q) searchQ.value = q
  void reloadAll()
  void loadWarehouses()
})
</script>

<template>
  <section class="customer-page">
    <header class="customer-hero">
      <div>
        <p class="page-eyebrow">CUSTOMER ACCESS</p>
        <h1>客户列表</h1>
        <p class="page-description">管理 ERP 客户主数据与 OMS 登录、权限、仓库和账户状态。</p>
      </div>
      <el-button v-if="canCreate" type="primary" class="open-account-button" @click="openCreate">
        开通 OMS 账户
      </el-button>
    </header>

    <el-card class="customer-workspace" shadow="never">
      <div class="workspace-toolbar">
        <el-radio-group v-model="statusFilter" size="small" class="status-tabs">
          <el-radio-button v-for="tab in filterTabs" :key="tab.value" :value="tab.value">
            {{ tab.label }}<span class="tab-count">{{ tab.count }}</span>
          </el-radio-button>
        </el-radio-group>

        <div class="search-row">
          <el-input
            v-model="searchQ"
            size="small"
            clearable
            placeholder="搜索客户代码、名称、公司、邮箱或联系人"
            class="customer-search"
            @keyup.enter="page = 1; load()"
            @clear="page = 1; load()"
          />
          <el-button type="primary" size="small" @click="page = 1; load()">查询</el-button>
          <el-checkbox v-model="portalOnly" size="small" @change="page = 1; reloadAll()">仅 OMS 账户</el-checkbox>
          <el-button size="small" @click="resetFilters">重置</el-button>
          <el-button link type="primary" size="small" @click="showMoreFilters = !showMoreFilters">
            {{ showMoreFilters ? '收起余额筛选' : '按余额筛选' }}
          </el-button>
        </div>
      </div>

      <div v-show="showMoreFilters" class="balance-filter">
        <span>可用余额</span>
        <el-input-number v-model="balanceMin" size="small" :min="0" controls-position="right" placeholder="最低余额" />
        <span class="range-sep">至</span>
        <el-input-number v-model="balanceMax" size="small" :min="0" controls-position="right" placeholder="最高余额" />
        <el-button size="small" type="primary" plain @click="page = 1; load()">应用</el-button>
      </div>

      <div class="erp-table-scroll customer-table-scroll">
      <el-table v-loading="loading" :data="rows" size="small" class="customer-table" row-key="code">
        <el-table-column label="客户" min-width="220" fixed="left">
          <template #default="{ row }">
            <button type="button" class="identity-cell" @click="openDetail(row)">
              <span class="customer-name">{{ row.company }}</span>
              <span class="customer-code mono">{{ row.code }}</span>
            </button>
          </template>
        </el-table-column>
        <el-table-column label="公司与联系人" min-width="220">
          <template #default="{ row }">
            <div class="cell-stack">
              <span>{{ row.companyName }}</span>
              <span class="sub">{{ row.contact }}</span>
              <span class="sub">{{ row.phone }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="OMS 登录" min-width="230">
          <template #default="{ row }">
            <div class="portal-cell">
              <span
                class="status-dot"
                :class="{
                  'is-ready': row.portalReady && row.portalStatus === 'active',
                  'is-pending': !row.portalReady,
                  'is-disabled': row.portalStatus === 'disabled',
                }"
              />
              <div class="cell-stack">
                <span class="portal-state">{{ row.portalLoginStatusLabel }}</span>
                <span class="sub">{{ row.portalLoginEmail }}</span>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="账户配置" min-width="150">
          <template #default="{ row }">
            <div class="cell-stack">
              <span>{{ row.omsTypeLabel }}</span>
              <span class="sub mono">{{ row.omsWarehouse }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="资金" min-width="160" align="right">
          <template #default="{ row }">
            <div class="cell-stack money-cell">
              <strong :class="{ warn: row.balance < 5000 }">
                ¥ {{ row.balance.toLocaleString(undefined, { minimumFractionDigits: 2 }) }}
              </strong>
              <span class="sub">累计充值 ¥ {{ row.totalRecharge.toLocaleString(undefined, { minimumFractionDigits: 2 }) }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="最近活动" min-width="150">
          <template #default="{ row }">
            <div class="cell-stack">
              <span>{{ row.omsLastLogin }}</span>
              <span class="sub">{{ row.updatedAt }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="84" align="center">
          <template #default="{ row }">
            <span class="account-status" :class="{ 'is-active': row.statusCode === 1 }">{{ row.status }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="248" fixed="right" align="right" class-name="ops-col">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openDetail(row)">详情</el-button>
            <el-button v-if="canEdit && !row.readOnly" link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
            <el-button
              v-if="canResetPortalPassword && !row.readOnly && row.omsType"
              link
              type="primary"
              size="small"
              @click="openPortalPassword(row)"
            >
              {{ row.portalReady ? '重置密码' : '设置密码' }}
            </el-button>
            <el-button v-if="app.hasPerm('budget_credit.create') && !row.readOnly" link type="primary" size="small" @click="goRecharge(row)">充值</el-button>
          </template>
        </el-table-column>
      </el-table>
      </div>
      <el-empty v-if="!loading && !rows.length" :description="portalOnly ? '暂无 OMS 客户账户' : '暂无客户'" />
      <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="listTotal" />
    </el-card>

    <el-dialog
      v-model="createVisible"
      title="开通 OMS 客户账户"
      width="760px"
      destroy-on-close
      :close-on-click-modal="false"
      @closed="handleCreateClosed"
    >
      <el-form
        ref="createFormRef"
        :model="form"
        :rules="createRules"
        label-width="112px"
        size="small"
        scroll-to-error
      >
        <div class="onboarding-section">
          <div class="section-heading">
            <span>客户资料</span>
            <small>用于 OMS 展示、联系和业务识别</small>
          </div>
          <div class="form-grid">
            <el-form-item label="客户代码" prop="customerCode" required>
              <el-input v-model="form.customerCode" placeholder="如 CUS-001" />
            </el-form-item>
            <el-form-item label="客户名称" prop="customerName" required>
              <el-input v-model="form.customerName" placeholder="显示名称或简称" />
            </el-form-item>
            <el-form-item label="公司" prop="companyName">
              <el-input v-model="form.companyName" placeholder="公司全称" />
            </el-form-item>
            <el-form-item label="联系邮箱" prop="contactEmail">
              <el-input
                v-model="form.contactEmail"
                type="email"
                placeholder="contact@example.com"
                @blur="suggestPortalUsername"
              />
            </el-form-item>
            <el-form-item label="联系人" prop="contactName">
              <el-input v-model="form.contactName" />
            </el-form-item>
            <el-form-item label="联系电话" prop="contactPhone">
              <el-input v-model="form.contactPhone" />
            </el-form-item>
          </div>
        </div>

        <div class="onboarding-section portal-section">
          <div class="section-heading">
            <span>OMS 门户开通</span>
            <small>创建可登录门户账号与独立账单账户</small>
          </div>
          <div class="form-grid">
            <el-form-item label="客户类型" prop="omsType" required>
              <el-select v-model="form.omsType" style="width:100%" @change="handleOmsTypeChange">
                <el-option label="电商客户" value="ecommerce" />
                <el-option label="货盘客户" value="catalog" />
                <el-option label="混合客户" value="hybrid" />
              </el-select>
            </el-form-item>
            <el-form-item label="默认仓库" prop="warehouse" required>
              <el-select
                v-model="form.warehouse"
                filterable
                allow-create
                default-first-option
                style="width:100%"
                placeholder="选择或输入仓库代码"
              >
                <el-option
                  v-for="warehouse in warehouseOptions"
                  :key="warehouse.code"
                  :label="`${warehouse.name} · ${warehouse.code}`"
                  :value="warehouse.code"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="登录账号" prop="username" required>
              <el-input v-model="form.username" autocomplete="off" placeholder="至少 6 位，字母数字或 . _ -" />
            </el-form-item>
            <el-form-item label="权限方式" required>
              <el-radio-group v-model="form.permissionMode" @change="handlePermissionModeChange">
                <el-radio value="template">推荐模板</el-radio>
                <el-radio value="explicit">自定义</el-radio>
              </el-radio-group>
            </el-form-item>
            <el-form-item
              v-if="form.permissionMode === 'template'"
              label="权限模板"
              prop="permissionTemplate"
              required
            >
              <el-select v-model="form.permissionTemplate" style="width:100%">
                <el-option label="电商推荐权限" value="ecommerce" />
                <el-option label="货盘推荐权限" value="catalog" />
                <el-option label="混合推荐权限" value="hybrid" />
              </el-select>
            </el-form-item>
          </div>
          <el-form-item
            v-if="form.permissionMode === 'explicit'"
            label="门户权限"
            prop="permissions"
            required
          >
            <div class="permission-groups">
              <div v-for="group in OMS_PORTAL_PERMISSION_GROUPS" :key="group.label" class="permission-group">
                <span>{{ group.label }}</span>
                <el-checkbox-group v-model="form.permissions">
                  <el-checkbox v-for="permission in group.permissions" :key="permission" :value="permission">
                    {{ permission }}
                  </el-checkbox>
                </el-checkbox-group>
              </div>
            </div>
          </el-form-item>
          <div class="form-grid">
            <el-form-item label="临时密码" prop="temporaryPassword" required>
              <el-input
                v-model="form.temporaryPassword"
                type="password"
                show-password
                autocomplete="new-password"
                placeholder="至少 6 位"
              />
            </el-form-item>
            <el-form-item label="确认密码" prop="confirmPassword" required>
              <el-input
                v-model="form.confirmPassword"
                type="password"
                show-password
                autocomplete="new-password"
                placeholder="再次输入临时密码"
              />
            </el-form-item>
          </div>
          <p class="password-note">临时密码仅用于本次开户，不会在成功后再次显示；客户首次登录必须修改。</p>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitCreate">开通 OMS 账户</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="createSuccessVisible" width="520px" destroy-on-close>
      <el-result icon="success" title="OMS 开户成功" sub-title="客户现在可以使用登录账号和临时密码进入 OMS">
        <template #extra>
          <div v-if="createSuccess" class="success-account">
            <div class="success-account-row">
              <span>客户代码</span>
              <strong class="mono">{{ createSuccess.customerCode }}</strong>
            </div>
            <div class="success-account-row">
              <span>OMS 登录账号</span>
              <strong>{{ createSuccess.username }}</strong>
            </div>
            <el-alert
              title="临时密码不会再次显示；客户首次登录后必须修改密码。"
              type="info"
              :closable="false"
              show-icon
            />
          </div>
          <el-button type="primary" @click="createSuccessVisible = false">完成</el-button>
        </template>
      </el-result>
    </el-dialog>

    <el-dialog
      v-model="detailVisible"
      width="760px"
      destroy-on-close
      class="customer-detail-dialog erp-detail"
      :show-close="true"
    >
      <template #header>
        <div v-if="detailRow" class="detail-header">
          <div>
            <p class="detail-kicker mono">{{ detailRow.code }}</p>
            <h2>{{ detailRow.company }}</h2>
          </div>
          <span class="account-status" :class="{ 'is-active': detailRow.statusCode === 1 }">
            {{ detailRow.status }}
          </span>
        </div>
      </template>
      <template v-if="detailRow">
        <div class="detail-overview">
          <section class="detail-panel detail-panel--portal">
            <div class="detail-panel-heading">
              <span>OMS 登录</span>
              <span
                class="status-dot"
                :class="{
                  'is-ready': detailRow.portalReady && detailRow.portalStatus === 'active',
                  'is-pending': !detailRow.portalReady,
                  'is-disabled': detailRow.portalStatus === 'disabled',
                }"
              />
            </div>
            <strong class="detail-primary-value">{{ detailRow.portalLoginStatusLabel }}</strong>
            <span class="detail-secondary-value">{{ detailRow.portalLoginEmail }}</span>
            <div class="detail-field-grid">
              <div>
                <label>客户类型</label>
                <span>{{ detailRow.omsTypeLabel }}</span>
              </div>
              <div>
                <label>默认仓库</label>
                <span class="mono">{{ detailRow.omsWarehouse }}</span>
              </div>
              <div>
                <label>最近登录</label>
                <span>{{ detailRow.omsLastLogin }}</span>
              </div>
              <div>
                <label>账户状态</label>
                <span>{{ detailRow.omsStatus === 'active' ? '正常' : detailRow.omsStatus === 'disabled' ? '停用' : '' }}</span>
              </div>
            </div>
          </section>

          <section class="detail-panel">
            <div class="detail-panel-heading"><span>客户资料</span></div>
            <div class="detail-field-grid">
              <div>
                <label>公司</label>
                <span>{{ detailRow.companyName }}</span>
              </div>
              <div>
                <label>联系邮箱</label>
                <span>{{ detailRow.email }}</span>
              </div>
              <div>
                <label>联系人</label>
                <span>{{ detailRow.contact }}</span>
              </div>
              <div>
                <label>联系电话</label>
                <span>{{ detailRow.phone }}</span>
              </div>
            </div>
          </section>
        </div>

        <section class="finance-strip">
          <div>
            <label>可用余额</label>
            <strong>¥ {{ detailRow.balance.toLocaleString(undefined, { minimumFractionDigits: 2 }) }}</strong>
          </div>
          <div>
            <label>累计充值</label>
            <strong>¥ {{ detailRow.totalRecharge.toLocaleString(undefined, { minimumFractionDigits: 2 }) }}</strong>
          </div>
          <div>
            <label>本月消费</label>
            <strong>{{ detailRow.omsMonthlySpent != null ? '¥ ' + detailRow.omsMonthlySpent.toLocaleString() : '' }}</strong>
          </div>
          <div>
            <label>待出账单</label>
            <strong>{{ detailRow.omsPendingBill != null ? '¥ ' + detailRow.omsPendingBill.toLocaleString() : '' }}</strong>
          </div>
        </section>

        <section v-if="detailRow.omsPermissions?.length" class="permission-summary">
          <span class="detail-section-title">已开通权限</span>
          <div class="permission-chips">
            <span v-for="permission in detailRow.omsPermissions" :key="permission">{{ permission }}</span>
          </div>
        </section>

        <div v-if="!detailRow.readOnly" class="inventory-heading">
          <span class="detail-section-title">持有 SKU</span>
          <span>{{ skuHoldings.length }} 种商品</span>
        </div>
        <el-table
          v-if="!detailRow.readOnly"
          v-loading="detailLoading"
          :data="skuHoldings"
          size="small"
          border
          empty-text="暂无持有 SKU"
        >
          <el-table-column prop="sku" label="SKU" width="110">
            <template #default="{ row }"><span class="mono">{{ row.sku }}</span></template>
          </el-table-column>
          <el-table-column prop="productName" label="商品名" min-width="140" show-overflow-tooltip />
          <el-table-column label="持有数量" width="90" align="right">
            <template #default="{ row }">{{ row.quantity.toLocaleString() }}</template>
          </el-table-column>
          <el-table-column label="单价(¥)" width="90" align="right">
            <template #default="{ row }">{{ row.unitPrice != null ? row.unitPrice : '' }}</template>
          </el-table-column>
        </el-table>
      </template>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="editVisible" title="编辑客户" width="480px" destroy-on-close>
      <el-form ref="editFormRef" :model="form" :rules="editRules" label-width="90px" size="small">
        <el-form-item label="客户代码">
          <el-input v-model="form.customerCode" disabled />
        </el-form-item>
        <el-form-item label="客户名称" prop="customerName" required>
          <el-input v-model="form.customerName" />
        </el-form-item>
        <el-form-item label="公司" prop="companyName">
          <el-input v-model="form.companyName" placeholder="公司全称" />
        </el-form-item>
        <el-form-item label="邮箱" prop="contactEmail">
          <el-input v-model="form.contactEmail" type="email" placeholder="contact@example.com" />
        </el-form-item>
        <el-form-item label="联系人" prop="contactName">
          <el-input v-model="form.contactName" />
        </el-form-item>
        <el-form-item label="联系电话" prop="contactPhone">
          <el-input v-model="form.contactPhone" />
        </el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="form.status">
            <el-radio :value="1">正常</el-radio>
            <el-radio :value="0">停用</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitEdit">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="passwordVisible"
      :title="`${passwordActionLabel} · ${passwordCustomer?.code || ''}`"
      width="480px"
      destroy-on-close
      :close-on-click-modal="false"
      @closed="handlePasswordClosed"
    >
      <el-alert
        :title="passwordCustomer?.portalReady
          ? '保存后现有密码立即失效，客户下次登录必须修改密码。'
          : '设置后门户账号可登录，客户首次登录必须修改密码。'"
        type="warning"
        :closable="false"
        show-icon
        style="margin-bottom:16px"
      />
      <el-form
        ref="passwordFormRef"
        :model="passwordForm"
        :rules="passwordRules"
        label-width="100px"
        size="small"
      >
        <el-form-item label="登录账号" prop="username" required>
          <el-input v-model="passwordForm.username" autocomplete="off" placeholder="至少 6 位" />
        </el-form-item>
        <el-form-item label="临时密码" prop="temporaryPassword" required>
          <el-input
            v-model="passwordForm.temporaryPassword"
            type="password"
            show-password
            autocomplete="new-password"
            placeholder="至少 6 位"
          />
        </el-form-item>
        <el-form-item label="确认密码" prop="confirmPassword" required>
          <el-input
            v-model="passwordForm.confirmPassword"
            type="password"
            show-password
            autocomplete="new-password"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="passwordVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitPortalPassword">{{ passwordActionLabel }}</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.customer-page,
:global(.customer-detail-dialog) {
  --customer-ink: var(--text);
  --customer-muted: var(--text-muted);
  --customer-line: var(--border);
  --customer-canvas: var(--panel-soft);
  --customer-primary: var(--primary);
  --customer-teal: var(--cyan);
}
.customer-page {
  display:flex;
  flex-direction:column;
  gap:18px;
}
.customer-hero {
  display:flex;
  align-items:flex-end;
  justify-content:space-between;
  gap:24px;
  min-height:112px;
  padding:18px 24px 20px;
  overflow:hidden;
  position:relative;
  border:1px solid #e2e8f4;
  border-radius:16px;
  background:
    linear-gradient(120deg,rgba(49,87,213,.08),transparent 48%),
    #fff;
}
.customer-hero::after {
  content:"OMS";
  position:absolute;
  right:118px;
  bottom:-28px;
  color:rgba(49,87,213,.055);
  font:800 86px/1 var(--font-mono,Consolas,monospace);
  letter-spacing:-8px;
  pointer-events:none;
}
.page-eyebrow {
  margin:0 0 8px;
  color:var(--customer-primary);
  font:700 10px/1 var(--font-mono,Consolas,monospace);
  letter-spacing:.16em;
}
.customer-hero h1 {
  margin:0;
  color:var(--customer-ink);
  font-size:26px;
  font-weight:700;
  letter-spacing:-.02em;
}
.page-description {
  margin:7px 0 0;
  color:var(--customer-muted);
  font-size:13px;
}
.open-account-button { position:relative; z-index:1; min-width:136px; }
.customer-workspace {
  border:1px solid var(--customer-line);
  border-radius:16px;
}
.customer-workspace :deep(.el-card__body) { padding:0; }
.workspace-toolbar {
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:16px;
  padding:16px 18px;
  border-bottom:1px solid var(--customer-line);
}
.status-tabs :deep(.el-radio-button__inner) { padding:7px 14px; }
.tab-count {
  display:inline-flex;
  min-width:18px;
  height:18px;
  align-items:center;
  justify-content:center;
  margin-left:7px;
  padding:0 5px;
  border-radius:9px;
  background:rgba(49,87,213,.08);
  font:600 10px/18px var(--font-mono,Consolas,monospace);
}
.search-row { display:flex; align-items:center; gap:8px; }
.customer-search { width:330px; }
.balance-filter {
  display:flex;
  align-items:center;
  gap:10px;
  padding:11px 18px;
  background:var(--customer-canvas);
  border-bottom:1px solid var(--customer-line);
  color:var(--customer-muted);
  font-size:12px;
}
.range-sep { color:var(--customer-muted); }
.mono { font-family:var(--font-mono,Consolas,monospace); font-size:12px; }
.customer-table { width:100%; }
.customer-table-scroll { --erp-table-min-width: 1180px; margin-bottom: 0; }
.customer-table::before { display:none; }
.customer-table :deep(th.el-table__cell) {
  height:42px;
  background:#fbfcfe;
  color:#61708a;
  font-size:11px;
  font-weight:650;
  letter-spacing:.02em;
}
.customer-table :deep(td.el-table__cell) {
  height:62px;
  vertical-align:middle;
  border-bottom-color:#edf0f5;
}
.customer-table :deep(.el-table__row:hover > td.el-table__cell) { background:#f7f9ff; }
.customer-table :deep(.el-table__row:hover > td.el-table-fixed-column--right),
.customer-table :deep(.el-table__row:hover > td.el-table-fixed-column--left) { background:#f7f9ff !important; }
.customer-table :deep(td.ops-col.el-table-fixed-column--right .cell) {
  justify-content: flex-end;
  min-width: 228px;
}
.identity-cell {
  display:flex;
  flex-direction:column;
  align-items:flex-start;
  gap:5px;
  width:100%;
  padding:0;
  border:0;
  background:transparent;
  color:inherit;
  cursor:pointer;
  text-align:left;
}
.identity-cell:focus-visible { outline:2px solid var(--customer-primary); outline-offset:3px; border-radius:3px; }
.customer-name { color:var(--customer-ink); font-size:13px; font-weight:650; }
.customer-code { color:var(--customer-primary); }
.cell-stack { display:flex; flex-direction:column; gap:4px; min-height:16px; font-size:12px; }
.cell-stack > span:empty { min-height:1em; }
.sub { color:var(--customer-muted); font-size:11px; overflow-wrap:anywhere; }
.portal-cell { display:flex; align-items:flex-start; gap:9px; }
.status-dot {
  flex:0 0 auto;
  width:8px;
  height:8px;
  margin-top:5px;
  border-radius:50%;
  background:#a0aec0;
  box-shadow:0 0 0 4px rgba(160,174,192,.12);
}
.status-dot.is-ready { background:var(--customer-teal); box-shadow:0 0 0 4px rgba(17,134,123,.12); }
.status-dot.is-pending { background:#d69027; box-shadow:0 0 0 4px rgba(214,144,39,.12); }
.status-dot.is-disabled { background:#c75555; box-shadow:0 0 0 4px rgba(199,85,85,.12); }
.portal-state { color:var(--customer-ink); font-weight:600; }
.money-cell { align-items:flex-end; }
.money-cell strong { color:var(--customer-ink); font-size:12px; }
.warn { color:#b7791f!important; }
.account-status {
  display:inline-flex;
  align-items:center;
  justify-content:center;
  min-width:48px;
  height:24px;
  padding:0 9px;
  border-radius:12px;
  background:#f1f3f7;
  color:#718096;
  font-size:11px;
  font-weight:600;
}
.account-status.is-active { background:rgba(17,134,123,.1); color:#0d766c; }
.onboarding-section {
  border:1px solid var(--el-border-color-lighter);
  border-radius:10px;
  padding:14px 14px 4px;
  margin-bottom:14px;
}
.portal-section {
  background:color-mix(in srgb, var(--el-color-primary) 4%, transparent);
  border-color:color-mix(in srgb, var(--el-color-primary) 24%, var(--el-border-color-lighter));
}
.section-heading {
  display:flex;
  align-items:baseline;
  gap:10px;
  margin:0 0 14px 4px;
  font-weight:600;
  color:var(--el-text-color-primary);
}
.section-heading small {
  color:var(--el-text-color-secondary);
  font-size:11px;
  font-weight:400;
}
.form-grid {
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  column-gap:14px;
}
.permission-groups {
  width:100%;
  max-height:220px;
  overflow:auto;
  border:1px solid var(--el-border-color-lighter);
  border-radius:8px;
  background:var(--el-bg-color);
  padding:8px 10px;
}
.permission-group {
  display:grid;
  grid-template-columns:74px 1fr;
  gap:8px;
  padding:7px 0;
  border-bottom:1px dashed var(--el-border-color-lighter);
  font-size:12px;
}
.permission-group:last-child { border-bottom:0; }
.permission-group > span { color:var(--el-text-color-secondary); }
.permission-group :deep(.el-checkbox) { margin-right:12px; height:24px; }
.password-note {
  margin:-2px 0 12px 112px;
  color:var(--el-text-color-secondary);
  font-size:11px;
}
.success-account {
  width:360px;
  margin:0 auto 18px;
  padding:14px;
  border:1px solid var(--el-border-color-lighter);
  border-radius:8px;
  background:var(--el-fill-color-lighter);
  text-align:left;
}
.success-account-row {
  display:grid;
  grid-template-columns:100px minmax(0,1fr);
  gap:12px;
  align-items:center;
  margin-bottom:10px;
  font-size:13px;
}
.success-account-row span { color:var(--el-text-color-secondary); }
.success-account-row strong { overflow-wrap:anywhere; }
.success-account :deep(.el-alert) { margin-top:14px; }
.detail-header {
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:16px;
  padding-right:28px;
}
.detail-kicker { margin:0 0 5px; color:var(--customer-primary); }
.detail-header h2 { margin:0; color:var(--customer-ink); font-size:20px; }
.detail-overview {
  display:grid;
  grid-template-columns:1.15fr 1fr;
  gap:12px;
}
.detail-panel {
  min-height:190px;
  padding:16px;
  border:1px solid var(--customer-line);
  border-radius:12px;
  background:var(--panel-solid);
}
.detail-panel--portal {
  background:linear-gradient(145deg,rgba(79,70,229,.08),var(--panel-solid) 55%);
  border-color:rgba(79,70,229,.18);
}
.detail-panel-heading {
  display:flex;
  align-items:center;
  justify-content:space-between;
  margin-bottom:12px;
  color:var(--customer-muted);
  font-size:11px;
  font-weight:700;
  letter-spacing:.06em;
  text-transform:uppercase;
}
.detail-primary-value { display:block; color:var(--customer-ink); font-size:15px; }
.detail-secondary-value { display:block; min-height:18px; margin:5px 0 16px; color:var(--customer-muted); font-size:11px; overflow-wrap:anywhere; }
.detail-field-grid {
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:15px 18px;
}
.detail-field-grid div { min-width:0; }
.detail-field-grid label,
.finance-strip label {
  display:block;
  margin-bottom:5px;
  color:var(--customer-muted);
  font-size:10px;
}
.detail-field-grid span { display:block; min-height:17px; color:var(--customer-ink); font-size:12px; overflow-wrap:anywhere; }
.finance-strip {
  display:grid;
  grid-template-columns:repeat(4,minmax(0,1fr));
  gap:1px;
  margin:12px 0;
  overflow:hidden;
  border:1px solid var(--customer-line);
  border-radius:12px;
  background:var(--customer-line);
}
.finance-strip > div { min-height:74px; padding:14px; background:var(--panel-solid); }
.finance-strip strong { display:block; min-height:18px; color:var(--customer-ink); font-size:13px; }
.detail-section-title { color:var(--customer-ink); font-size:12px; font-weight:700; }
.permission-summary { margin:17px 0; }
.permission-chips { display:flex; flex-wrap:wrap; gap:6px; margin-top:9px; }
.permission-chips span {
  padding:4px 8px;
  border:1px solid var(--border);
  border-radius:6px;
  background:var(--panel-soft);
  color: var(--text-secondary);
  font:500 10px/1.2 var(--font-mono,Consolas,monospace);
}
.inventory-heading {
  display:flex;
  align-items:center;
  justify-content:space-between;
  margin:18px 0 9px;
  color:var(--customer-muted);
  font-size:11px;
}
@media (max-width:760px) {
  .customer-hero { align-items:flex-start; flex-direction:column; }
  .customer-hero::after { display:none; }
  .workspace-toolbar { align-items:stretch; flex-direction:column; }
  .search-row { flex-wrap:wrap; }
  .customer-search { width:100%; }
  .balance-filter { align-items:flex-start; flex-wrap:wrap; }
  .form-grid { grid-template-columns:1fr; }
  .detail-overview,
  .finance-strip { grid-template-columns:1fr; }
  .password-note { margin-left:0; }
  .success-account { width:100%; }
}
</style>
