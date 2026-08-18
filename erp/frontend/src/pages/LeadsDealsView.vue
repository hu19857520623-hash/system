<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { leadApi, usersApi, warehouseApi } from '@/api/client.js'
import { mapLead, fmtTime } from '@/api/mappers.ts'
import { useListLoader, withAction } from '@/composables/useListLoader.ts'
import { useServerPagination } from '@/composables/useTablePagination.ts'
import { useRowActions } from '@/composables/useRowActions'
import ListPagination from '@/components/ListPagination.vue'
import { type OmsCustomerType } from '@erp/shared/oms-portal.permissions'

const { exportTask } = useRowActions()
const router = useRouter()

interface SalesUser {
  id: number
  name: string
  username: string
}

interface DealAttachment {
  id: number
  fileName: string
  fileSize?: number
  createdAt?: string
}

interface DealRecord {
  id: number
  dealNo: string
  dealAmount?: number | string | null
  dealDate?: string
  productDesc?: string
  status?: string
  remark?: string
  attachments?: DealAttachment[]
}

const searchQ = ref('')
const sourceFilter = ref('')
const shopTypeFilter = ref('')
const assigneeFilter = ref<number | ''>('')
const dealStatusFilter = ref('')
const dateFrom = ref('')
const dateTo = ref('')
const salesUsers = ref<SalesUser[]>([])
const selectedRow = ref<any | null>(null)

const drawerVisible = ref(false)
const drawerRow = ref<any | null>(null)

const dealDialogVisible = ref(false)
const dealSaving = ref(false)
const dealForm = ref({
  dealDate: '',
  productDesc: '本土店',
  dealAmount: '' as string | number,
  remark: '',
})
const dealFiles = ref<File[]>([])
const dealFileInput = ref<HTMLInputElement | null>(null)

const uploadDialogVisible = ref(false)
const uploadSaving = ref(false)
const uploadTarget = ref<{ leadId: number; deal: DealRecord; customer: string } | null>(null)
const uploadFiles = ref<File[]>([])
const uploadFileInput = ref<HTMLInputElement | null>(null)

const SOURCE_OPTIONS = ['Takealot', '官网', '展会', '推荐', '小红书', '抖音', '其他']
const SHOP_TYPE_OPTIONS = ['本土店', '海外仓']
const DEAL_STATUS_OPTIONS = [
  { value: 'pending', label: '待转客户' },
  { value: 'confirmed', label: '已开通 OMS' },
]
const DEAL_FILE_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.zip'

const { page, pageSize, total, resetPage } = useServerPagination()

const { loading, items: deals, load } = useListLoader(async () => {
  const params: Record<string, string | number> = {
    status: 'deal',
    page: page.value,
    pageSize: pageSize.value,
  }
  const keyword = searchQ.value.trim()
  if (keyword) params.keyword = keyword
  if (sourceFilter.value) params.source = sourceFilter.value
  if (shopTypeFilter.value) params.shopType = shopTypeFilter.value
  if (assigneeFilter.value !== '') params.assigneeId = assigneeFilter.value
  if (dealStatusFilter.value) params.dealStatus = dealStatusFilter.value
  if (dateFrom.value) params.dealDateFrom = dateFrom.value
  if (dateTo.value) params.dealDateTo = dateTo.value

  const res = await leadApi.list(params)
  total.value = res.total ?? 0
  return {
    items: (res.items || []).map((r: any) => {
      const m = mapLead(r)
      const dealList: DealRecord[] = r.deals || []
      const latest = dealList[0]
      const fileCount = dealList.reduce((n, d) => n + (d.attachments?.length || 0), 0)
      const confirmed = dealList.some((d) => d.status === 'confirmed')
      const customerId = r.customerId ? Number(r.customerId) : null
      const erpStatus = customerId ? 'oms' : confirmed ? 'confirmed' : latest?.status || 'pending'
      return {
        id: latest?.dealNo || m.leadNo,
        name: m.company,
        channel: m.source || '—',
        shopType: latest?.productDesc || '本土店',
        dealDate: latest?.dealDate
          ? new Date(latest.dealDate).toLocaleDateString('zh-CN')
          : fmtTime(r.createdAt).split(' ')[0] || '—',
        owner: m.owner,
        contact: m.contact || r.contactPhone || '',
        contactName: r.contactName || m.contact || '',
        contactPhone: r.contactPhone || '',
        email: r.email || '',
        leadNo: m.leadNo,
        customerId,
        customerCode: r.customerCode || '',
        erpStatus,
        erpStatusLabel: customerId ? '已开通 OMS' : '待转客户',
        dealCount: dealList.length,
        fileCount,
        deals: dealList,
        _leadId: r.id,
        _raw: r,
      }
    }),
  }
})

