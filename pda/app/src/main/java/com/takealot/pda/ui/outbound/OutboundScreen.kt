package com.takealot.pda.ui.outbound

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.takealot.pda.PdaApp
import com.takealot.pda.data.ErpException
import com.takealot.pda.data.LocalPickLine
import com.takealot.pda.data.OutboundOrder
import com.takealot.pda.data.PdaPickProgress
import com.takealot.pda.data.PdaPickProgressLine
import com.takealot.pda.data.PdaResumeWork
import com.takealot.pda.data.outboundStatusLabel
import com.takealot.pda.data.pickTaskAtLocation
import com.takealot.pda.scan.ScanBus
import com.takealot.pda.ui.components.BigButton
import com.takealot.pda.ui.components.DocumentCard
import com.takealot.pda.ui.components.Feedback
import com.takealot.pda.ui.components.FeedbackBar
import com.takealot.pda.ui.components.KeyValue
import com.takealot.pda.ui.components.Panel
import com.takealot.pda.ui.components.ScanField
import com.takealot.pda.ui.components.ScanQueueStatus
import com.takealot.pda.ui.components.SkuCard
import com.takealot.pda.ui.components.StatusChip
import com.takealot.pda.ui.components.fieldColors
import com.takealot.pda.ui.theme.PdaAccent
import com.takealot.pda.ui.theme.PdaErr
import com.takealot.pda.ui.theme.PdaMuted
import com.takealot.pda.ui.theme.PdaOk
import com.takealot.pda.ui.theme.PdaOutbound
import com.takealot.pda.ui.theme.PdaSurface
import com.takealot.pda.ui.theme.PdaSurface2
import com.takealot.pda.ui.theme.PdaText
import com.takealot.pda.ui.theme.PdaWarn
import com.takealot.pda.ui.i18n.tr
import kotlinx.coroutines.launch
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay

data class OutboundCartonDraft(
    val lengthCm: String = "",
    val widthCm: String = "",
    val heightCm: String = "",
    val grossWeightKg: String = "",
) {
    fun valid() = listOf(lengthCm, widthCm, heightCm, grossWeightKg).all {
        (it.toDoubleOrNull() ?: 0.0) > 0.0
    }

    fun payload() = mapOf(
        "lengthCm" to lengthCm.toDouble(),
        "widthCm" to widthCm.toDouble(),
        "heightCm" to heightCm.toDouble(),
        "grossWeightKg" to grossWeightKg.toDouble(),
    )
}

class OutboundViewModel : ViewModel() {
    private val api get() = PdaApp.instance.api
    private val session get() = PdaApp.instance.session
    var mode by mutableStateOf("pick")
    var scan by mutableStateOf("")
    var list by mutableStateOf<List<OutboundOrder>>(emptyList())
    var order by mutableStateOf<OutboundOrder?>(null)
    var lines by mutableStateOf<List<LocalPickLine>>(emptyList())
    var locationSuggestions by mutableStateOf<Map<Int, List<String>>>(emptyMap())
    var selectedSku by mutableStateOf<String?>(null)
    private var scannedPickLocation: String? = null
    var pickScanMode by mutableStateOf("carton")
    var cartons by mutableStateOf(listOf(OutboundCartonDraft()))
    var trackingNo by mutableStateOf("")
    var carrier by mutableStateOf("")
    var logisticsProduct by mutableStateOf("")
    var feedback by mutableStateOf<Feedback?>(null)
    var lastRejectedScan by mutableStateOf<String?>(null)
    var busy by mutableStateOf(false)
    var pendingScanCount by androidx.compose.runtime.mutableIntStateOf(0)
    var showShortPickDialog by mutableStateOf(false)
    var shortPickReason by mutableStateOf("")
    var unknownScanCode by mutableStateOf<String?>(null)
    var unknownScanRemark by mutableStateOf("")
    private val scanQueue = Channel<String>(64)

    init {
        viewModelScope.launch {
            for (code in scanQueue) {
                pendingScanCount = (pendingScanCount - 1).coerceAtLeast(0)
                while (busy) delay(40)
                runScan(code)
            }
        }
    }

    fun bindMode(key: String) {
        mode = when (key) {
            "review" -> "review"
            "ship" -> "ship"
            else -> "pick"
        }
        pickScanMode = session.pickScanMode
        feedback = null; scan = ""; order = null; lines = emptyList()
        selectedSku = null; scannedPickLocation = null
        cartons = listOf(OutboundCartonDraft())
        trackingNo = ""; carrier = ""; logisticsProduct = ""
        loadList()
        val resume = PdaApp.instance.workJournal.active("outbound", mode) ?: return
        viewModelScope.launch {
            try {
                loadOrder(resume.orderId)
                feedback = Feedback(true, "已恢复 ${resume.orderNo} 的未完成作业")
            } catch (_: Exception) {
                PdaApp.instance.workJournal.clearActive("outbound")
            }
        }
    }

