<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import { storeMonitorApi } from '@/api/client.js'
import { getAccessToken } from '@/auth/tokenStore'

const frameRef = ref<HTMLIFrameElement | null>(null)
const session = ref<any>(null)
const stores = ref<any[]>([])
const loading = ref(true)
const refreshing = ref(false)
const frameReady = ref(false)
const frameKey = ref(0)
const configOpen = ref(false)
const assignOpen = ref(false)
const savingSlot = ref<number | null>(null)
const testingSlot = ref<number | null>(null)
const bootstrapBusy = ref(false)
const editKeys = ref<Record<number, string>>({})
const storeNameEdits = ref<Record<number, string>>({})
const enabledEdits = ref<Record<number, boolean>>({})
const coachEdits = ref<Record<number, string>>({})
const diag = ref<any>(null)
const serviceState = ref<'checking' | 'online' | 'degraded' | 'offline'>('checking')

const iframeSrc = computed(() => `/takealot-monitor/?erp=1&reload=${frameKey.value}`)
const canManage = computed(() => !!session.value?.canManage)
const canAssignCoach = computed(() => !!session.value?.canAssignCoach)
const configuredCount = computed(() => stores.value.filter(row => row.configured).length)
const enabledCount = computed(() => stores.value.filter(row => row.enabled && row.configured).length)
const channelCount = computed(() =>
  Object.values(diag.value?.channels || {}).filter((channel: any) => channel?.ok).length,
)
const serviceLabel = computed(() => ({
  checking: '正在检测',
  online: '代理在线',
  degraded: '部分通道可用',
  offline: '代理离线',
})[serviceState.value])

async function checkService() {
  serviceState.value = 'checking'
  try {
    const result = await storeMonitorApi.diag()
    diag.value = result
    const channels = Object.values(result?.channels || {})
    const available = channels.filter((channel: any) => channel?.ok).length
    serviceState.value = available > 0
      ? available === channels.length ? 'online' : 'degraded'
      : 'degraded'
  } catch {
    diag.value = null
    serviceState.value = 'offline'
  }
}

async function loadSession() {
  loading.value = true
  try {
    const [sess, list] = await Promise.all([
      storeMonitorApi.session(),
      storeMonitorApi.listStores(),
    ])
    session.value = sess
    stores.value = list || []
    list?.forEach((row: any) => {
      coachEdits.value[row.slot] = row.coachRole
      storeNameEdits.value[row.slot] = row.storeName
      enabledEdits.value[row.slot] = row.enabled
    })
  } catch (e: any) {
    ElMessage.error(e.message || '加载店铺监控失败')
  } finally {
    loading.value = false
  }
  await checkService()
}

function cloneForPostMessage<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null))
}

function injectIframeSession() {
  const frame = frameRef.value
  if (!frame?.contentWindow || !session.value) return
  const token = getAccessToken()
  const payload = {
    type: 'erp-auth',
    token,
    session: cloneForPostMessage(session.value),
  }
  try {
    frame.contentWindow.postMessage(payload, window.location.origin)
  } catch (error: any) {
    ElMessage.error(error?.message || '店铺看板会话注入失败')
  }
}

function onFrameLoad() {
  frameReady.value = true
  setTimeout(injectIframeSession, 50)
  setTimeout(injectIframeSession, 300)
}

function onMonitorMessage(event: MessageEvent) {
  if (event.origin !== window.location.origin || event.source !== frameRef.value?.contentWindow) return
  if (event.data?.type === 'erp-monitor-ready') injectIframeSession()
}

onMounted(() => window.addEventListener('message', onMonitorMessage))
onUnmounted(() => window.removeEventListener('message', onMonitorMessage))

