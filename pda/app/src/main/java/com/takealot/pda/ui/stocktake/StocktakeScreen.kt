package com.takealot.pda.ui.stocktake

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.takealot.pda.PdaApp
import com.takealot.pda.data.ErpException
import com.takealot.pda.data.PdaResumeWork
import com.takealot.pda.data.requireMatchingDetail
import com.takealot.pda.data.StocktakeLine
import com.takealot.pda.data.StocktakePlan
import com.takealot.pda.data.validateStocktakeWork
import com.takealot.pda.data.customerSkuForScan
import com.takealot.pda.data.stocktakeStatusLabel
import com.takealot.pda.data.requireUniqueScanSku
import com.takealot.pda.scan.ScanBus
import com.takealot.pda.scan.QueuedScan
import com.takealot.pda.scan.ScanDiagnostics
import com.takealot.pda.ui.components.BigButton
import com.takealot.pda.ui.components.DocumentCard
import com.takealot.pda.ui.components.Feedback
import com.takealot.pda.ui.components.FeedbackBar
import com.takealot.pda.ui.components.KeyValue
import com.takealot.pda.ui.components.QtyButton
import com.takealot.pda.ui.components.QuantityReductionDialog
import com.takealot.pda.ui.components.ScanField
import com.takealot.pda.ui.components.ScanQueueStatus
import com.takealot.pda.ui.components.ScanReceiptStatus
import com.takealot.pda.ui.components.SkuCard
import com.takealot.pda.ui.components.StatusChip
import com.takealot.pda.ui.i18n.tr
import com.takealot.pda.ui.theme.PdaAccent
import com.takealot.pda.ui.theme.PdaMuted
import com.takealot.pda.ui.theme.PdaOk
import com.takealot.pda.ui.theme.PdaStocktake
import com.takealot.pda.ui.theme.PdaText
import com.takealot.pda.ui.theme.PdaWarn
import kotlinx.coroutines.launch
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay

class StocktakeViewModel : ViewModel() {
    private val api get() = PdaApp.instance.api
    private val session get() = PdaApp.instance.session
    var scan by mutableStateOf("")
    var list by mutableStateOf<List<StocktakePlan>>(emptyList())
    var plan by mutableStateOf<StocktakePlan?>(null)
    private var refreshRequired = false
    var locationCode by mutableStateOf("")
    var selectedLineId by mutableStateOf<Int?>(null)
    var qty by mutableIntStateOf(1)
    var feedback by mutableStateOf<Feedback?>(null)
    var busy by mutableStateOf(false)
    var pendingScanCount by mutableIntStateOf(0)
    var lastReadCode by mutableStateOf("")
    var showReduction by mutableStateOf(false)
    val selectedLine: StocktakeLine? get() = plan?.lineList?.find { it.id == selectedLineId }
    private val scanQueue = Channel<Pair<QueuedScan, Int?>>(64)

    init {
        viewModelScope.launch {
            for ((queued, queuedOrderId) in scanQueue) {
                while (busy) delay(40)
                pendingScanCount = (pendingScanCount - 1).coerceAtLeast(0)
                if (queuedOrderId != plan?.id) {
                    feedback = Feedback(false, "单据已切换，上一单据排队的扫码未录入，请核对后重新扫描")
                    continue
                }
                val started = System.nanoTime()
                try { runScan(queued.code) } finally { ScanDiagnostics.recordScan(queued, started, "stocktake", "count") }
            }
        }
    }

    fun bind() {
        feedback = null
        scan = ""
        loadList()
        val resume = PdaApp.instance.workJournal.active("stocktake", "count") ?: return
        busy = true
        viewModelScope.launch {
            try {
                val detail = api.stocktake(resume.orderId)
                resume.requireMatchingDetail(detail.id, detail.warehouseCode, session.warehouseCode)
                if (retireClosedPlan(detail)) return@launch
                applyPlan(detail)
                feedback = Feedback(true, "已恢复 ${resume.orderNo} 的未完成作业")
            } catch (e: Exception) {
                feedback = Feedback(false, e.message ?: "恢复盘点失败，请返回首页重试，未完成作业已保留")
            } finally {
                busy = false
            }
        }
    }

    var listLoading by mutableStateOf(false)
        private set
    var listError by mutableStateOf<String?>(null)
        private set
    private var listRequest = 0