async function loadSalesUsers() {
  try {
    const res = await usersApi.list({ roleCode: 'cs', pageSize: 50 })
    salesUsers.value = (res.items || [])
      .filter((u: any) => u.status === 1)
      .map((u: any) => ({
        id: Number(u.id),
        name: u.realName || u.username,
        username: u.username,
      }))
  } catch {
    salesUsers.value = []
  }
}

function applyFilters() {
  resetPage()
  selectedRow.value = null
  load()
}

function resetFilters() {
  searchQ.value = ''
  sourceFilter.value = ''
  shopTypeFilter.value = ''
  assigneeFilter.value = ''
  dealStatusFilter.value = ''
  dateFrom.value = ''
  dateTo.value = ''
  selectedRow.value = null
  applyFilters()
}

function toggleSelect(row: any, checked: boolean) {
  selectedRow.value = checked ? row : null
}

function openDeals(row: any) {
  drawerRow.value = row
  drawerVisible.value = true
}

function todayStr() {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function openAddDeal(row: any) {
  selectedRow.value = row
  drawerRow.value = row
  dealForm.value = {
    dealDate: todayStr(),
    productDesc: '本土店',
    dealAmount: '',
    remark: '',
  }
  dealFiles.value = []
  dealDialogVisible.value = true
}

function openUpload(row: any, deal: DealRecord) {
  uploadTarget.value = { leadId: row._leadId, deal, customer: row.name }
  uploadFiles.value = []
  uploadDialogVisible.value = true
}

function onPickFiles(list: FileList | null, target: 'deal' | 'upload') {
  const files = list ? Array.from(list) : []
  if (target === 'deal') dealFiles.value = files
  else uploadFiles.value = files
}

async function readFileAsBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  let binary = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary)
}

async function filesToPayload(files: File[]) {
  const attachments = []
  for (const file of files) {
    attachments.push({
      fileName: file.name,
      contentBase64: await readFileAsBase64(file),
    })
  }
  return attachments
}

function formatSize(size?: number) {
  if (!size) return ''
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function formatDealDate(value?: string) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('zh-CN')
}

async function submitAddDeal() {
  const row = drawerRow.value || selectedRow.value
  if (!row) return
  dealSaving.value = true
  try {
    const attachments = await filesToPayload(dealFiles.value)
    const amount = String(dealForm.value.dealAmount || '').trim()
    const ok = await withAction(async () => {
      await leadApi.deal(row._leadId, {
        dealDate: dealForm.value.dealDate || todayStr(),
        productDesc: dealForm.value.productDesc || '本土店',
        dealAmount: amount ? Number(amount) : undefined,
        remark: dealForm.value.remark.trim() || undefined,
        attachments,
      })
      await load()
    }, '已新增成交')
    if (ok) {
      dealDialogVisible.value = false
      refreshDrawer(row._leadId)
    }
  } finally {
    dealSaving.value = false
  }
}

async function submitUpload() {
  if (!uploadTarget.value) return
  if (!uploadFiles.value.length) {
    ElMessage.warning('请选择要上传的客户资料')
    return
  }
  uploadSaving.value = true
  try {
    const attachments = await filesToPayload(uploadFiles.value)
    const { leadId, deal } = uploadTarget.value
    const ok = await withAction(async () => {
      await leadApi.uploadDealAttachments(leadId, deal.id, attachments)
      await load()
    }, '客户资料已上传')
    if (ok) {
      uploadDialogVisible.value = false
      refreshDrawer(leadId)
    }
  } finally {
    uploadSaving.value = false
  }
}

