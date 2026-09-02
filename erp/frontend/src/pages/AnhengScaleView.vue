<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { anhengApi } from '@/api/client.js'
import { fmtTime } from '@/api/mappers.ts'
import { useAppStore } from '@/stores/app'
import ListPagination from '@/components/ListPagination.vue'

const app = useAppStore()
const canTest = computed(() => app.hasPerm('anheng.test'))

const loading = ref(false)
const saving = ref(false)
const tab = ref('outputs')
const autoRefresh = ref(true)
const keyword = ref('')
const page = ref(1)
const pageSize = ref(20)
const events = ref<any[]>([])
const eventTotal = ref(0)
const photos = ref<any[]>([])
const photoTotal = ref(0)
const photoPage = ref(1)
const photoPageSize = ref(20)
const photoPreviewUrl = ref('')
const photoPreviewNo = ref('')

const config = ref({
  enabled: true,
  deviceKey: '',
  chuteMessage: '',
  requireMemberId: false,
  printData: '',
  hasDeviceKey: false,
  outputs: {
    weighSuccess: { result: 'true', message: '' },
    weighMemberId: { result: 'true', message: 'Member ID' },
    weighFail: { result: 'false', message: 'ticketsNum 不能为空' },
    imageOk: { isOk: 1 },
  },
  spec: {
    weighSample: {
      ticketsNum: '12345',
      weight: '1.000',
      length: '1.0',
      width: '1.0',
      height: '1.0',
      volume: '0.0',
      machine: 'OOPS-DWS-01',
      memberno: '会员代号',
      warehouse: '仓位号',
      goodsname: '品名字段',
      goodsnum: '1',
      expressname: '供应商字段',
      myremarks: '备注字段',
    },
    weighSuccess: { result: 'true', message: '' },
    weighMemberId: { result: 'true', message: 'Member ID' },
    imageOk: { isOk: 1 },
  },
})

const lastReply = ref<any>(null)

const sim = ref({
  ticketsNum: '12345',
  weight: '1.000',
  length: '1.0',
  width: '1.0',
  height: '1.0',
  volume: '0.0',
  machine: 'OOPS-DWS-01',
  memberno: '会员代号',
  warehouse: '仓位号',
  goodsname: '品名字段',
  goodsnum: '件数字段',
  expressname: '供应商字段',
  myremarks: '备注字段',
  asArray: false,
})

const simExpressNo = ref('SF17452146')
const simFileBase64 = ref('')
const simFileName = ref('')

const origin = computed(() => (typeof window === 'undefined' ? '' : window.location.origin))
const weighUrl = computed(() => `${origin.value}/api/weighing`)
const weighAliasUrl = computed(() => `${origin.value}/api/wcs/weigh`)
const imageUrl = computed(() => `${origin.value}/api/image/upload`)
const pythonSnippet = computed(() => `with WCSWMSClient(
    weighing_url="${weighUrl.value}",
) as client:
    weighing_result = client.send_weighing_data(
        WeighingData(
            tickets_num="12345",
            weight="1.000",
            length="1.0",
            width="1.0",
            height="1.0",
            volume="0.0",
            machine="OOPS-DWS-01",
            member_no="会员代号",
            warehouse="仓位号",
            goods_name="品名字段",
            goods_num=1,
            express_name="供应商字段",
            remarks="备注字段",
        )
    )
    print(weighing_result)
`)
const latest = computed(() => events.value[0] || null)
const liveOutputs = computed(() => {
  const successMessage = config.value.requireMemberId ? 'Member ID' : (config.value.chuteMessage || '')
  const weighSuccess: Record<string, string> = { result: 'true', message: successMessage }
  if (!config.value.requireMemberId && config.value.printData) weighSuccess.printdata = config.value.printData
  return {
    weighSuccess,
    weighMemberId: { result: 'true', message: 'Member ID' },
    weighFail: { result: 'false', message: 'ticketsNum 不能为空' },
  }
})

function pretty(value: unknown) {
  return JSON.stringify(value, null, 2)
}

function copyJson(value: unknown) {
  copy(pretty(value))
}

let timer: ReturnType<typeof setInterval> | null = null
let previewObjectUrl = ''

function copy(text: string) {
  navigator.clipboard.writeText(text).then(
    () => ElMessage.success('已复制'),
    () => ElMessage.error('复制失败'),
  )
}

async function loadConfig() {
  try {
    const res = await anhengApi.config()
    config.value = { ...config.value, ...res }
  } catch (e: any) {
    ElMessage.error(e?.message || '加载配置失败')
  }
}