    fun loadList() {
        val request = ++listRequest
        val warehouse = session.warehouseCode
        val token = session.token
        fun current() = request == listRequest && warehouse == session.warehouseCode && token == session.token
        list = emptyList()
        listError = null
        listLoading = true
        viewModelScope.launch {
            try {
                if (warehouse.isBlank()) throw ErpException("请返回首页选择作业仓库")
                val result = api.stocktakes(warehouseCode = warehouse, status = "counting")
                if (current()) list = result
            } catch (e: Exception) {
                if (current()) listError = e.message ?: "加载盘点任务失败"
            } finally {
                if (request == listRequest) listLoading = false
            }
        }
    }

    fun onHardwareScan(code: String) { enqueueScan(code) }

    fun submitScan() {
        enqueueScan(scan)
    }

    private fun enqueueScan(raw: String) {
        if (blockStalePlan()) return
        if (showReduction) { feedback = Feedback(false, "请先完成减少数量或取消后再扫码"); return }
        val code = raw.trim()
        if (code.isEmpty()) return
        if (busy && plan == null) {
            feedback = Feedback(false, "正在读取单据，本次扫码未录入，请等单据打开后重新扫描")
            return
        }
        scan = ""
        pendingScanCount += 1
        if (!scanQueue.trySend(QueuedScan(code) to plan?.id).isSuccess) {
            pendingScanCount = (pendingScanCount - 1).coerceAtLeast(0)
            feedback = Feedback(false, "扫码队列已满，请稍后重试")
        } else lastReadCode = code
    }

    private fun StocktakeLine.requiresHandoff(): Boolean =
        statusKey == "recount" && firstCountedBy == session.userId

    private fun StocktakeLine.canCount(): Boolean = isOpen && !requiresHandoff()

    private suspend fun runScan(code: String) {
        busy = true
        feedback = Feedback(false, "正在处理 $code…", processing = true)
        val journal = PdaApp.instance.workJournal
        val recordId = journal.beginScan("stocktake", "count", code, plan?.id, plan?.no)
        try {
            if (plan == null) {
                openByCode(code)
                scan = ""
                journal.acknowledge(recordId, feedback?.message)
                return
            }
            val current = plan!!
            val normalized = code.trim()
            selectedLineId = null
            qty = 1
            val locationHit = current.lineList.firstOrNull { it.loc.equals(normalized, ignoreCase = true) }
            if (locationHit != null) {
                val openLine = current.lineList.firstOrNull { it.loc.equals(locationHit.loc, ignoreCase = true) && it.canCount() }
                if (openLine == null) {
                    locationCode = ""
                    val needsHandoff = current.lineList.any { it.loc.equals(locationHit.loc, ignoreCase = true) && it.requiresHandoff() }
                    feedback = Feedback(false, if (needsHandoff) "该库位剩余明细须交给另一名作业员复盘" else "库位 ${locationHit.loc} 已盘完，请扫描下一库位")
                    scan = ""
                    journal.acknowledge(recordId, feedback?.message)
                    return
                }
                locationCode = openLine.loc
                feedback = Feedback(true, "库位 ${locationHit.loc} 已确认，请扫描待盘点 SKU")
                scan = ""
                journal.acknowledge(recordId, feedback?.message)
                return
            }
            val skuHits = current.lineList.filter { it.matchesScan(normalized) }
            requireUniqueScanSku(skuHits.map { it.skuCode })
            if (locationCode.isBlank()) {
                val suggested = skuHits.firstOrNull()?.loc
                throw ErpException(if (suggested != null) "请先扫描库位 $suggested，再扫描 SKU" else "请先扫描盘点库位")
            }
            val skuHit = when {
                locationCode.isNotBlank() -> skuHits.firstOrNull { it.loc.equals(locationCode, ignoreCase = true) }
                else -> null
            } ?: throw ErpException("当前库位没有匹配的 SKU，请核对库位后重新扫描")
            if (!skuHit.canCount()) {
                throw ErpException(if (skuHit.requiresHandoff()) "此明细须由另一名作业员复盘，请交接后继续" else "该明细已盘完，请扫描下一 SKU")
            }
            selectedLineId = skuHit.id
            feedback = Feedback(true, "${customerSkuForScan(skuHit.skuCode)} · ${skuHit.loc}")
            scan = ""
            journal.acknowledge(recordId, feedback?.message)
        } catch (e: Exception) {
            feedback = Feedback(false, e.message ?: "扫描失败")
            if (journal.isRetriable(e)) journal.retainForRetry(recordId, feedback?.message)
            else journal.fail(recordId, feedback?.message)
        } finally {
            busy = false
        }
    }