    fun loadList() {
        viewModelScope.launch {
            try {
                val statuses = when (mode) {
                    "pick" -> listOf("picking")
                    "review" -> listOf("picked", "reviewing")
                    else -> listOf("packed")
                }
                val rows = mutableListOf<OutboundOrder>()
                for (st in statuses) {
                    rows += api.outboundList(
                        status = st,
                        pickerId = if (mode == "pick") session.userId else null,
                        warehouseCode = session.warehouseCode.ifBlank { null },
                        pageSize = 50,
                    ).items.orEmpty()
                }
                list = rows.distinctBy { it.id }.filterNot { it.isProblem }
            } catch (e: Exception) { feedback = Feedback(false, e.message ?: "加载任务失败") }
        }
    }

    fun onHardwareScan(code: String) { enqueueScan(code) }
    fun submitScan() {
        enqueueScan(scan)
    }

    private fun enqueueScan(raw: String) {
        val code = raw.trim()
        if (code.isEmpty()) return
        scan = ""
        pendingScanCount += 1
        if (!scanQueue.trySend(code).isSuccess) {
            pendingScanCount = (pendingScanCount - 1).coerceAtLeast(0)
            lastRejectedScan = "未计数 · $code：扫码队列已满，请重新扫描"
            feedback = Feedback(false, lastRejectedScan!!)
        }
    }

    private suspend fun runScan(code: String) {
        busy = true; feedback = Feedback(false, "正在处理 $code…", processing = true)
        val journal = PdaApp.instance.workJournal
        val recordId = journal.beginScan("outbound", mode, code, order?.id, order?.no)
        var pickCountApplied = false
        try {
            if (order == null) { openByCode(code); journal.acknowledge(recordId, feedback?.message); return }
            if (mode == "ship") {
                throw ErpException("已绑定出库单，请点击确认发运")
            }
            if (mode == "review" && order?.statusKey != "reviewing") {
                throw ErpException("请先确认开始复核")
            }
            if (mode == "pick") {
                val normalized = code.trim().uppercase()
                val locationTask = lines.firstOrNull { !it.done && !it.taskKey.endsWith("@SHORT") && it.locationCode.uppercase() == normalized }
                if (locationTask != null) {
                    scannedPickLocation = locationTask.locationCode
                    selectedSku = locationTask.taskKey
                    feedback = Feedback(true, "库位 ${locationTask.locationCode}，请扫描本库位待拣 SKU")
                    saveProgress(); journal.acknowledge(recordId, feedback?.message); return
                }
                val selected = lines.pickTaskAtLocation(scannedPickLocation, code)
                if (selected != null) {
                    val nextQty = nextPickQty(selected.scannedQty, selected.qty)
                    val nextLines = lines.map { if (it.taskKey == selected.taskKey) it.copy(scannedQty = nextQty) else it }
                    saveProgress(nextLines, selected.taskKey)
                    lines = nextLines
                    selectedSku = selected.taskKey
                    pickCountApplied = true
                    val modeHint = if (pickScanMode == "carton") "按箱" else "逐件"
                    feedback = Feedback(true, "已计数 · $code\n$modeHint ${selected.locationCode} · ${selected.sku} $nextQty/${selected.qty}", pickCounted = true)
                    journal.acknowledge(recordId, feedback?.message); return
                }
                val skuTask = lines.firstOrNull { !it.done && !it.taskKey.endsWith("@SHORT") && it.matchesScan(code) }
                if (skuTask != null) {
                    throw ErpException("请先扫描库位 ${skuTask.locationCode}，再扫描 ${skuTask.sku}")
                }
                if (lines.any { !it.done && it.taskKey.endsWith("@SHORT") && it.matchesScan(code) }) {
                    throw ErpException("该 SKU 存在库存缺口，请点击「登记短拣」")
                }
                if (lines.any { it.matchesScan(code) }) {
                    throw ErpException("该 SKU 本单已拣完，请扫描下一件或提交拣货")
                }
            } else {
                val line = lines.firstOrNull { !it.done && it.matchesScan(code) }
                if (line != null) {
                    val nextQty = (line.scannedQty + 1).coerceAtMost(line.qty)
                    selectedSku = line.taskKey
                    lines = lines.map { if (it.taskKey == line.taskKey) it.copy(scannedQty = nextQty) else it }
                    feedback = Feedback(true, "${line.sku} $nextQty/${line.qty}")
                    saveProgress(); journal.acknowledge(recordId, feedback?.message); return
                }
                if (lines.any { it.matchesScan(code) }) {
                    throw ErpException("该 SKU 已复核完成，请扫描下一件")
                }
            }
            openByCode(code)
            journal.acknowledge(recordId, feedback?.message)
        } catch (e: Exception) {
            val message = e.message ?: "扫描失败"
            if (order != null && mode == "pick") {
                lastRejectedScan = if (pickCountApplied) "已计数 · $code：作业日志保存失败，请勿重复扫描；$message"
                    else "未计数 · $code：$message"
                feedback = Feedback(false, lastRejectedScan!!)
            } else feedback = Feedback(false, message)
            if (order != null && mode != "ship" && e.message.orEmpty().contains("未找到出库单")) {
                unknownScanCode = code
                unknownScanRemark = ""
            }
            if (journal.isRetriable(e)) journal.retainForRetry(recordId, feedback?.message)
            else journal.fail(recordId, feedback?.message)
        }
        finally { busy = false }
    }