async function saveStoreKey(row: any) {
  const apiKey = (editKeys.value[row.slot] || '').trim()
  if (!row.configured && !apiKey) {
    ElMessage.warning('请先粘贴 Takealot API Key')
    return
  }
  if (apiKey && apiKey.length < 16) {
    ElMessage.warning('API Key 过短，请粘贴 Takealot 后台生成的完整密钥，不要把店铺名填进密钥框')
    return
  }
  savingSlot.value = row.slot
  try {
    await storeMonitorApi.updateStore(row.slot, {
      ...(apiKey ? { apiKey } : {}),
      storeName: (storeNameEdits.value[row.slot] || row.storeName).trim(),
      enabled: enabledEdits.value[row.slot],
    })
    ElMessage.success(`店铺 ${row.slot} 配置已保存`)
    editKeys.value[row.slot] = ''
    await loadSession()
    injectIframeSession()
  } catch (e: any) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    savingSlot.value = null
  }
}

async function refreshMonitor() {
  refreshing.value = true
  frameReady.value = false
  try {
    await loadSession()
    frameKey.value += 1
  } finally {
    refreshing.value = false
  }
}

async function runBrowserBootstrap() {
  bootstrapBusy.value = true
  try {
    const result = await storeMonitorApi.browserBootstrap()
    ElMessage({
      type: result?.ok ? 'success' : 'warning',
      message: result?.message || (result?.ok ? '浏览器通道验证成功' : '浏览器通道验证未完成'),
    })
    await checkService()
  } catch (error: any) {
    ElMessage.error(error?.message || '浏览器通道验证失败')
  } finally {
    bootstrapBusy.value = false
  }
}

async function saveCoachAssign(row: any) {
  const coachRole = coachEdits.value[row.slot]
  if (!coachRole) {
    ElMessage.warning('请选择陪跑')
    return
  }
  savingSlot.value = row.slot
  try {
    await storeMonitorApi.updateStore(row.slot, { coachRole })
    ElMessage.success(`店铺 ${row.slot} 已分配给${coachRole === 'coach1' ? '陪跑1' : '陪跑2'}`)
    await loadSession()
    injectIframeSession()
  } catch (e: any) {
    ElMessage.error(e.message || '分配失败')
  } finally {
    savingSlot.value = null
  }
}

async function testStoreConnection(row: any) {
  if (!row.configured) {
    ElMessage.warning('请先保存 API Key，再测试连接')
    return
  }
  testingSlot.value = row.slot
  try {
    const result = await storeMonitorApi.checkStore(row.slot)
    ElMessage.success(
      result?.displayName
        ? `连接成功：${result.displayName}`
        : `店铺 ${row.slot} 连接成功`,
    )
    await loadSession()
  } catch (error: any) {
    ElMessage.error(error?.message || `店铺 ${row.slot} 连接失败`)
  } finally {
    testingSlot.value = null
  }
}

onMounted(loadSession)
</script>