    fun openPlan(id: Int) {
        if (busy || pendingScanCount > 0) return
        busy = true
        viewModelScope.launch {
            try {
                val detail = api.stocktake(id)
                if (retireClosedPlan(detail)) return@launch
                applyPlan(detail)
                feedback = Feedback(true, "${detail.no} 已打开，请扫描库位")
            } catch (e: Exception) {
                feedback = Feedback(false, e.message ?: "打开盘点单失败")
            } finally {
                busy = false
            }
        }
    }

    private fun retireClosedPlan(detail: StocktakePlan): Boolean {
        if (detail.warehouseCode != session.warehouseCode || session.warehouseCode.isBlank() ||
            detail.statusKey !in setOf("pending_approval", "completed", "cancelled")) return false
        val journal = PdaApp.instance.workJournal
        if (journal.active("stocktake", "count")?.orderId == detail.id) journal.clearActive("stocktake")
        if (plan?.id == detail.id) resetPlan()
        feedback = Feedback(true, "${detail.no} 当前为「${stocktakeStatusLabel(detail.statusKey)}」，请选择其他盘点单")
        loadList()
        return true
    }

    private fun applyPlan(detail: StocktakePlan) {
        validateStocktakeWork(detail, session.warehouseCode)
        refreshRequired = false
        plan = detail
        locationCode = ""
        selectedLineId = null
        qty = 1
        PdaApp.instance.workJournal.activate(PdaResumeWork("stocktake", "count", detail.id, detail.no))
    }

    private suspend fun openByCode(code: String) {
        val rows = api.stocktakes(
            warehouseCode = session.warehouseCode.ifBlank { null },
            status = "counting",
            stocktakeNo = code,
        )
        val hit = rows.firstOrNull { it.no.equals(code, ignoreCase = true) }
            ?: list.firstOrNull { it.no.equals(code, ignoreCase = true) }
            ?: throw ErpException("未找到盘点单 $code")
        applyPlan(api.stocktake(hit.id))
        feedback = Feedback(true, "${plan!!.no} 已打开")
    }

    private fun blockStalePlan(): Boolean {
        if (!refreshRequired) return false
        feedback = Feedback(false, "盘点进度已变化，请点击「刷新盘点单」，核对后重新扫描库位和 SKU")
        return true
    }