function refreshDrawer(leadId: number) {
  const next = deals.value.find((r: any) => r._leadId === leadId)
  if (next) drawerRow.value = next
}

async function downloadFile(leadId: number, deal: DealRecord, att: DealAttachment) {
  try {
    const { blob, fileName } = await leadApi.downloadDealAttachment(leadId, deal.id, att.id)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName || att.fileName
    a.click()
    URL.revokeObjectURL(url)
  } catch (e: any) {
    ElMessage.error(e?.message || '下载失败')
  }
}

async function toErp(row: any) {
  if (row.customerId) return
  const leadNo = String(row.leadNo || row.id || '')
  const codeRest = leadNo.replace(/^LD-?/i, '').replace(/[^A-Za-z0-9_-]/g, '') || Date.now().toString().slice(-8)
  const shopType = String(row.shopType || '')
  const omsType: OmsCustomerType = shopType.includes('海外') ? 'catalog' : 'ecommerce'
  omsTarget.value = row
  omsForm.value = {
    customerCode: `CUS-${codeRest}`.slice(0, 30),
    customerName: row.name || '',
    companyName: row.name || '',
    contactName: row.contactName || '',
    contactPhone: row.contactPhone || '',
    contactEmail: row.email || '',
    omsType,
    warehouse: warehouseOptions.value[0]?.code || 'WMS-JHB-01',
    permissionTemplate: omsType,
    username: String(row.customerCode || `cus${Date.now().toString().slice(-8)}`).trim().toLowerCase().slice(0, 50),
    temporaryPassword: '',
    confirmPassword: '',
  }
  omsDialogVisible.value = true
}

const omsDialogVisible = ref(false)
const omsSaving = ref(false)
const omsTarget = ref<any>(null)
const omsFormRef = ref<FormInstance>()
const warehouseOptions = ref<{ code: string; name: string }[]>([])
const omsSuccessVisible = ref(false)
const omsSuccess = ref<{ customerCode: string; username: string; customerId?: number } | null>(null)
const omsForm = ref({
  customerCode: '',
  customerName: '',
  companyName: '',
  contactName: '',
  contactPhone: '',
  contactEmail: '',
  omsType: 'ecommerce' as OmsCustomerType,
  warehouse: 'WMS-JHB-01',
  permissionTemplate: 'ecommerce' as OmsCustomerType,
  username: '',
  temporaryPassword: '',
  confirmPassword: '',
})

const USERNAME_PATTERN = /^[A-Za-z0-9._-]+$/
function omsUsernameValidator(required: boolean) {
  return (_rule: unknown, value: unknown, callback: (error?: Error) => void) => {
    const username = String(value ?? '').trim().toLowerCase()
    if (!username) callback(required ? new Error('请填写 OMS 登录账号') : undefined)
    else if (username.length < 6) callback(new Error('登录账号至少 6 个字符'))
    else if (username.length > 50 || !USERNAME_PATTERN.test(username)) {
      callback(new Error('登录账号须为 6-50 位字母、数字、点、下划线或短横线'))
    } else callback()
  }
}
const omsRules: FormRules = {
  customerCode: [{ required: true, message: '请填写客户代码', trigger: 'blur' }],
  customerName: [{ required: true, message: '请填写客户名称', trigger: 'blur' }],
  omsType: [{ required: true, message: '请选择 OMS 客户类型', trigger: 'change' }],
  warehouse: [{ required: true, message: '请选择默认仓库', trigger: 'change' }],
  username: [{ validator: omsUsernameValidator(true), trigger: 'blur' }],
  temporaryPassword: [{
    validator: (_rule, value, callback) => {
      const password = String(value ?? '')
      if (!password) callback(new Error('请填写临时密码'))
      else if (password.length < 6) callback(new Error('临时密码至少 6 位'))
      else if (password.length > 128) callback(new Error('临时密码不能超过 128 位'))
      else callback()
    },
    trigger: 'blur',
  }],
  confirmPassword: [{
    validator: (_rule, value, callback) => {
      if (!value) callback(new Error('请再次输入临时密码'))
      else if (value !== omsForm.value.temporaryPassword) callback(new Error('两次输入的临时密码不一致'))
      else callback()
    },
    trigger: 'blur',
  }],
}

