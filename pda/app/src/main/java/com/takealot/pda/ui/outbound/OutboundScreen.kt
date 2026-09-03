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
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
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
import com.takealot.pda.scan.ScanBus
import com.takealot.pda.ui.components.BigButton
import com.takealot.pda.ui.components.DocumentCard
import com.takealot.pda.ui.components.Feedback
import com.takealot.pda.ui.components.FeedbackBar
import com.takealot.pda.ui.components.KeyValue
import com.takealot.pda.ui.components.Panel
import com.takealot.pda.ui.components.ScanField
import com.takealot.pda.ui.components.SkuCard
import com.takealot.pda.ui.components.StatusChip
import com.takealot.pda.ui.theme.PdaAccent
import com.takealot.pda.ui.theme.PdaMuted
import com.takealot.pda.ui.theme.PdaOk
import com.takealot.pda.ui.theme.PdaOutbound
import com.takealot.pda.ui.theme.PdaSurface
import com.takealot.pda.ui.theme.PdaSurface2
import com.takealot.pda.ui.theme.PdaText
import com.takealot.pda.ui.theme.PdaWarn
import com.takealot.pda.ui.i18n.tr
import kotlinx.coroutines.launch

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
    var pickScanMode by mutableStateOf("carton")
    var feedback by mutableStateOf<Feedback?>(null)
    var busy by mutableStateOf(false)

    fun bindMode(key: String) {
        mode = if (key == "review") "review" else "pick"
        pickScanMode = session.pickScanMode
        feedback = null; scan = ""; order = null; lines = emptyList(); loadList()
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
                val statuses = if (mode == "pick") listOf("picking") else listOf("picked", "reviewing")
                val rows = mutableListOf<OutboundOrder>()
                for (st in statuses) {
                    rows += api.outboundList(
                        status = st,
                        pickerId = if (mode == "pick") session.userId else null,
                        warehouseCode = session.warehouseCode.ifBlank { null },
                        pageSize = 50,
                    ).items.orEmpty()
                }
                list = rows.distinctBy { it.id }
            } catch (e: Exception) { feedback = Feedback(false, e.message ?: "加载任务失败") }
        }
    }

    fun onHardwareScan(code: String) { scan = code; submitScan() }
    fun submitScan() {
        val code = scan.trim(); if (code.isEmpty() || busy) return
        viewModelScope.launch { runScan(code) }
    }

    private suspend fun runScan(code: String) {
        busy = true; feedback = null
        val journal = PdaApp.instance.workJournal
        val recordId = journal.beginScan("outbound", mode, code, order?.id, order?.no)
        try {
            if (order == null) { openByCode(code); scan = ""; journal.acknowledge(recordId, feedback?.message); return }
            if (mode == "review" && order?.statusKey != "reviewing") {
                throw ErpException("请先确认开始复核")
            }
            if (mode == "pick") {
                val normalized = code.trim().uppercase()
                val locationTask = lines.firstOrNull { !it.done && it.locationCode.uppercase() == normalized }
                if (locationTask != null) {
                    selectedSku = locationTask.taskKey
                    feedback = Feedback(true, "库位 ${locationTask.locationCode}，请扫 ${locationTask.sku}")
                    scan = ""; saveProgress(); journal.acknowledge(recordId, feedback?.message); return
                }
                val selected = lines.firstOrNull { it.taskKey == selectedSku }
                if (selected != null && selected.matchesScan(code)) {
                    val nextQty = nextPickQty(selected.scannedQty, selected.qty)
                    lines = lines.map { if (it.taskKey == selected.taskKey) it.copy(scannedQty = nextQty) else it }
                    val modeHint = if (pickScanMode == "carton") "按箱" else "逐件"
                    feedback = Feedback(true, "$modeHint ${selected.locationCode} · ${selected.sku} $nextQty/${selected.qty}")
                    scan = ""; saveProgress(); journal.acknowledge(recordId, feedback?.message); return
                }
                val skuTask = lines.firstOrNull { !it.done && it.matchesScan(code) }
                if (skuTask != null) {
                    throw ErpException("请先扫描库位 ${skuTask.locationCode}，再扫描 ${skuTask.sku}")
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
                    scan = ""; saveProgress(); journal.acknowledge(recordId, feedback?.message); return
                }
                if (lines.any { it.matchesScan(code) }) {
                    throw ErpException("该 SKU 已复核完成，请扫描下一件")
                }
            }
            openByCode(code); scan = ""
            journal.acknowledge(recordId, feedback?.message)
        } catch (e: Exception) {
            feedback = Feedback(false, e.message ?: "扫描失败")
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
        if (mode == "pick") {
            assertPickerAssigned(detail)
            if (detail.statusKey != "picking") throw ErpException("当前状态「${outboundStatusLabel(detail.statusKey)}」不可拣货")
            nextOrder = detail
            val suggestions = api.pickSuggestions(id).itemList
            val shortages = suggestions.filter { it.uncovered > 0 }
            if (shortages.isNotEmpty()) {
                throw ErpException("库位库存不足：${shortages.joinToString("、") { "${it.sku} 缺 ${it.uncovered}" }}；请标记库存短缺异常")
            }
            locationSuggestions = suggestions.associate { row -> row.id to row.suggestions.orEmpty().mapNotNull { it.locationCode?.trim()?.uppercase() } }
            nextLines = suggestions.flatMap { row ->
                row.suggestions.orEmpty().filter { it.pickQty > 0 }.map { allocation ->
                    val location = allocation.locationCode.orEmpty().trim().uppercase()
                    LocalPickLine(row.id, row.sku.orEmpty(), row.productName.orEmpty(), allocation.pickQty, location, 0, "${row.id}@$location", row.barcode.orEmpty())
                }
            }
            if (nextLines.isEmpty()) throw ErpException("暂无可执行的库位拣货任务，请先完成上架")
        } else {
            nextOrder = when (detail.statusKey) {
                "picked" -> detail
                "reviewing" -> detail
                else -> throw ErpException("当前状态「${outboundStatusLabel(detail.statusKey)}」不可复核")
            }
            if (nextOrder.omsPreDeduct != null) feedback = Feedback(false, "OMS 单需在电脑端录入外箱尺寸后再复核")
            nextLines = nextOrder.itemList.map {
                LocalPickLine(it.id, it.sku.orEmpty(), it.productName.orEmpty(), if (it.pickedQty > 0) it.pickedQty else it.qty, it.locationCode.orEmpty(), 0, "review@${it.id}", it.barcode.orEmpty())
            }
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
        PdaApp.instance.workJournal.activate(PdaResumeWork("outbound", mode, nextOrder.id, nextOrder.no))
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

    fun setPickScanMode(mode: String) {
        pickScanMode = if (mode == "piece") "piece" else "carton"
        session.pickScanMode = pickScanMode
    }

    private fun saveProgress() {
        val current = order ?: return
        PdaApp.instance.workJournal.savePickProgress(
            PdaPickProgress(
                orderId = current.id,
                mode = mode,
                selectedSku = selectedSku,
                lines = lines.map { PdaPickProgressLine(it.id, it.scannedQty, it.locationCode, it.taskKey) },
            ),
        )
    }

    fun startReview() {
        val current = order ?: return
        if (mode != "review" || current.statusKey != "picked") return
        if (current.omsPreDeduct != null) {
            feedback = Feedback(false, "OMS 单需先在电脑端录入外箱尺寸，不能开始复核")
            return
        }
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
            try {
                val items = lines.groupBy { it.id }.map { (itemId, tasks) ->
                    mapOf<String, Any?>(
                        "id" to itemId,
                        "allocations" to tasks.map { mapOf("locationCode" to it.locationCode, "qty" to it.qty) },
                    )
                }
                api.pick(o.id, items)
                feedback = Feedback(true, "${o.no} 拣货完成；下一步：进入复核"); order = null; lines = emptyList(); PdaApp.instance.workJournal.clearPickProgress(o.id, mode); PdaApp.instance.workJournal.clearActive("outbound"); loadList()
            } catch (e: Exception) { feedback = Feedback(false, e.message ?: "拣货失败") }
            finally { busy = false }
        }
    }

    fun submitReview() {
        val o = order ?: return
        if (o.omsPreDeduct != null) { feedback = Feedback(false, "OMS 单请在电脑端录入外箱尺寸"); return }
        if (lines.any { !it.done }) { feedback = Feedback(false, "请先扫完所有 SKU"); return }
        viewModelScope.launch {
            busy = true
            try { api.pack(o.id); feedback = Feedback(true, "${o.no} 复核完成；可扫描下一单"); order = null; lines = emptyList(); PdaApp.instance.workJournal.clearPickProgress(o.id, mode); PdaApp.instance.workJournal.clearActive("outbound"); loadList() }
            catch (e: Exception) { feedback = Feedback(false, e.message ?: "复核失败") }
            finally { busy = false }
        }
    }

    fun clearOrder() { order?.let { PdaApp.instance.workJournal.clearPickProgress(it.id, mode) }; order = null; lines = emptyList(); selectedSku = null; scan = ""; PdaApp.instance.workJournal.clearActive("outbound") }
}

@Composable
fun OutboundScreen(modeKey: String, onBack: () -> Unit, vm: OutboundViewModel = viewModel()) {
    LaunchedEffect(modeKey) { vm.bindMode(modeKey) }
    LaunchedEffect(Unit) { ScanBus.codes.collect { vm.onHardwareScan(it) } }
    val title = if (vm.mode == "pick") tr("pick") else tr("review")
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(title, color = PdaText, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
            TextButton(onClick = onBack) { Text(tr("back"), color = PdaAccent) }
        }
        val reviewAwaitingStart = vm.mode == "review" && vm.order?.statusKey == "picked"
        ScanField(vm.scan, { vm.scan = it }, { vm.submitScan() }, if (vm.order == null) tr("scan_outbound") else if (vm.mode == "pick") tr("scan_sku_location") else tr("scan_sku"), enabled = !vm.busy && !reviewAwaitingStart)
        FeedbackBar(vm.feedback)
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
                    typeLabel = if (vm.mode == "pick") "拣货单" else "复核单",
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
                typeLabel = if (vm.mode == "pick") "拣货单" else "复核单",
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
                        onClick = { vm.setPickScanMode("carton") },
                        modifier = Modifier.weight(1f).background(
                            if (vm.pickScanMode == "carton") PdaAccent.copy(alpha = 0.25f) else PdaSurface2,
                            RoundedCornerShape(8.dp),
                        ),
                    ) { Text("按箱扫", color = if (vm.pickScanMode == "carton") PdaAccent else PdaMuted) }
                    TextButton(
                        onClick = { vm.setPickScanMode("piece") },
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
            Text("SKU 明细", color = PdaOutbound, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            vm.lines.forEach { line ->
                SkuCard(
                    sku = line.sku,
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
                        if (vm.pickScanMode == "carton") "先扫库位，再扫 SKU；按箱一次记满 ${line.qty}" else "先扫库位，再扫 SKU；逐件扫满 ${line.qty}",
                        color = PdaAccent,
                        fontSize = 12.sp,
                    )
                    else Text("逐件扫描 SKU 或条码，扫满 ${line.qty} 件", color = PdaAccent, fontSize = 12.sp)
                }
            }
            if (vm.mode == "pick") BigButton("提交拣货", onClick = { vm.submitPick() }, enabled = !vm.busy && vm.lines.isNotEmpty(), color = PdaOk)
            else BigButton("提交复核", onClick = { vm.submitReview() }, enabled = !vm.busy && !reviewAwaitingStart && vm.lines.isNotEmpty(), color = PdaOk)
        }
    }
}