    fun submitCount() {
        if (blockStalePlan()) return
        if (busy || pendingScanCount > 0) { feedback = Feedback(false, "请等待扫码处理完成后再提交"); return }
        val current = plan ?: return
        if (PdaApp.instance.workJournal.pendingRecords().any {
                it.module == "stocktake" && it.orderId == current.id && it.mode == "count_submit"
            }) {
            feedback = Feedback(false, "本单有盘点结果待确认，请返回首页打开「待同步记录」，核对原请求后继续")
            return
        }
        try { validateStocktakeWork(current, session.warehouseCode) }
        catch (e: ErpException) { feedback = Feedback(false, e.message.orEmpty()); return }
        val line = selectedLine?.takeIf { locationCode.isNotBlank() && it.loc.equals(locationCode, ignoreCase = true) } ?: run {
            feedback = Feedback(false, "请先扫描库位，再扫描该库位的 SKU")
            return
        }
        if (!line.canCount()) {
            feedback = Feedback(false, if (line.requiresHandoff()) "此明细须由另一名作业员复盘，请交接后继续" else "该明细已盘完")
            return
        }
        val payload = mapOf("lineId" to line.id, "qty" to qty, "expectedStage" to line.statusKey)
        busy = true
        viewModelScope.launch {
            val journal = PdaApp.instance.workJournal
            val recordId = journal.beginScan("stocktake", "count_submit", line.skuCode, current.id, current.no)
            try {
                journal.preparePostRetry(recordId, "/management-loop/stocktakes/${current.id}/count", payload)
                plan = api.submitPrepared(recordId) { api.stocktakeCount(current.id, payload, recordId) }
                journal.acknowledge(recordId, "盘点提交成功")
                val refreshed = plan!!
                PdaApp.instance.workJournal.activate(PdaResumeWork("stocktake", "count", refreshed.id, refreshed.no))
                val next = refreshed.lineList.firstOrNull { it.id != line.id && it.loc.equals(locationCode, ignoreCase = true) && it.canCount() }
                selectedLineId = null
                if (refreshed.lineList.none { it.isOpen }) {
                    locationCode = ""
                    PdaApp.instance.workJournal.clearActive("stocktake")
                    feedback = Feedback(true, if (refreshed.statusKey == "pending_approval") "盘点完成，等待审批" else "本单已盘完")
                    loadList()
                } else if (next == null) {
                    locationCode = ""
                    qty = 1
                    feedback = if (refreshed.lineList.any { it.id == line.id && it.statusKey == "recount" }) {
                        Feedback(true, "初盘已保存，此明细须由另一名作业员复盘。可继续扫描其他库位")
                    } else {
                        Feedback(true, "盘点已保存，请扫描待盘点库位继续")
                    }
                } else {
                    qty = 1
                    feedback = Feedback(true, "${customerSkuForScan(line.skuCode)} 已提交；请扫描当前库位下一 SKU")
                }
            } catch (e: Exception) {
                if (e is ErpException && e.code == 409) {
                    refreshRequired = true
                    selectedLineId = null
                    qty = 1
                    blockStalePlan()
                } else {
                    feedback = Feedback(false, e.message ?: "提交失败")
                }
                if (journal.isRetriable(e)) journal.retainForRetry(recordId, feedback?.message) else journal.fail(recordId, feedback?.message)
            } finally {
                busy = false
            }
        }
    }

    fun reduceDraft(quantity: Int, reason: String) {
        val line = selectedLine ?: return
        val current = plan ?: return
        if (busy || pendingScanCount > 0 || !line.isOpen || quantity !in 1..qty || reason.trim().length < 2) return
        val journal = PdaApp.instance.workJournal
        val id = journal.beginScan("stocktake", "reduce_count", line.skuCode, current.id, current.no)
        qty -= quantity
        showReduction = false
        feedback = Feedback(true, "实盘数量已减少 $quantity 件，当前 $qty；提交后写入后台")
        journal.acknowledge(id, "${feedback?.message}；原因：${reason.trim()}")
    }

    fun clearPlan() {
        if (busy || pendingScanCount > 0) {
            feedback = Feedback(false, "请等待扫码和提交完成后再换单")
            return
        }
        resetPlan()
        feedback = null
        PdaApp.instance.workJournal.clearActive("stocktake")
        loadList()
    }

    private fun resetPlan() {
        refreshRequired = false
        lastReadCode = ""
        plan = null
        locationCode = ""
        selectedLineId = null
        scan = ""
        qty = 1
        showReduction = false
    }
}