async function loadWarehouses() {
  try {
    const res = await warehouseApi.list({ type: 'overseas' })
    const items = Array.isArray(res) ? res : (res.items || [])
    warehouseOptions.value = items
      .map((item: any) => ({
        code: item.warehouseCode || item.code,
        name: item.warehouseName || item.name || item.warehouseCode || item.code,
      }))
      .filter((item: { code: string }) => Boolean(item.code))
  } catch {
    warehouseOptions.value = [{ code: 'WMS-JHB-01', name: 'JHB 海外仓' }]
  }
  if (!warehouseOptions.value.length) {
    warehouseOptions.value = [{ code: 'WMS-JHB-01', name: 'JHB 海外仓' }]
  }
}

async function submitOmsAccount() {
  if (!omsTarget.value?._leadId) return
  try {
    await omsFormRef.value?.validate()
  } catch {
    return
  }
  const f = omsForm.value
  omsSaving.value = true
  try {
    const result = await leadApi.confirmToErp(omsTarget.value._leadId, {
      customerCode: f.customerCode.trim(),
      customerName: f.customerName.trim(),
      companyName: f.companyName.trim() || f.customerName.trim(),
      contactEmail: f.contactEmail.trim().toLowerCase() || undefined,
      contactName: f.contactName.trim() || undefined,
      contactPhone: f.contactPhone.trim() || undefined,
      portalType: f.omsType,
      omsType: f.omsType,
      warehouse: f.warehouse.trim(),
      permissionTemplate: f.permissionTemplate || f.omsType,
      username: f.username.trim().toLowerCase(),
      temporaryPassword: f.temporaryPassword,
    })
    omsDialogVisible.value = false
    omsForm.value.temporaryPassword = ''
    omsForm.value.confirmPassword = ''
    omsSuccess.value = {
      customerCode: result.customerCode,
      username: result.portalUsername || result.portalLoginEmail || f.username,
      customerId: result.customerId,
    }
    omsSuccessVisible.value = true
    await load()
  } catch (e: any) {
    ElMessage.error(e?.message || '开通失败，请检查客户代码/登录邮箱是否已被使用')
  } finally {
    omsSaving.value = false
  }
}

watch([page, pageSize], () => {
  selectedRow.value = null
  load()
})
onMounted(async () => {
  await loadSalesUsers()
  await loadWarehouses()
  await load()
})
</script>