    private suspend fun openByCode(code: String) {
        val page = api.outboundList(keyword = code, warehouseCode = session.warehouseCode.ifBlank { null }, pageSize = 20)
        val match = page.items.orEmpty().firstOrNull { it.no.equals(code, true) }
            ?: throw ErpException("未找到出库单 $code")
        if (mode == "pick") assertPickerAssigned(match)
        loadOrder(match.id)
    }

    fun openOrder(id: Int) {
        viewModelScope.launch {
            busy = true; feedback = null
            try { loadOrder(id) }
            catch (e: Exception) { feedback = Feedback(false, e.message ?: "打开单据失败"); order = null; lines = emptyList() }
            finally { busy = false }
        }
    }

    private suspend fun loadOrder(id: Int) {
        val detail = api.outboundDetail(id)
        if (session.warehouseCode.isBlank()) throw ErpException("请先在首页选择作业仓")
        if (!detail.warehouseCode.isNullOrBlank() && detail.warehouseCode != session.warehouseCode) {
            throw ErpException("该出库单属于 ${detail.warehouseCode}，当前作业仓为 ${session.warehouseCode}")
        }
        val nextOrder: OutboundOrder
        val nextLines: List<LocalPickLine>
        var shortageNotice: String? = null
        if (mode == "pick") {
            assertPickerAssigned(detail)
            if (detail.statusKey != "picking") throw ErpException("当前状态「${outboundStatusLabel(detail.statusKey)}」不可拣货")
            nextOrder = detail
            val suggestions = api.pickSuggestions(id).itemList
            val shortages = suggestions.filter { it.uncovered > 0 }
            if (shortages.isNotEmpty()) {
                shortageNotice = "库位库存不足：${shortages.joinToString("、") { "${it.sku} 缺 ${it.uncovered}" }}；可先拣有库存数量，再登记短拣"
            }
            locationSuggestions = suggestions.associate { row -> row.id to row.suggestions.orEmpty().mapNotNull { it.locationCode?.trim()?.uppercase() } }
            nextLines = suggestions.flatMap { row ->
                val allocated = row.suggestions.orEmpty().filter { it.pickQty > 0 }.map { allocation ->
                    val location = allocation.locationCode.orEmpty().trim().uppercase()
                    LocalPickLine(row.id, row.sku.orEmpty(), row.productName.orEmpty(), allocation.pickQty, location, 0, "${row.id}@$location", row.barcode.orEmpty(), row.platformBarcode.orEmpty())
                }
                val shortage = if (row.uncovered > 0) {
                    listOf(LocalPickLine(row.id, row.sku.orEmpty(), "${row.productName.orEmpty()}（库存不足）", row.uncovered, "库存不足", 0, "${row.id}@SHORT", row.barcode.orEmpty(), row.platformBarcode.orEmpty()))
                } else emptyList()
                allocated + shortage
            }
            if (nextLines.isEmpty()) throw ErpException("暂无可执行的库位拣货任务，请先完成上架")
        } else if (mode == "review") {
            nextOrder = when (detail.statusKey) {
                "picked" -> detail
                "reviewing" -> detail
                else -> throw ErpException("当前状态「${outboundStatusLabel(detail.statusKey)}」不可复核")
            }
            nextLines = nextOrder.itemList.map {
                LocalPickLine(it.id, it.sku.orEmpty(), it.productName.orEmpty(), if (it.pickedQty > 0) it.pickedQty else it.qty, it.locationCode.orEmpty(), 0, "review@${it.id}", it.barcode.orEmpty(), it.platformBarcode.orEmpty())
            }
        } else {
            if (detail.statusKey != "packed") throw ErpException("当前状态「${outboundStatusLabel(detail.statusKey)}」不可发运")
            nextOrder = detail
            nextLines = emptyList()
        }
        val saved = PdaApp.instance.workJournal.pickProgress(nextOrder.id, mode)
        order = nextOrder
        lines = nextLines.map { line ->
            saved?.lines?.firstOrNull { it.taskKey == line.taskKey || (it.taskKey.isNullOrBlank() && it.id == line.id) }?.let { progress ->
                line.copy(scannedQty = progress.scannedQty.coerceAtMost(line.qty), locationCode = progress.locationCode)
            } ?: line
        }
        // 每次打开/恢复任务都必须重新扫描实物库位，不能通过点选或历史选择绕过库位校验。
        selectedSku = null
        scannedPickLocation = null
        PdaApp.instance.workJournal.activate(PdaResumeWork("outbound", mode, nextOrder.id, nextOrder.no))
        shortageNotice?.let { feedback = Feedback(false, it) }
    }