async function saveConfig() {
  saving.value = true
  try {
    const saved = await anhengApi.saveConfig({
      enabled: config.value.enabled,
      deviceKey: config.value.deviceKey,
      chuteMessage: config.value.chuteMessage,
      requireMemberId: config.value.requireMemberId,
      printData: config.value.printData,
    })
    config.value = { ...config.value, ...saved }
    ElMessage.success('配置已保存')
  } catch (e: any) {
    ElMessage.error(e?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function loadEvents(silent = false) {
  if (!silent) loading.value = true
  try {
    const res = await anhengApi.events({
      page: page.value,
      pageSize: pageSize.value,
      keyword: keyword.value.trim(),
    })
    events.value = res.items || []
    eventTotal.value = res.total ?? 0
  } catch (e: any) {
    if (!silent) {
      events.value = []
      eventTotal.value = 0
      ElMessage.error(e?.message || '加载测量记录失败')
    }
  } finally {
    loading.value = false
  }
}

async function loadPhotos() {
  try {
    const res = await anhengApi.photos({
      page: photoPage.value,
      pageSize: photoPageSize.value,
      keyword: keyword.value.trim(),
    })
    photos.value = res.items || []
    photoTotal.value = res.total ?? 0
  } catch (e: any) {
    photos.value = []
    photoTotal.value = 0
    ElMessage.error(e?.message || '加载照片失败')
  }
}

function search() {
  page.value = 1
  photoPage.value = 1
  loadEvents()
  if (tab.value === 'photos') loadPhotos()
}

async function simulateWeigh() {
  try {
    const required = ['ticketsNum', 'weight', 'length', 'width', 'height', 'volume', 'machine'] as const
    const optional = ['memberno', 'warehouse', 'goodsname', 'goodsnum', 'expressname', 'myremarks'] as const
    const payload: Record<string, string> = {}
    for (const key of required) payload[key] = String(sim.value[key] ?? '')
    for (const key of optional) {
      const value = String(sim.value[key] ?? '').trim()
      if (value) payload[key] = value
    }
    const body = sim.value.asArray ? [payload] : payload
    lastReply.value = await anhengApi.simulateWeigh(body)
    ElMessage.success(`设备应答 result=${lastReply.value?.result}`)
    page.value = 1
    await loadEvents()
  } catch (e: any) {
    ElMessage.error(e?.message || '模拟称重失败')
  }
}

function onPickPhoto(file: File) {
  simFileName.value = file.name
  const reader = new FileReader()
  reader.onload = () => {
    const text = String(reader.result || '')
    const idx = text.indexOf('base64,')
    simFileBase64.value = idx >= 0 ? text.slice(idx + 7) : text
  }
  reader.readAsDataURL(file)
  return false
}

async function simulateImage() {
  if (!simFileBase64.value) {
    ElMessage.warning('请先选择一张 JPEG 照片')
    return
  }
  try {
    lastReply.value = await anhengApi.simulateImage({
      expressNo: simExpressNo.value.trim() || sim.value.ticketsNum,
      file: simFileBase64.value,
    })
    ElMessage.success(`设备应答 isOk=${lastReply.value?.isOk}`)
    tab.value = 'photos'
    await loadPhotos()
  } catch (e: any) {
    ElMessage.error(e?.message || '模拟传图失败')
  }
}

async function previewPhoto(row: any) {
  try {
    const { blob } = await anhengApi.photoFile(row.id)
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl)
    previewObjectUrl = URL.createObjectURL(blob)
    photoPreviewUrl.value = previewObjectUrl
    photoPreviewNo.value = row.expressNo
  } catch (e: any) {
    ElMessage.error(e?.message || '打开照片失败')
  }
}

function closePreview() {
  photoPreviewUrl.value = ''
  if (previewObjectUrl) {
    URL.revokeObjectURL(previewObjectUrl)
    previewObjectUrl = ''
  }
}

async function clearData() {
  try {
    await ElMessageBox.confirm('将删除本模块全部测量记录和照片记录，仅用于联调清场。', '清空测试数据', {
      type: 'warning',
      confirmButtonText: '清空',
      cancelButtonText: '取消',
    })
    const res = await anhengApi.clearEvents()
    ElMessage.success(`已删除测量 ${res.deletedEvents} 条、照片 ${res.deletedPhotos} 条`)
    await Promise.all([loadEvents(), loadPhotos()])
  } catch (e: any) {
    if (e !== 'cancel') ElMessage.error(e?.message || '清空失败')
  }
}

function startTimer() {
  stopTimer()
  timer = setInterval(() => {
    if (!autoRefresh.value || document.hidden) return
    loadEvents(true)
    if (tab.value === 'photos') loadPhotos()
  }, 4000)
}

function stopTimer() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

watch([page, pageSize], () => loadEvents())
watch([photoPage, photoPageSize], () => loadPhotos())
watch(tab, (name) => {
  if (name === 'photos') loadPhotos()
})

onMounted(async () => {
  await loadConfig()
  await loadEvents()
  startTimer()
})

onUnmounted(() => {
  stopTimer()
  closePreview()
})
</script>

<template>
  <el-card v-loading="loading">
    <template #header>
      <div class="page-header">
        <span class="page-title">安衡测量仪</span>
        <div class="header-actions">
          <el-input v-model="keyword" placeholder="单号 / 设备 / 仓" clearable size="small" style="width:200px" @keyup.enter="search" />
          <el-button size="small" @click="search">查询</el-button>
          <el-switch v-model="autoRefresh" size="small" active-text="自动刷新" />
          <el-button v-if="canTest" size="small" type="danger" plain @click="clearData">清空测试数据</el-button>
        </div>
      </div>
    </template>

    <el-alert type="info" :closable="false" show-icon style="margin-bottom:14px">
      对齐安衡 Python 客户端：称重 POST 单个 JSON 对象到 <code>/api/weighing</code>，返回裸 JSON。当前联调不含图片上传。
    </el-alert>

    <div class="top-grid">
      <div class="panel">
        <div class="panel-title">设备接入地址</div>
        <div class="url-row">
          <span class="url-label">称重 POST</span>
          <code>{{ weighUrl }}</code>
          <el-button link type="primary" size="small" @click="copy(weighUrl)">复制</el-button>
        </div>
        <div class="url-row">
          <span class="url-label">兼容地址</span>
          <code>{{ weighAliasUrl }}</code>
          <el-button link type="primary" size="small" @click="copy(weighAliasUrl)">复制</el-button>
        </div>
        <div class="url-row">
          <span class="url-label">传图 POST</span>
          <code>{{ imageUrl }}</code>
          <el-button link type="primary" size="small" @click="copy(imageUrl)">复制</el-button>
        </div>
        <p class="hint">Python <code>WCSWMSClient(weighing_url=...)</code> 填「称重 POST」。Body 是单个对象，字段全是字符串。传图填「传图 POST」，本轮可不接。</p>
      </div>

      <div class="panel live-panel">
        <div class="panel-title">最近一次测量</div>
        <template v-if="latest">
          <div class="weight">{{ latest.weightKg || '—' }}<small> kg</small></div>
          <div class="live-meta">
            <span>{{ latest.ticketsNum || '无单号' }}</span>
            <span>{{ latest.lengthMm || '—' }} × {{ latest.widthMm || '—' }} × {{ latest.heightMm || '—' }} mm</span>
            <span>{{ latest.machine || '未知设备' }}</span>
            <span>{{ fmtTime(latest.createdAt) }}</span>
          </div>
        </template>
        <div v-else class="empty-live">还没有收到测量数据，可用下方模拟推送或等设备上报。</div>
      </div>
    </div>

    <el-form v-if="canTest" label-width="92px" size="small" class="config-form" @submit.prevent="saveConfig">
      <el-form-item label="接收开关">
        <el-switch v-model="config.enabled" active-text="接收设备数据" />
      </el-form-item>
      <el-form-item label="设备 Key">
        <el-input v-model="config.deviceKey" placeholder="留空则不校验" clearable style="max-width:280px" />
      </el-form-item>
      <el-form-item label="格口/提示">
        <el-input v-model="config.chuteMessage" placeholder="成功时返回给设备的 message" clearable style="max-width:280px" />
      </el-form-item>
      <el-form-item label="补会员号">
        <el-switch v-model="config.requireMemberId" active-text='返回 message = "Member ID"' />
      </el-form-item>
      <el-form-item label="printdata">
        <el-input v-model="config.printData" placeholder="可选，成功时原样回给设备" clearable style="max-width:420px" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :loading="saving" @click="saveConfig">保存配置</el-button>
      </el-form-item>
    </el-form>

    <el-tabs v-model="tab" type="card">
      <el-tab-pane label="输出约定" name="outputs" />
      <el-tab-pane label="测量记录" name="events" />
      <el-tab-pane v-if="canTest" label="模拟推送" name="simulate" />
      <el-tab-pane label="称重照片" name="photos" />
    </el-tabs>

    <template v-if="tab === 'outputs'">
      <div class="output-grid">
        <div class="panel">
          <div class="panel-title-row">
            <span class="panel-title">称重成功 · 文档 1.4</span>
            <el-button link type="primary" size="small" @click="copyJson(liveOutputs.weighSuccess)">复制</el-button>
          </div>
          <p class="hint">当前配置下，设备称重成功时本模块实际返回：</p>
          <pre>{{ pretty(liveOutputs.weighSuccess) }}</pre>
        </div>
        <div class="panel">
          <div class="panel-title-row">
            <span class="panel-title">补录会员号 · 文档 1.5</span>
            <el-button link type="primary" size="small" @click="copyJson(liveOutputs.weighMemberId)">复制</el-button>
          </div>
          <p class="hint">开启「补会员号」后，message 必须是 Member ID，设备按此弹窗。</p>
          <pre>{{ pretty(liveOutputs.weighMemberId) }}</pre>
        </div>
        <div class="panel">
          <div class="panel-title-row">
            <span class="panel-title">称重失败</span>
            <el-button link type="primary" size="small" @click="copyJson(liveOutputs.weighFail)">复制</el-button>
          </div>
          <p class="hint">result 是字符串 "false"，不是布尔。message 为错误原因。</p>
          <pre>{{ pretty(liveOutputs.weighFail) }}</pre>
        </div>
        <div class="panel">
          <div class="panel-title-row">
            <span class="panel-title">Python 客户端怎么填</span>
            <el-button link type="primary" size="small" @click="copy(pythonSnippet)">复制</el-button>
          </div>
          <p class="hint">与现有 WCSWMSClient 一致：weighing_url 指向本模块，不要传 image_upload_url。</p>
          <pre>{{ pythonSnippet }}</pre>
        </div>
      </div>
      <div class="panel" style="margin-top:12px">
        <div class="panel-title-row">
          <span class="panel-title">称重请求体（单个对象，对齐 to_payload）</span>
          <el-button link type="primary" size="small" @click="copyJson(config.spec.weighSample)">复制</el-button>
        </div>
        <p class="hint">POST {{ weighUrl }}，Content-Type: application/json; charset=utf-8。None 字段不要带。成功时客户端把 result 的 "true" 当成成功。</p>
        <pre>{{ pretty(config.spec.weighSample) }}</pre>
      </div>
    </template>

    <template v-else-if="tab === 'events'">
      <el-table :data="events" stripe border size="small">
        <el-table-column prop="ticketsNum" label="单号" min-width="130">
          <template #default="{ row }"><span class="mono">{{ row.ticketsNum || '—' }}</span></template>
        </el-table-column>
        <el-table-column prop="weightKg" label="重量(kg)" width="90" />
        <el-table-column label="尺寸(mm)" min-width="140">
          <template #default="{ row }">{{ row.lengthMm || '—' }} × {{ row.widthMm || '—' }} × {{ row.heightMm || '—' }}</template>
        </el-table-column>
        <el-table-column prop="volumeMm3" label="体积" width="100" />
        <el-table-column prop="machine" label="设备" width="110" />
        <el-table-column prop="warehouse" label="仓" width="80" />
        <el-table-column label="应答" width="90">
          <template #default="{ row }">
            <el-tag :type="row.result === 'true' ? 'success' : 'danger'" size="small">{{ row.result }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="message" label="message" min-width="120" show-overflow-tooltip />
        <el-table-column prop="source" label="来源" width="80" />
        <el-table-column label="时间" width="150">
          <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
        </el-table-column>
      </el-table>
      <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="eventTotal" />
    </template>

    <template v-else-if="tab === 'simulate'">
      <div class="sim-grid">
        <el-form label-width="88px" size="small">
          <el-form-item label="ticketsNum"><el-input v-model="sim.ticketsNum" /></el-form-item>
          <el-form-item label="weight"><el-input v-model="sim.weight" /></el-form-item>
          <el-form-item label="L/W/H">
            <div class="dim-row">
              <el-input v-model="sim.length" placeholder="长 mm" />
              <el-input v-model="sim.width" placeholder="宽 mm" />
              <el-input v-model="sim.height" placeholder="高 mm" />
            </div>
          </el-form-item>
          <el-form-item label="volume"><el-input v-model="sim.volume" /></el-form-item>
          <el-form-item label="machine"><el-input v-model="sim.machine" /></el-form-item>
          <el-form-item label="warehouse"><el-input v-model="sim.warehouse" /></el-form-item>
          <el-form-item label="memberno"><el-input v-model="sim.memberno" /></el-form-item>
          <el-form-item label="goodsname"><el-input v-model="sim.goodsname" /></el-form-item>
          <el-form-item label="goodsnum"><el-input v-model="sim.goodsnum" /></el-form-item>
          <el-form-item label="expressname"><el-input v-model="sim.expressname" /></el-form-item>
          <el-form-item label="myremarks"><el-input v-model="sim.myremarks" /></el-form-item>
          <el-form-item>
            <el-checkbox v-model="sim.asArray">改用数组根节点（Python 客户端不用）</el-checkbox>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" @click="simulateWeigh">模拟称重 POST</el-button>
          </el-form-item>
        </el-form>
        <div>
          <el-form label-width="88px" size="small">
            <el-form-item label="expressNo"><el-input v-model="simExpressNo" /></el-form-item>
            <el-form-item label="JPEG">
              <el-upload :show-file-list="false" accept="image/jpeg,.jpg,.jpeg" :before-upload="onPickPhoto">
                <el-button size="small">选择照片</el-button>
              </el-upload>
              <span v-if="simFileName" class="file-name">{{ simFileName }}</span>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="simulateImage">模拟传图 POST</el-button>
            </el-form-item>
          </el-form>
          <div v-if="lastReply" class="reply-box">
            <div class="panel-title">最近一次模拟应答</div>
            <pre>{{ JSON.stringify(lastReply, null, 2) }}</pre>
          </div>
        </div>
      </div>
    </template>

    <template v-else>
      <el-table :data="photos" stripe border size="small">
        <el-table-column prop="expressNo" label="单号" min-width="140">
          <template #default="{ row }"><span class="mono">{{ row.expressNo }}</span></template>
        </el-table-column>
        <el-table-column prop="fileSize" label="大小" width="100">
          <template #default="{ row }">{{ Math.round((row.fileSize || 0) / 1024) }} KB</template>
        </el-table-column>
        <el-table-column prop="source" label="来源" width="90" />
        <el-table-column label="时间" width="160">
          <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="previewPhoto(row)">查看</el-button>
          </template>
        </el-table-column>
      </el-table>
      <ListPagination v-model:page="photoPage" v-model:page-size="photoPageSize" :total="photoTotal" />
    </template>
  </el-card>

  <el-dialog :model-value="!!photoPreviewUrl" title="称重照片" width="560px" @close="closePreview">
    <div class="preview-wrap">
      <img v-if="photoPreviewUrl" :src="photoPreviewUrl" :alt="photoPreviewNo" />
    </div>
  </el-dialog>
</template>

<style scoped>
.page-header { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
.page-title { font-weight:600; font-size:15px; }
.header-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.top-grid { display:grid; grid-template-columns: 1.1fr 0.9fr; gap:12px; margin-bottom:14px; }
.panel { border:1px solid var(--el-border-color); border-radius:8px; padding:12px 14px; background:var(--el-bg-color); }
.panel-title { font-weight:600; font-size:13px; margin-bottom:8px; }
.panel-title-row { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:4px; }
.panel-title-row .panel-title { margin-bottom:0; }
.output-grid { display:grid; grid-template-columns: 1fr 1fr; gap:12px; }
.output-grid pre, .panel pre { margin:0; font-size:12px; white-space:pre-wrap; word-break:break-all; background:var(--el-fill-color-light); padding:10px 12px; border-radius:6px; }
.url-row { display:flex; align-items:center; gap:8px; margin-bottom:6px; flex-wrap:wrap; }
.url-label { color:var(--el-text-color-secondary); width:72px; flex-shrink:0; font-size:12px; }
code { font-family:var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); font-size:12px; }
.hint { margin:8px 0 0; color:var(--el-text-color-secondary); font-size:12px; line-height:1.5; }
.weight { font-size:36px; font-weight:700; letter-spacing:-0.04em; line-height:1.1; }
.weight small { font-size:14px; font-weight:500; color:var(--el-text-color-secondary); margin-left:4px; }
.live-meta { display:flex; flex-wrap:wrap; gap:8px 14px; margin-top:8px; color:var(--el-text-color-secondary); font-size:12px; }
.empty-live { color:var(--el-text-color-secondary); font-size:13px; padding:18px 0; }
.config-form { margin-bottom:8px; }
.mono { font-family:var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); font-size:12px; }
.sim-grid { display:grid; grid-template-columns: 1fr 1fr; gap:16px; }
.dim-row { display:flex; gap:8px; }
.file-name { margin-left:8px; color:var(--el-text-color-secondary); font-size:12px; }
.reply-box { border:1px dashed var(--el-border-color); border-radius:8px; padding:10px 12px; }
.reply-box pre { margin:0; font-size:12px; white-space:pre-wrap; word-break:break-all; }
.preview-wrap { display:flex; justify-content:center; }
.preview-wrap img { max-width:100%; max-height:70vh; }
@media (max-width: 900px) {
  .top-grid, .sim-grid, .output-grid { grid-template-columns: 1fr; }
}
</style>