<template>
  <el-card v-loading="loading">
    <template #header>
      <div class="page-header">
        <span class="page-title">成交管理</span>
        <el-button size="small" @click="exportTask('成交客户')">导出</el-button>
      </div>
    </template>

    <div class="filter-bar">
      <el-input
        v-model="searchQ"
        placeholder="客户名 / 成交编号 / 联系方式"
        clearable
        size="small"
        style="width: 200px"
        @keyup.enter="applyFilters"
        @clear="applyFilters"
      />
      <el-select v-model="sourceFilter" placeholder="全部渠道" clearable size="small" style="width: 110px" @change="applyFilters">
        <el-option v-for="s in SOURCE_OPTIONS" :key="s" :label="s" :value="s" />
      </el-select>
      <el-select v-model="shopTypeFilter" placeholder="店铺类型" clearable size="small" style="width: 110px" @change="applyFilters">
        <el-option v-for="s in SHOP_TYPE_OPTIONS" :key="s" :label="s" :value="s" />
      </el-select>
      <el-select
        v-model="assigneeFilter"
        placeholder="全部负责人"
        clearable
        filterable
        size="small"
        style="width: 120px"
        @change="applyFilters"
      >
        <el-option v-for="u in salesUsers" :key="u.id" :label="u.name" :value="u.id" />
      </el-select>
      <el-select v-model="dealStatusFilter" placeholder="转客户状态" clearable size="small" style="width: 130px" @change="applyFilters">
        <el-option v-for="s in DEAL_STATUS_OPTIONS" :key="s.value" :label="s.label" :value="s.value" />
      </el-select>
      <el-date-picker
        v-model="dateFrom"
        type="date"
        value-format="YYYY-MM-DD"
        placeholder="成交开始"
        size="small"
        style="width: 130px"
        @change="applyFilters"
      />
      <el-date-picker
        v-model="dateTo"
        type="date"
        value-format="YYYY-MM-DD"
        placeholder="成交结束"
        size="small"
        style="width: 130px"
        @change="applyFilters"
      />
      <el-button type="primary" size="small" @click="applyFilters">查询</el-button>
      <el-button size="small" @click="resetFilters">重置</el-button>
    </div>

    <el-table :data="deals" stripe border size="small" row-key="_leadId">
      <el-table-column label="" width="48" align="center" fixed="left">
        <template #default="{ row }">
          <el-checkbox
            :model-value="selectedRow?._leadId === row._leadId"
            @change="(checked) => toggleSelect(row, Boolean(checked))"
          />
        </template>
      </el-table-column>
      <el-table-column prop="id" label="最近成交编号" width="140">
        <template #default="{ row }"><span style="font-family:var(--font-mono);font-size:12px">{{ row.id }}</span></template>
      </el-table-column>
      <el-table-column prop="name" label="客户名" min-width="130" />
      <el-table-column prop="channel" label="渠道" width="80" />
      <el-table-column prop="shopType" label="店铺类型" width="100">
        <template #default="{ row }">
          <el-tag :type="row.shopType === '本土店' ? 'success' : row.shopType === '海外仓' ? 'warning' : 'info'" size="small">{{ row.shopType }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="成交次数" width="90" align="center">
        <template #default="{ row }">{{ row.dealCount }}</template>
      </el-table-column>
      <el-table-column label="客户资料" width="90" align="center">
        <template #default="{ row }">{{ row.fileCount }} 份</template>
      </el-table-column>
      <el-table-column prop="contact" label="联系方式" width="130" />
      <el-table-column prop="owner" label="负责人" width="120" />
      <el-table-column prop="dealDate" label="最近成交" width="110" />
      <el-table-column prop="erpStatusLabel" label="OMS 开户" width="110">
        <template #default="{ row }">
          <el-tag :type="row.customerId ? 'success' : 'warning'" size="small">{{ row.erpStatusLabel }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="260" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openDeals(row)">成交记录</el-button>
          <el-button link type="primary" size="small" @click="openAddDeal(row)">再次成交</el-button>
          <el-button
            v-if="!row.customerId"
            link
            type="primary"
            size="small"
            @click="toErp(row)"
          >
            转 ERP/OMS 客户
          </el-button>
          <el-button
            v-else
            link
            type="success"
            size="small"
            @click="router.push({ path: '/customers', query: { q: row.customerCode } })"
          >
            查看客户
          </el-button>
        </template>
      </el-table-column>
    </el-table>
    <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="total" />
  </el-card>

  <el-drawer v-model="drawerVisible" :title="`成交记录 · ${drawerRow?.name || ''}`" size="640px">
    <div v-if="drawerRow" class="deal-drawer">
      <div class="drawer-actions">
        <el-button type="primary" size="small" @click="openAddDeal(drawerRow)">再次成交</el-button>
      </div>
      <el-empty v-if="!drawerRow.deals?.length" description="暂无成交记录" />
      <div v-for="deal in drawerRow.deals" :key="deal.id" class="deal-card">
        <div class="deal-card-head">
          <div>
            <div class="deal-no">{{ deal.dealNo }}</div>
            <div class="deal-meta">
              {{ formatDealDate(deal.dealDate) }}
              · {{ deal.productDesc || '—' }}
              <span v-if="deal.dealAmount"> · ¥{{ deal.dealAmount }}</span>
            </div>
          </div>
          <el-tag :type="deal.status === 'confirmed' ? 'success' : 'warning'" size="small">
            {{ deal.status === 'confirmed' ? '已转客户' : '待转客户' }}
          </el-tag>
        </div>
        <div v-if="deal.remark" class="deal-remark">备注：{{ deal.remark }}</div>
        <div class="file-head">
          <span>客户资料（{{ deal.attachments?.length || 0 }}）</span>
          <el-button link type="primary" size="small" @click="openUpload(drawerRow, deal)">上传资料</el-button>
        </div>
        <el-empty v-if="!deal.attachments?.length" description="尚未上传资料，可多次补充" :image-size="48" />
        <ul v-else class="file-list">
          <li v-for="att in deal.attachments" :key="att.id">
            <el-button link type="primary" @click="downloadFile(drawerRow._leadId, deal, att)">
              {{ att.fileName }}
            </el-button>
            <span class="file-size">{{ formatSize(att.fileSize) }}</span>
          </li>
        </ul>
      </div>
    </div>
  </el-drawer>

  <el-dialog v-model="dealDialogVisible" title="再次成交" width="520px" destroy-on-close>
    <el-form label-width="92px">
      <el-form-item label="成交日期" required>
        <el-date-picker
          v-model="dealForm.dealDate"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="选择成交日期"
          style="width:100%"
        />
      </el-form-item>
      <el-form-item label="店铺类型" required>
        <el-select v-model="dealForm.productDesc" style="width:100%">
          <el-option v-for="s in SHOP_TYPE_OPTIONS" :key="s" :label="s" :value="s" />
        </el-select>
      </el-form-item>
      <el-form-item label="成交金额">
        <el-input v-model="dealForm.dealAmount" placeholder="可选" />
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="dealForm.remark" type="textarea" :rows="2" maxlength="500" show-word-limit />
      </el-form-item>
      <el-form-item label="客户资料">
        <div>
          <input
            ref="dealFileInput"
            type="file"
            multiple
            :accept="DEAL_FILE_ACCEPT"
            @change="onPickFiles(($event.target as HTMLInputElement).files, 'deal')"
          />
          <div class="file-hint">可先成交再补传，也可本次一起上传。支持 PDF / 图片 / Word / Excel / ZIP，单文件不超过 10MB。</div>
          <div v-if="dealFiles.length" class="picked">已选 {{ dealFiles.length }} 个文件</div>
        </div>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="dealDialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="dealSaving" @click="submitAddDeal">确认成交</el-button>
    </template>
  </el-dialog>

  <el-dialog
    v-model="uploadDialogVisible"
    :title="`上传客户资料 · ${uploadTarget?.deal.dealNo || ''}`"
    width="480px"
    destroy-on-close
  >
    <p class="file-hint">可多次补充上传，不会覆盖已有资料。</p>
    <input
      ref="uploadFileInput"
      type="file"
      multiple
      :accept="DEAL_FILE_ACCEPT"
      @change="onPickFiles(($event.target as HTMLInputElement).files, 'upload')"
    />
    <div v-if="uploadFiles.length" class="picked">已选 {{ uploadFiles.length }} 个文件</div>
    <template #footer>
      <el-button @click="uploadDialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="uploadSaving" @click="submitUpload">上传</el-button>
    </template>
  </el-dialog>

  <el-dialog
    v-model="omsDialogVisible"
    title="转为 ERP 客户并开通 OMS 账号"
    width="640px"
    destroy-on-close
    append-to-body
    :close-on-click-modal="false"
  >
    <p class="oms-hint">成交后需要同时建立 ERP 客户档案，并填写登录信息帮客户开通 OMS 账号。临时密码仅显示一次，客户首次登录必须修改。</p>
    <el-form ref="omsFormRef" :model="omsForm" :rules="omsRules" label-width="108px">
      <el-form-item label="客户代码" prop="customerCode" required>
        <el-input v-model="omsForm.customerCode" placeholder="如 CUS-001" maxlength="30" />
      </el-form-item>
      <el-form-item label="客户名称" prop="customerName" required>
        <el-input v-model="omsForm.customerName" placeholder="OMS / ERP 显示名称" maxlength="200" />
      </el-form-item>
      <el-form-item label="公司全称">
        <el-input v-model="omsForm.companyName" maxlength="200" />
      </el-form-item>
      <el-form-item label="联系人">
        <el-input v-model="omsForm.contactName" maxlength="50" />
      </el-form-item>
      <el-form-item label="联系电话">
        <el-input v-model="omsForm.contactPhone" maxlength="30" />
      </el-form-item>
      <el-form-item label="联系邮箱">
        <el-input v-model="omsForm.contactEmail" type="email" placeholder="选填，可与登录邮箱相同" />
      </el-form-item>
      <el-form-item label="OMS 客户类型" prop="omsType" required>
        <el-select
          v-model="omsForm.omsType"
          style="width:100%"
          @change="(v: OmsCustomerType) => { omsForm.permissionTemplate = v }"
        >
          <el-option label="电商客户" value="ecommerce" />
          <el-option label="货盘客户" value="catalog" />
          <el-option label="混合客户" value="hybrid" />
        </el-select>
      </el-form-item>
      <el-form-item label="默认仓库" prop="warehouse" required>
        <el-select v-model="omsForm.warehouse" filterable allow-create default-first-option style="width:100%">
          <el-option
            v-for="wh in warehouseOptions"
            :key="wh.code"
            :label="`${wh.name} · ${wh.code}`"
            :value="wh.code"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="OMS 登录账号" prop="username" required>
        <el-input v-model="omsForm.username" autocomplete="off" placeholder="至少 6 位，字母数字或 . _ -" />
      </el-form-item>
      <el-form-item label="临时密码" prop="temporaryPassword" required>
        <el-input v-model="omsForm.temporaryPassword" type="password" show-password autocomplete="new-password" placeholder="至少 6 位" />
      </el-form-item>
      <el-form-item label="确认密码" prop="confirmPassword" required>
        <el-input v-model="omsForm.confirmPassword" type="password" show-password autocomplete="new-password" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="omsDialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="omsSaving" @click="submitOmsAccount">创建客户并开通 OMS</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="omsSuccessVisible" width="520px" destroy-on-close append-to-body>
    <el-result icon="success" title="ERP 客户与 OMS 账号已开通" sub-title="请把登录账号和临时密码交给客户，并提醒首次登录必须改密">
      <template #extra>
        <div v-if="omsSuccess" class="oms-success">
          <div><span>客户代码</span><strong>{{ omsSuccess.customerCode }}</strong></div>
          <div><span>OMS 登录账号</span><strong>{{ omsSuccess.username }}</strong></div>
        </div>
        <el-button @click="omsSuccessVisible = false">完成</el-button>
        <el-button type="primary" @click="omsSuccessVisible = false; router.push('/customers')">去客户列表</el-button>
        <el-button
          v-if="omsSuccess?.customerId"
          type="success"
          @click="router.push({ path: '/customer-recharge', query: { customerId: String(omsSuccess.customerId) } })"
        >
          去充值
        </el-button>
      </template>
    </el-result>
  </el-dialog>
</template>

<style scoped>
.page-header { display:flex; align-items:center; justify-content:space-between; }
.page-title { font-weight:600; font-size:15px; }
.filter-bar { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px; align-items:center; }
.deal-drawer { display:flex; flex-direction:column; gap:12px; }
.drawer-actions { display:flex; justify-content:flex-end; }
.deal-card { border:1px solid var(--el-border-color); border-radius:8px; padding:12px; }
.deal-card-head { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; }
.deal-no { font-family:var(--font-mono); font-size:13px; font-weight:600; }
.deal-meta, .deal-remark, .file-hint, .file-size, .picked { color:var(--el-text-color-secondary); font-size:12px; }
.deal-remark { margin:8px 0 4px; }
.file-head { display:flex; justify-content:space-between; align-items:center; margin:10px 0 6px; font-weight:600; }
.file-list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:4px; }
.file-hint { margin:0 0 8px; }
.picked { margin-top:6px; }
.oms-hint { margin:0 0 14px; font-size:13px; color:var(--el-text-color-secondary); line-height:1.6; }
.oms-success { display:flex; flex-direction:column; gap:8px; text-align:left; margin:0 auto 16px; padding:12px 14px; border:1px solid var(--el-border-color-lighter); border-radius:8px; }
.oms-success div { display:flex; justify-content:space-between; gap:12px; font-size:13px; }
.oms-success span { color:var(--el-text-color-secondary); }
.oms-success strong { font-family:var(--font-mono); }
</style>