    private fun assertPickerAssigned(order: OutboundOrder) {
        if (order.statusKey == "pending_pick" || order.pickerId == null) {
            throw ErpException("请先在电脑端分配拣货员，未分配不能扫")
        }
        if (order.pickerId != session.userId) {
            val who = order.pickerWorkstation.orEmpty().ifBlank { order.pickerName.orEmpty() }.ifBlank { "其他工位" }
            throw ErpException("该单已分配给 $who，不能扫")
        }
    }

    private fun nextPickQty(current: Int, target: Int): Int {
        if (target <= 0) return 0
        return if (pickScanMode == "carton") target else minOf(target, current + 1)
    }

    fun applyPickScanMode(mode: String) {
        pickScanMode = if (mode == "piece") "piece" else "carton"
        session.pickScanMode = pickScanMode
    }

    private fun saveProgress(progressLines: List<LocalPickLine> = lines, selectedTask: String? = selectedSku) {
        val current = order ?: return
        PdaApp.instance.workJournal.savePickProgress(
            PdaPickProgress(
                orderId = current.id,
                mode = mode,
                selectedSku = selectedTask,
                lines = progressLines.map { PdaPickProgressLine(it.id, it.scannedQty, it.locationCode, it.taskKey) },
            ),
        )
    }

    fun startReview() {
        val current = order ?: return
        if (mode != "review" || current.statusKey != "picked") return
        viewModelScope.launch {
            busy = true; feedback = null
            try {
                order = api.startReview(current.id)
                feedback = Feedback(true, "已开始复核，请逐件扫描 SKU 或条码")
                order?.let { PdaApp.instance.workJournal.activate(PdaResumeWork("outbound", mode, it.id, it.no)) }
            } catch (e: Exception) { feedback = Feedback(false, e.message ?: "开始复核失败") }
            finally { busy = false }
        }
    }

    fun submitPick() {
        val o = order ?: return
        if (lines.any { it.locationCode.isBlank() }) { feedback = Feedback(false, "存在未填库位的 SKU"); return }
        if (lines.any { !it.done }) { feedback = Feedback(false, "仍有未完成的库位任务；短拣请标记库存短缺异常"); return }
        viewModelScope.launch {
            busy = true
            val journal = PdaApp.instance.workJournal
            val recordId = journal.beginScan("outbound", "pick_submit", o.no, o.id, o.no)
            try {
                val items = lines.groupBy { it.id }.map { (itemId, tasks) ->
                    mapOf<String, Any?>(
                        "id" to itemId,
                        "allocations" to tasks.map { mapOf("locationCode" to it.locationCode, "qty" to it.qty) },
                    )
                }
                journal.preparePostRetry(recordId, "/outbound/${o.id}/pick", mapOf("pickSource" to "pda", "items" to items))
                api.pick(o.id, items, recordId)
                journal.acknowledge(recordId, "拣货提交成功")
                feedback = Feedback(true, "${o.no} 拣货完成；下一步：进入复核"); order = null; lines = emptyList(); PdaApp.instance.workJournal.clearPickProgress(o.id, mode); PdaApp.instance.workJournal.clearActive("outbound"); loadList()
            } catch (e: Exception) {
                feedback = Feedback(false, e.message ?: "拣货失败")
                if (journal.isRetriable(e)) journal.retainForRetry(recordId, feedback?.message) else journal.fail(recordId, feedback?.message)
            }
            finally { busy = false }
        }
    }