<template>
  <div class="store-monitor-page">
    <header class="monitor-command">
      <div class="command-title">
        <span class="command-mark" aria-hidden="true"><i /></span>
        <div>
          <p class="command-kicker">TAKEALOT OPERATIONS</p>
          <h1>店铺监控</h1>
          <p>集中查看店铺表现、履约状态与接口连接情况</p>
        </div>
      </div>

      <div class="command-metrics" aria-label="店铺监控状态">
        <div class="metric">
          <span>可见店铺</span>
          <strong>{{ stores.length }}</strong>
        </div>
        <div class="metric">
          <span>已接入</span>
          <strong>{{ configuredCount }}</strong>
        </div>
        <div class="metric">
          <span>运行中</span>
          <strong>{{ enabledCount }}</strong>
        </div>
        <div class="metric metric--status">
          <span>接口状态</span>
          <strong :class="`is-${serviceState}`">
            <i class="status-dot" />
            {{ serviceLabel }}
          </strong>
        </div>
      </div>

      <div class="command-actions">
        <el-button :loading="refreshing" @click="refreshMonitor">刷新数据</el-button>
        <el-button v-if="canAssignCoach" @click="assignOpen = true">分配陪跑</el-button>
        <el-button v-if="canManage" type="primary" @click="configOpen = true">配置店铺</el-button>
      </div>
    </header>

    <div v-if="serviceState === 'degraded'" class="setup-callout setup-callout--warn">
      <div>
        <strong>Takealot 接口通道不可用（{{ channelCount }}/3）</strong>
        <span>
          服务器访问 Takealot 常被 Cloudflare 拦截；生产 Docker 内也没有 Chrome 转发通道。
          建议在<strong>本机 Windows</strong>运行 <code>store-monitor/启动.bat</code>（需 Chrome）做本地监控；
          或换南非/欧美 VPN 后点击「修复浏览器通道」。
        </span>
      </div>
      <el-button type="primary" plain @click="checkService">重新检测</el-button>
    </div>

    <div v-else-if="serviceState === 'offline'" class="setup-callout">
      <div>
        <strong>Takealot 代理未启动（127.0.0.1:3456）</strong>
        <span>店铺看板依赖本机 Chrome 通道。请运行仓库根目录 dev-local.ps1，或单独启动 store-monitor。</span>
      </div>
      <el-button type="primary" plain @click="checkService">重新检测</el-button>
    </div>

    <div v-if="canManage && !loading && configuredCount === 0" class="setup-callout">
      <div>
        <strong>还没有接入店铺</strong>
        <span>配置 Takealot API Key 后，监控数据才会开始同步。</span>
      </div>
      <el-button type="primary" plain @click="configOpen = true">立即配置</el-button>
    </div>

    <section class="monitor-shell">
      <div class="monitor-bar">
        <div class="monitor-bar__title">
          <span class="live-indicator" :class="`is-${serviceState}`" />
          <span>实时经营看板</span>
          <small v-if="diag">连接通道 {{ channelCount }}/3</small>
        </div>
        <div class="monitor-bar__actions">
          <button type="button" @click="checkService">重新检测接口</button>
          <button v-if="canManage" type="button" :disabled="bootstrapBusy" @click="runBrowserBootstrap">
            {{ bootstrapBusy ? '验证中…' : '修复浏览器通道' }}
          </button>
        </div>
      </div>

      <div class="monitor-stage">
        <div v-if="loading || !frameReady" class="frame-loading">
          <span class="loading-orbit" />
          <strong>{{ loading ? '正在读取店铺权限' : '正在启动经营看板' }}</strong>
          <small>连接店铺数据与本地代理服务</small>
        </div>
        <iframe
          v-if="!loading && session"
          :key="frameKey"
          ref="frameRef"
          class="monitor-frame"
          :src="iframeSrc"
          title="Takealot 店铺监控"
          @load="onFrameLoad"
        />
      </div>
    </section>

    <el-dialog v-model="assignOpen" title="分配陪跑店铺" width="680px" destroy-on-close>
      <p class="dialog-hint">
        每个店铺只归属一个陪跑账号。保存后，对应陪跑重新进入页面即可看到店铺。
      </p>
      <el-table :data="stores" size="small" border stripe max-height="400">
        <el-table-column prop="slot" label="槽位" width="64" align="center" />
        <el-table-column prop="storeName" label="店铺名" min-width="150" />
        <el-table-column label="分配给" width="140">
          <template #default="{ row }">
            <el-select v-model="coachEdits[row.slot]" size="small" style="width: 100%">
              <el-option label="陪跑1" value="coach1" />
              <el-option label="陪跑2" value="coach2" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column prop="coachLabel" label="当前归属" width="100" />
        <el-table-column label="操作" width="88" align="center">
          <template #default="{ row }">
            <el-button
              type="primary"
              link
              size="small"
              :loading="savingSlot === row.slot"
              @click="saveCoachAssign(row)"
            >保存</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-dialog>

    <el-dialog v-model="configOpen" title="店铺接入配置" width="880px" destroy-on-close>
      <p class="dialog-hint">API Key 仅在本次输入时可见；留空表示保留当前密钥。关闭店铺后将暂停其数据请求。</p>
      <el-table :data="stores" size="small" border stripe max-height="440">
        <el-table-column prop="slot" label="槽位" width="64" align="center" />
        <el-table-column label="店铺名" min-width="140">
          <template #default="{ row }">
            <el-input
              v-model="storeNameEdits[row.slot]"
              size="small"
              maxlength="40"
              autocomplete="off"
              placeholder="店铺备注名"
            />
          </template>
        </el-table-column>
        <el-table-column prop="coachLabel" label="陪跑" width="82" />
        <el-table-column label="API Key" min-width="220">
          <template #default="{ row }">
            <el-input
              v-model="editKeys[row.slot]"
              type="password"
              :placeholder="row.configured ? row.apiKeyMasked : '粘贴 Takealot API Key'"
              size="small"
              show-password
              autocomplete="new-password"
              name="takealot-api-key"
            />
          </template>
        </el-table-column>
        <el-table-column label="启用" width="72" align="center">
          <template #default="{ row }">
            <el-switch v-model="enabledEdits[row.slot]" />
          </template>
        </el-table-column>
        <el-table-column label="接入状态" width="92" align="center">
          <template #default="{ row }">
            <el-tag :type="row.configured ? 'success' : 'info'" size="small">
              {{ row.configured ? '已配置' : '未配置' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="128" align="center">
          <template #default="{ row }">
            <el-button
              link
              size="small"
              :loading="testingSlot === row.slot"
              @click="testStoreConnection(row)"
            >测试</el-button>
            <el-button
              type="primary"
              link
              size="small"
              :loading="savingSlot === row.slot"
              @click="saveStoreKey(row)"
            >保存</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-dialog>
  </div>
</template>

<style scoped>
.store-monitor-page {
  height: calc(100vh - 68px - 36px);
  min-height: 620px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: -4px 0 0;
}

.monitor-command {
  display: flex;
  align-items: center;
  gap: 24px;
  flex-shrink: 0;
  padding: 18px 20px;
  color: #f8fbff;
  background: linear-gradient(120deg, #0c1d35 0%, #122b49 58%, #143957 100%);
  border: 1px solid #274966;
  border-radius: 18px;
  box-shadow: var(--shadow-panel);
}

.command-title {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 280px;
}

.command-mark {
  position: relative;
  display: grid;
  width: 46px;
  height: 46px;
  flex: 0 0 46px;
  place-items: center;
  border: 1px solid #3d6888;
  border-radius: 50%;
}

.command-mark::before,
.command-mark::after,
.command-mark i {
  content: '';
  position: absolute;
  border-radius: 50%;
}

.command-mark::before {
  inset: 8px;
  border: 1px solid #2e7892;
}

.command-mark::after {
  width: 8px;
  height: 8px;
  background: #47d7bd;
  box-shadow: 0 0 0 4px #1b5061;
}

.command-mark i {
  width: 21px;
  height: 1px;
  background: #47d7bd;
  transform: rotate(-38deg);
  transform-origin: left center;
}

.command-title h1 {
  margin: 1px 0 3px;
  font-size: 22px;
  line-height: 1.1;
  letter-spacing: .02em;
}

.command-title p {
  margin: 0;
  color: #9eb5c9;
  font-size: 12px;
}

.command-title .command-kicker {
  color: #47d7bd;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 9px;
  letter-spacing: .18em;
}

.command-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(84px, 1fr));
  flex: 1;
  max-width: 520px;
  border: 1px solid #294762;
  border-radius: 12px;
  overflow: hidden;
}

.metric {
  display: flex;
  min-height: 54px;
  flex-direction: column;
  justify-content: center;
  gap: 3px;
  padding: 8px 13px;
  background: #102640;
  border-right: 1px solid #294762;
}

.metric:last-child { border-right: 0; }
.metric span { color: #8fa8bd; font-size: 10px; }
.metric strong { font-size: 19px; font-variant-numeric: tabular-nums; }

.metric--status strong {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #b8c9d8;
  font-size: 12px;
  white-space: nowrap;
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #96a8b8;
}

.metric strong.is-online,
.metric strong.is-degraded { color: #72e0cb; }
.is-online .status-dot,
.is-degraded .status-dot { background: #47d7bd; }
.metric strong.is-offline { color: #ff9a9a; }
.is-offline .status-dot { background: #ff7373; }

.command-actions {
  display: flex;
  gap: 8px;
  margin-left: auto;
}
.setup-callout {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px;
  flex-shrink: 0;
  background: #fff8e7;
  border: 1px solid #f0c96c;
  border-radius: 12px;
  color: #6f5011;
}

.setup-callout div { display: flex; gap: 10px; align-items: baseline; }
.setup-callout span { color: #89691e; font-size: 12px; }
.setup-callout--warn {
  background: #fff1f0;
  border-color: #ffccc7;
  color: #a8071a;
}
.setup-callout--warn span { color: #cf1322; }
.setup-callout code {
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.06);
  font-size: 11px;
}

.monitor-shell {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
  background: var(--panel-solid);
  border: 1px solid var(--border);
  border-radius: 16px;
  box-shadow: var(--shadow-panel);
}

.monitor-bar {
  display: flex;
  min-height: 42px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 14px;
  flex-shrink: 0;
  background: var(--panel-solid);
  border-bottom: 1px solid var(--border);
}

.monitor-bar__title {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text);
  font-size: 12px;
  font-weight: 650;
}

.monitor-bar__title small {
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 400;
}

.live-indicator {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #9aa6b2;
}

.live-indicator.is-online,
.live-indicator.is-degraded { background: #17b897; }
.live-indicator.is-offline { background: #e45656; }

.monitor-bar__actions { display: flex; gap: 14px; }
.monitor-bar__actions button {
  padding: 0;
  color: var(--text-muted);
  background: none;
  border: 0;
  cursor: pointer;
  font: inherit;
  font-size: 11px;
}
.monitor-bar__actions button:hover { color: var(--primary-bright); }
.monitor-bar__actions button:disabled { cursor: wait; opacity: .55; }

.dialog-hint {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.5;
}

.monitor-stage {
  position: relative;
  display: flex;
  min-height: 0;
  flex: 1;
  background: var(--panel-solid);
}

.frame-loading {
  position: absolute;
  z-index: 2;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 7px;
  background: var(--panel-solid);
  color: var(--text);
}

.frame-loading small { color: var(--text-muted); }

.loading-orbit {
  width: 28px;
  height: 28px;
  margin-bottom: 4px;
  border: 2px solid var(--border);
  border-top-color: var(--primary-bright);
  border-radius: 50%;
  animation: orbit .8s linear infinite;
}

@keyframes orbit {
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .loading-orbit { animation: none; }
}

.monitor-frame {
  flex: 1;
  width: 100%;
  border: none;
  background: var(--panel-solid);
  min-height: 0;
  pointer-events: auto;
}

@media (max-width: 1180px) {
  .store-monitor-page {
    height: auto;
    min-height: calc(100vh - 104px);
    overflow: visible;
  }

  .monitor-command { flex-wrap: wrap; }

  .command-metrics {
    order: 3;
    width: 100%;
    max-width: none;
    flex-basis: 100%;
  }

  .monitor-shell { min-height: 650px; }
}

@media (max-width: 720px) {
  .monitor-command {
    align-items: flex-start;
    padding: 16px;
  }

  .command-title { min-width: 0; }

  .command-actions {
    width: 100%;
    margin-left: 0;
    flex-wrap: wrap;
  }

  .command-metrics { grid-template-columns: repeat(2, 1fr); }
  .metric:nth-child(2) { border-right: 0; }
  .metric:nth-child(-n + 2) { border-bottom: 1px solid #294762; }

  .setup-callout,
  .setup-callout div {
    align-items: flex-start;
    flex-direction: column;
  }

  .monitor-bar__title small { display: none; }
}
</style>