@Composable
fun StocktakeScreen(onBack: () -> Unit, vm: StocktakeViewModel = viewModel()) {
    LaunchedEffect(Unit) { vm.bind() }
    LaunchedEffect(Unit) { ScanBus.codes.collect { vm.onHardwareScan(it) } }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(tr("stocktake"), color = PdaText, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
            TextButton(onClick = onBack) { Text(tr("back"), color = PdaAccent) }
        }
        ScanField(vm.scan, { vm.scan = it }, { vm.submitScan() }, when { vm.plan == null -> "扫描盘点单号"; vm.locationCode.isBlank() -> "先扫盘点库位"; else -> "扫当前库位 SKU" }, enabled = !vm.busy)
        ScanReceiptStatus(customerSkuForScan(vm.lastReadCode), vm.busy, vm.pendingScanCount)
        ScanQueueStatus(vm.pendingScanCount, vm.busy)
        FeedbackBar(vm.feedback)
        val plan = vm.plan
        if (plan == null) {
            Text("待作业", color = PdaMuted, fontSize = 13.sp)
            val listError = vm.listError
            if (vm.listLoading) {
                Text("正在读取盘点任务…", color = PdaMuted, fontSize = 13.sp)
            } else if (listError != null) {
                FeedbackBar(Feedback(false, listError))
                TextButton(onClick = { vm.loadList() }) { Text("重试加载盘点任务") }
            } else if (vm.list.isEmpty()) {
                Text("暂无盘点任务，可直接扫描盘点单号", color = PdaMuted, fontSize = 13.sp)
            }
            vm.list.forEach { row ->
                DocumentCard(
                    typeLabel = "盘点单",
                    number = row.no,
                    accent = PdaStocktake,
                    status = { StatusChip(stocktakeStatusLabel(row.statusKey), "warn") },
                    onClick = { vm.openPlan(row.id) },
                ) {
                    Text("${row.warehouseCode.orEmpty()} · ${row.scopeLabel.orEmpty().ifBlank { "全范围" }} · ${row.lineCount} 行", color = PdaMuted, fontSize = 12.sp)
                }
            }
        } else {
            DocumentCard(
                typeLabel = "盘点单",
                number = plan.no,
                accent = PdaStocktake,
                status = { StatusChip(stocktakeStatusLabel(plan.statusKey), if (plan.statusKey == "counting") "warn" else "ok") },
            ) {
                KeyValue("仓库", plan.warehouseCode.orEmpty())
                KeyValue("范围", plan.scopeLabel.orEmpty().ifBlank { "全范围" })
                KeyValue("待盘", "${plan.pendingCount} / ${plan.lineList.size}")
                if (plan.blindCount) Text("盲盘：不显示账面数量", color = PdaWarn, fontSize = 12.sp)
                TextButton(onClick = { vm.openPlan(plan.id) }, enabled = !vm.busy && vm.pendingScanCount == 0) {
                    Text("刷新盘点单", color = PdaAccent)
                }
                TextButton(onClick = { vm.clearPlan() }, enabled = !vm.busy && vm.pendingScanCount == 0) {
                    Text("换单", color = PdaAccent)
                }
            }
            if (vm.locationCode.isNotBlank()) Text("当前库位 ${vm.locationCode}", color = PdaStocktake, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            val visible = plan.lineList.filter { vm.locationCode.isBlank() || it.loc.equals(vm.locationCode, ignoreCase = true) }
            visible.forEach { line ->
                val progress = when {
                    line.statusKey == "recount" -> "复盘 ${line.firstQty ?: 0}"
                    line.countedQty != null -> "${line.countedQty}"
                    plan.blindCount -> "待盘"
                    else -> "账面 ${line.bookQty ?: 0}"
                }
                SkuCard(
                    sku = customerSkuForScan(line.skuCode),
                    progress = progress,
                    done = !line.isOpen,
                    selected = line.id == vm.selectedLineId,
                    onClick = {},
                ) {
                    Text("库位 ${line.loc}", color = PdaText, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                    if (!plan.blindCount) Text("账面 ${line.bookQty ?: 0}", color = PdaMuted, fontSize = 12.sp)
                    Text(stocktakeStatusLabel(line.statusKey), color = PdaMuted, fontSize = 12.sp)
                    if (line.statusKey == "recount") Text("复盘必须由不同于初盘的账号完成", color = PdaWarn, fontSize = 12.sp)
                }
            }
            if (vm.selectedLine?.isOpen == true && plan.statusKey == "counting") {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    QtyButton("−") { vm.qty = (vm.qty - 1).coerceAtLeast(0) }
                    Column(Modifier.weight(1.2f), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("实盘数量", color = PdaMuted, fontSize = 12.sp)
                        Text("${vm.qty}", color = PdaText, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
                    }
                    QtyButton("+") { vm.qty += 1 }
                }
                BigButton("提交实盘", onClick = { vm.submitCount() }, enabled = !vm.busy && vm.pendingScanCount == 0, color = PdaOk)
                TextButton(onClick = { vm.showReduction = true }, enabled = !vm.busy && vm.pendingScanCount == 0 && vm.qty > 0 && vm.selectedLine?.isOpen == true, modifier = Modifier.fillMaxWidth()) { Text("减少实盘数量", color = PdaWarn) }
            }
        }
    }
    if (vm.showReduction) QuantityReductionDialog(label = customerSkuForScan(vm.selectedLine?.skuCode.orEmpty()), current = vm.qty, busy = vm.busy, note = "修改本次尚未提交的实盘数量；已提交数量须由主管安排复盘。", onDismiss = { vm.showReduction = false }, onConfirm = { quantity, reason -> vm.reduceDraft(quantity, reason) })
}