    fun submitReview() {
        val o = order ?: return
        if (lines.any { !it.done }) { feedback = Feedback(false, "请先扫完所有 SKU"); return }
        if (o.omsPreDeduct != null && (cartons.isEmpty() || cartons.any { !it.valid() })) {
            feedback = Feedback(false, "OMS 单请逐箱填写有效长宽高和毛重")
            return
        }
        viewModelScope.launch {
            busy = true
            val journal = PdaApp.instance.workJournal
            val recordId = journal.beginScan("outbound", "pack_submit", o.no, o.id, o.no)
            try {
                val cartonPayload = if (o.omsPreDeduct != null) cartons.map { it.payload() } else emptyList()
                journal.preparePostRetry(recordId, "/outbound/${o.id}/pack", mapOf("reviewSource" to "pda", "cartons" to cartonPayload))
                api.pack(o.id, cartonPayload, recordId)
                journal.acknowledge(recordId, "复核提交成功")
                feedback = Feedback(true, "${o.no} 复核完成；外箱实测与实际费用已回写")
                order = null; lines = emptyList(); cartons = listOf(OutboundCartonDraft())
                PdaApp.instance.workJournal.clearPickProgress(o.id, mode); PdaApp.instance.workJournal.clearActive("outbound"); loadList()
            }
            catch (e: Exception) {
                feedback = Feedback(false, e.message ?: "复核失败")
                if (journal.isRetriable(e)) journal.retainForRetry(recordId, feedback?.message) else journal.fail(recordId, feedback?.message)
            }
            finally { busy = false }
        }
    }

    fun submitShortPick() {
        val o = order ?: return
        val incomplete = lines.filter { !it.done }
        if (incomplete.isEmpty()) { feedback = Feedback(false, "当前没有短拣数量"); return }
        if (shortPickReason.trim().length < 2) { feedback = Feedback(false, "请填写短拣原因"); return }
        val summary = incomplete.joinToString("；") { "${it.sku}@${it.locationCode} 应拣${it.qty} 实拣${it.scannedQty} 缺${it.qty - it.scannedQty}" }
        reportProblem("stock_short", "$summary；原因：${shortPickReason.trim()}") {
            showShortPickDialog = false
            shortPickReason = ""
            list = list.filterNot { it.id == o.id }
            clearOrder()
        }
    }

    fun reportUnknownBarcode() {
        val code = unknownScanCode ?: return
        reportProblem("barcode_issue", "未知条码：$code${unknownScanRemark.trim().takeIf { it.isNotBlank() }?.let { "；$it" }.orEmpty()}") {
            unknownScanCode = null
            unknownScanRemark = ""
        }
    }

    private fun reportProblem(problemType: String, remark: String, onSuccess: () -> Unit) {
        val o = order ?: return
        viewModelScope.launch {
            busy = true
            val journal = PdaApp.instance.workJournal
            val recordId = journal.beginScan("outbound", "problem_$problemType", o.no, o.id, o.no)
            try {
                journal.preparePostRetry(recordId, "/outbound/${o.id}/problem", mapOf(
                    "markType" to "problem",
                    "problemType" to problemType,
                    "problemRemark" to remark,
                ))
                api.setOutboundProblem(o.id, problemType, remark, recordId)
                journal.acknowledge(recordId, "问题已登记")
                onSuccess()
                feedback = Feedback(true, "问题已登记并转交主管处理")
            } catch (e: Exception) {
                feedback = Feedback(false, e.message ?: "问题登记失败")
                if (journal.isRetriable(e)) journal.retainForRetry(recordId, feedback?.message) else journal.fail(recordId, feedback?.message)
            } finally { busy = false }
        }
    }

    fun updateCarton(index: Int, carton: OutboundCartonDraft) {
        cartons = cartons.mapIndexed { i, current -> if (i == index) carton else current }
    }

    fun addCarton() { cartons = cartons + OutboundCartonDraft() }

    fun removeCarton(index: Int) {
        if (cartons.size > 1) cartons = cartons.filterIndexed { i, _ -> i != index }
    }

    fun submitShip() {
        val o = order ?: return
        if (mode != "ship" || o.statusKey != "packed") return
        viewModelScope.launch {
            busy = true; feedback = null
            val journal = PdaApp.instance.workJournal
            val recordId = journal.beginScan("outbound", "ship_submit", o.no, o.id, o.no)
            try {
                journal.preparePostRetry(recordId, "/outbound/${o.id}/ship", mapOf(
                    "trackingNo" to trackingNo.trim(),
                    "carrier" to carrier.trim(),
                    "logisticsProduct" to logisticsProduct.trim(),
                ))
                api.ship(o.id, trackingNo, carrier, logisticsProduct, recordId)
                journal.acknowledge(recordId, "发运提交成功")
                feedback = Feedback(true, "${o.no} 已发运；库存、OMS 状态和实际费用已同步")
                order = null; trackingNo = ""; carrier = ""; logisticsProduct = ""; loadList()
            } catch (e: Exception) {
                feedback = Feedback(false, e.message ?: "发运失败")
                if (journal.isRetriable(e)) journal.retainForRetry(recordId, feedback?.message) else journal.fail(recordId, feedback?.message)
            } finally { busy = false }
        }
    }

    fun clearOrder() { order?.let { PdaApp.instance.workJournal.clearPickProgress(it.id, mode) }; order = null; lines = emptyList(); selectedSku = null; scannedPickLocation = null; scan = ""; unknownScanCode = null; PdaApp.instance.workJournal.clearActive("outbound") }
}

@Composable
fun OutboundScreen(modeKey: String, onBack: () -> Unit, vm: OutboundViewModel = viewModel()) {
    LaunchedEffect(modeKey) { vm.bindMode(modeKey) }
    LaunchedEffect(Unit) { ScanBus.codes.collect { vm.onHardwareScan(it) } }
    val title = when (vm.mode) {
        "pick" -> tr("pick")
        "review" -> tr("review")
        else -> tr("ship")
    }
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(title, color = PdaText, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
            TextButton(onClick = onBack) { Text(tr("back"), color = PdaAccent) }
        }
        val reviewAwaitingStart = vm.mode == "review" && vm.order?.statusKey == "picked"
        val scanLabel = when {
            vm.order == null -> tr("scan_outbound")
            vm.mode == "pick" -> tr("scan_sku_location")
            vm.mode == "review" -> tr("scan_sku")
            else -> tr("scan_outbound")
        }
        ScanField(
            vm.scan,
            { vm.scan = it },
            { vm.submitScan() },
            scanLabel,
            enabled = !reviewAwaitingStart && (vm.mode != "ship" || vm.order == null),
            autoFocus = vm.unknownScanCode == null && !vm.showShortPickDialog,
            focusNonce = listOf(vm.order?.id, vm.unknownScanCode, vm.showShortPickDialog, reviewAwaitingStart),
        )
        ScanQueueStatus(vm.pendingScanCount, vm.busy)
        FeedbackBar(vm.feedback)
        vm.lastRejectedScan?.let { rejected ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(rejected, color = PdaErr, fontSize = 13.sp, modifier = Modifier.weight(1f))
                TextButton(onClick = { vm.lastRejectedScan = null }) { Text("知道了") }
            }
        }
        if (vm.mode == "pick") Text("设备滴声仅表示解码；以「已计数」和数量变化确认拣货", color = PdaWarn, fontSize = 12.sp)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            val order = vm.order
            if (order == null) {
                Text("待作业", color = PdaMuted, fontSize = 13.sp)
                if (vm.list.isEmpty()) Text(
                    if (vm.mode == "pick") "没有分配给你的拣货任务，请先在电脑端分配拣货员" else "暂无任务，可直接扫描出库单号",
                    color = PdaMuted,
                    fontSize = 13.sp,
                )
                vm.list.forEach { row ->
                    DocumentCard(
                        typeLabel = when (vm.mode) { "pick" -> "拣货单"; "review" -> "复核单"; else -> "发运单" },
                        number = row.no,
                        accent = PdaOutbound,
                        status = { StatusChip(outboundStatusLabel(row.statusKey), "warn") },
                        onClick = { vm.openOrder(row.id) },
                    ) {
                        Text("${row.customerName.orEmpty()} · ${row.skuSummary.orEmpty().ifBlank { "${row.totalQty} 件" }}", color = PdaMuted, fontSize = 12.sp)
                    }
                }
            } else {
                DocumentCard(
                    typeLabel = when (vm.mode) { "pick" -> "拣货单"; "review" -> "复核单"; else -> "发运单" },
                    number = order.no,
                    accent = PdaOutbound,
                    status = { StatusChip(outboundStatusLabel(order.statusKey), "warn") },
                ) {
                    KeyValue("客户", order.customerName.orEmpty())
                    KeyValue("仓库", order.warehouseCode.orEmpty())
                    TextButton(onClick = { vm.clearOrder() }) { Text("换单", color = PdaAccent) }
                }
                if (reviewAwaitingStart) {
                    Text("该单已拣货。确认实物与单据一致后，再开始复核；开始后会记录复核人。", color = PdaWarn, fontSize = 13.sp)
                    BigButton("开始复核", onClick = { vm.startReview() }, enabled = !vm.busy, color = PdaWarn)
                }
                if (vm.mode == "pick") {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        TextButton(
                            onClick = { vm.applyPickScanMode("carton") },
                            modifier = Modifier.weight(1f).background(
                                if (vm.pickScanMode == "carton") PdaAccent.copy(alpha = 0.25f) else PdaSurface2,
                                RoundedCornerShape(8.dp),
                            ),
                        ) { Text("按箱扫", color = if (vm.pickScanMode == "carton") PdaAccent else PdaMuted) }
                        TextButton(
                            onClick = { vm.applyPickScanMode("piece") },
                            modifier = Modifier.weight(1f).background(
                                if (vm.pickScanMode == "piece") PdaAccent.copy(alpha = 0.25f) else PdaSurface2,
                                RoundedCornerShape(8.dp),
                            ),
                        ) { Text("逐件扫", color = if (vm.pickScanMode == "piece") PdaAccent else PdaMuted) }
                    }
                    Text(
                        if (vm.pickScanMode == "carton") "扫一次 SKU 记本库位剩余件数，不必逐件" else "每扫一次 SKU +1",
                        color = PdaMuted,
                        fontSize = 12.sp,
                    )
                }
                if (vm.mode != "ship") {
                    Text("SKU 明细", color = PdaOutbound, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                    vm.lines.forEach { line ->
                        SkuCard(
                            sku = line.sku,
                            bound990 = line.bound990,
                            progress = "${line.scannedQty}/${line.qty}",
                            done = line.done,
                            selected = line.taskKey == vm.selectedSku,
                            onClick = {},
                        ) {
                            Text(line.productName, color = PdaMuted, fontSize = 12.sp)
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Text("拣货库位", color = PdaMuted, fontSize = 11.sp)
                                Text(line.locationCode.ifBlank { "未填" }, color = PdaText, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                            }
                            if (vm.mode == "pick") Text(
                                if (vm.pickScanMode == "carton") "先扫库位，再扫 SKU 或已绑 990；按箱一次记满 ${line.qty}" else "先扫库位，再扫 SKU 或已绑 990；逐件扫满 ${line.qty}",
                                color = PdaAccent,
                                fontSize = 12.sp,
                            )
                            else Text("逐件扫描 SKU 或已绑 990，扫满 ${line.qty} 件", color = PdaAccent, fontSize = 12.sp)
                        }
                    }
                }
                if (vm.mode == "review" && order.omsPreDeduct != null) {
                    OutboundCartonMeasureEditor(vm)
                }
                when (vm.mode) {
                    "pick" -> {
                        BigButton("提交拣货", onClick = { vm.submitPick() }, enabled = !vm.busy && vm.lines.isNotEmpty() && vm.lines.all { it.done }, color = PdaOk)
                        if (vm.lines.any { !it.done }) {
                            BigButton("登记短拣", onClick = { vm.showShortPickDialog = true }, enabled = !vm.busy, color = PdaWarn)
                        }
                    }
                    "review" -> BigButton("提交复核并计算费用", onClick = { vm.submitReview() }, enabled = !vm.busy && !reviewAwaitingStart && vm.lines.isNotEmpty(), color = PdaOk)
                    else -> {
                        Panel {
                            Text("物流信息（可选）", color = PdaOutbound, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                            OutlinedTextField(
                                value = vm.trackingNo,
                                onValueChange = { vm.trackingNo = it },
                                label = { Text("跟踪号") },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                                colors = fieldColors(),
                            )
                            OutlinedTextField(
                                value = vm.carrier,
                                onValueChange = { vm.carrier = it },
                                label = { Text("承运商") },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                                colors = fieldColors(),
                            )
                            OutlinedTextField(
                                value = vm.logisticsProduct,
                                onValueChange = { vm.logisticsProduct = it },
                                label = { Text("物流产品") },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                                colors = fieldColors(),
                            )
                        }
                        Text("确认后将扣减仓库库存，并向 OMS 回传已发运状态和实际费用。", color = PdaWarn, fontSize = 13.sp)
                        BigButton("确认发运", onClick = { vm.submitShip() }, enabled = !vm.busy, color = PdaOk)
                    }
                }
            }
        }
    }
    if (vm.showShortPickDialog) ShortPickDialog(vm)
    if (vm.unknownScanCode != null) OutboundUnknownBarcodeDialog(vm)
}

@Composable
private fun ShortPickDialog(vm: OutboundViewModel) {
    val incomplete = vm.lines.filter { !it.done }
    AlertDialog(
        onDismissRequest = { if (!vm.busy) vm.showShortPickDialog = false },
        title = { Text("登记短拣") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                incomplete.forEach { line ->
                    Text("${line.sku} · ${line.locationCode} · 应拣 ${line.qty} / 实拣 ${line.scannedQty} / 缺 ${line.qty - line.scannedQty}", color = PdaWarn, fontSize = 13.sp)
                }
                OutlinedTextField(
                    value = vm.shortPickReason,
                    onValueChange = { vm.shortPickReason = it },
                    label = { Text("原因：库位空、实物不足、破损等") },
                    minLines = 2,
                    modifier = Modifier.fillMaxWidth(),
                    colors = fieldColors(),
                )
                Text("登记后不会扣库存或完成拣货，该单将从当前任务列表隐藏，等待主管处理。", color = PdaMuted, fontSize = 12.sp)
            }
        },
        confirmButton = { TextButton(enabled = !vm.busy && vm.shortPickReason.trim().length >= 2, onClick = { vm.submitShortPick() }) { Text("确认短拣", color = PdaWarn) } },
        dismissButton = { TextButton(onClick = { vm.showShortPickDialog = false }) { Text("继续查找") } },
    )
}

@Composable
private fun OutboundUnknownBarcodeDialog(vm: OutboundViewModel) {
    AlertDialog(
        onDismissRequest = { if (!vm.busy) vm.unknownScanCode = null },
        title = { Text("未知条码") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("${vm.unknownScanCode.orEmpty()} 不属于当前出库任务。请把实物放到异常区，或登记条码问题。", color = PdaWarn, fontSize = 14.sp)
                OutlinedTextField(
                    value = vm.unknownScanRemark,
                    onValueChange = { vm.unknownScanRemark = it },
                    label = { Text("备注（可选）") },
                    modifier = Modifier.fillMaxWidth(),
                    colors = fieldColors(),
                )
            }
        },
        confirmButton = { TextButton(enabled = !vm.busy, onClick = { vm.reportUnknownBarcode() }) { Text("登记条码异常", color = PdaWarn) } },
        dismissButton = { TextButton(onClick = { vm.unknownScanCode = null }) { Text("返回继续作业") } },
    )
}

@Composable
private fun OutboundCartonMeasureEditor(vm: OutboundViewModel) {
    Panel {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Column {
                Text("外箱实测", color = PdaOutbound, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                Text("用于按体积重/实重计算实际出库费用", color = PdaMuted, fontSize = 12.sp)
            }
            TextButton(onClick = { vm.addCarton() }) { Text("+ 新增箱", color = PdaAccent) }
        }
        vm.cartons.forEachIndexed { index, carton ->
            Column(
                Modifier.fillMaxWidth().background(PdaSurface2, RoundedCornerShape(8.dp)).padding(10.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("第 ${index + 1} 箱", color = PdaText, fontWeight = FontWeight.SemiBold)
                    if (vm.cartons.size > 1) {
                        TextButton(onClick = { vm.removeCarton(index) }) { Text("删除", color = PdaWarn) }
                    }
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    CartonNumberField("长(cm)", carton.lengthCm, Modifier.weight(1f)) {
                        vm.updateCarton(index, carton.copy(lengthCm = it))
                    }
                    CartonNumberField("宽(cm)", carton.widthCm, Modifier.weight(1f)) {
                        vm.updateCarton(index, carton.copy(widthCm = it))
                    }
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    CartonNumberField("高(cm)", carton.heightCm, Modifier.weight(1f)) {
                        vm.updateCarton(index, carton.copy(heightCm = it))
                    }
                    CartonNumberField("毛重(kg)", carton.grossWeightKg, Modifier.weight(1f)) {
                        vm.updateCarton(index, carton.copy(grossWeightKg = it))
                    }
                }
            }
        }
    }
}

@Composable
private fun CartonNumberField(
    label: String,
    value: String,
    modifier: Modifier,
    onValueChange: (String) -> Unit,
) {
    OutlinedTextField(
        value = value,
        onValueChange = { raw -> onValueChange(raw.filter { it.isDigit() || it == '.' }) },
        label = { Text(label) },
        singleLine = true,
        modifier = modifier,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
        colors = fieldColors(),
    )
}
