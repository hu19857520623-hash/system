package com.takealot.pda.ui.inbound

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.takealot.pda.PdaApp
import com.takealot.pda.data.ErpException
import com.takealot.pda.data.InboundItem
import com.takealot.pda.data.InboundOrder
import com.takealot.pda.data.PdaResumeWork
import com.takealot.pda.scan.ScanCodeClassifier
import com.takealot.pda.scan.ScanBus
import com.takealot.pda.ui.components.BigButton
import com.takealot.pda.ui.components.DocumentCard
import com.takealot.pda.ui.components.Feedback
import com.takealot.pda.ui.components.FeedbackBar
import com.takealot.pda.ui.components.KeyValue
import com.takealot.pda.ui.components.Panel
import com.takealot.pda.ui.components.QtyButton
import com.takealot.pda.ui.components.ScanField
import com.takealot.pda.ui.components.ScanQueueStatus
import com.takealot.pda.ui.components.SkuCard
import com.takealot.pda.ui.components.StatusChip
import com.takealot.pda.ui.components.fieldColors
import com.takealot.pda.ui.theme.PdaAccent
import com.takealot.pda.ui.theme.PdaInbound
import com.takealot.pda.ui.theme.PdaMuted
import com.takealot.pda.ui.theme.PdaOk
import com.takealot.pda.ui.theme.PdaSurface2
import com.takealot.pda.ui.theme.PdaText
import com.takealot.pda.ui.theme.PdaWarn
import com.takealot.pda.ui.i18n.tr
import kotlinx.coroutines.launch
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay

enum class InboundMode(val key: String, val title: String, val scanLabel: String) {
    Arrival("arrival", "到仓扫描", "扫入库单号"),
    Receive("receive", "确认箱数", "扫箱唛或 SKU"),
    Qc("qc", "清点", "扫 SKU / 已绑 990"),
    Putaway("putaway", "上架", "扫 SKU / 已绑 990 或库位");
    companion object { fun from(key: String) = entries.find { it.key == key } ?: Arrival }
}

class InboundViewModel : ViewModel() {
    private val api get() = PdaApp.instance.api
    private val session get() = PdaApp.instance.session
    var mode by mutableStateOf(InboundMode.Arrival)
    var scan by mutableStateOf("")
    var cartonCount by mutableIntStateOf(1)
    var qcIncrement by mutableIntStateOf(1)
    var order by mutableStateOf<InboundOrder?>(null)
    var feedback by mutableStateOf<Feedback?>(null)
    var busy by mutableStateOf(false)
    var pendingScanCount by mutableIntStateOf(0)
    var selectedItemId by mutableStateOf<Int?>(null)
    var locationCode by mutableStateOf("")
    var putawayQty by mutableIntStateOf(1)
    var lengthCm by mutableStateOf("")
    var widthCm by mutableStateOf("")
    var heightCm by mutableStateOf("")
    var weightKg by mutableStateOf("")
    var acceptDiff by mutableStateOf(false)
    var exceptionReason by mutableStateOf("")
    var showExceptionRelease by mutableStateOf(false)
    var showCartonDifference by mutableStateOf(false)
    var cartonDifferenceReason by mutableStateOf("")
    var unknownScanCode by mutableStateOf<String?>(null)
    var unknownScanRemark by mutableStateOf("")
    var qcIssueItemId by mutableStateOf<Int?>(null)
    var qcIssueType by mutableStateOf("short")
    var qcIssueQty by mutableStateOf("")
    var qcIssueRemark by mutableStateOf("")
    var pendingOrders by mutableStateOf<List<InboundOrder>>(emptyList())
    var putawayDoneNo by mutableStateOf<String?>(null)
    val selectedItem: InboundItem? get() = order?.itemList?.find { it.id == selectedItemId }
    val scannedCartonCount: Int
        get() = order?.cartonList?.count { it.status == "received" } ?: 0
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

    private fun applyOrder(detail: InboundOrder?) {
        order = detail
        if (detail != null) {
            cartonCount = maxOf(
                1,
                detail.receivedCartonCount ?: 0,
                detail.cartonList.count { it.status == "received" },
            )
        }
    }

    fun bindMode(key: String) {
        mode = InboundMode.from(key); feedback = null; scan = ""
        if (mode == InboundMode.Putaway) loadPendingPutaway()
        val resume = PdaApp.instance.workJournal.active("inbound", mode.key) ?: return
        viewModelScope.launch {
            try {
                applyOrder(api.inboundDetail(resume.orderId))
                feedback = Feedback(true, "已恢复 ${resume.orderNo} 的未完成作业")
            } catch (_: Exception) {
                PdaApp.instance.workJournal.clearActive("inbound")
            }
        }
    }

    fun loadPendingPutaway() {
        viewModelScope.launch {
            try {
                val page = api.inboundList(status = "pending_putaway", pageSize = 100)
                val wh = session.warehouseCode
                pendingOrders = page.items.orEmpty()
                    .filter { row -> row.warehouseCode.isNullOrBlank() || row.warehouseCode == wh }
                    .distinctBy { it.id }
            } catch (e: Exception) {
                if (order == null) feedback = Feedback(false, e.message ?: "加载待上架单据失败")
            }
        }
    }

    fun openPendingOrder(id: Int) {
        viewModelScope.launch {
            busy = true; feedback = null
            try { bindPutawayOrder(api.inboundDetail(id)) }
            catch (e: Exception) { feedback = Feedback(false, e.message ?: "打开单据失败") }
            finally { busy = false }
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
            feedback = Feedback(false, "扫码队列已满，请稍后重试")
        }
    }

    private suspend fun runScan(code: String) {
        busy = true; feedback = Feedback(false, "正在处理 $code…", processing = true)
        val journal = PdaApp.instance.workJournal
        val recordId = journal.beginScan("inbound", mode.key, code, order?.id, order?.no)
        try {
            when (mode) {
                InboundMode.Arrival -> doArrival(code, recordId)
                InboundMode.Receive -> doReceiveScan(code, recordId)
                InboundMode.Qc -> doQcScan(code, recordId)
                InboundMode.Putaway -> handlePutawayScan(code, recordId)
            }
            journal.acknowledge(recordId, feedback?.message)
        } catch (e: Exception) {
            feedback = Feedback(false, e.message ?: "操作失败")
            if (order != null && mode != InboundMode.Arrival && (
                    e.message.orEmpty().contains("不属于入库单") ||
                    e.message.orEmpty().contains("未匹配")
                )) {
                unknownScanCode = code
                unknownScanRemark = ""
            }
            if (journal.isRetriable(e)) journal.retainForRetry(recordId, feedback?.message)
            else journal.fail(recordId, feedback?.message)
        } finally { busy = false }
    }

    private suspend fun doArrival(code: String, recordId: String) {
        val wh = session.warehouseCode
        if (wh.isBlank()) throw ErpException("请先在首页选择作业仓库")
        PdaApp.instance.workJournal.prepareRetry(recordId, "arrival", extra = wh)
        val res = api.arrivalScan(code, wh)
        applyOrder(res.order)
        scan = ""
        if (order?.id != null) refreshOrder()
        enterReceiveAfterArrival(
            res.message.orEmpty().ifBlank { if (res.alreadyScanned) "已到仓" else "到仓成功" },
        )
    }

    private fun enterReceiveAfterArrival(arrivalMessage: String) {
        val current = order ?: return
        val canReceive = session.hasPerm("inbound.receive")
        val canQc = session.hasPerm("inbound.qc")
        if (!canReceive && !canQc) {
            current.let { PdaApp.instance.workJournal.activate(PdaResumeWork("inbound", mode.key, it.id, it.no)) }
            feedback = Feedback(true, arrivalMessage)
            return
        }
        mode = InboundMode.Receive
        PdaApp.instance.workJournal.activate(PdaResumeWork("inbound", InboundMode.Receive.key, current.id, current.no))
        val next = when {
            canReceive && canQc -> "请扫箱唛确认箱数，也可直接扫 SKU 清点"
            canReceive -> "请扫箱唛确认箱数"
            else -> "请扫 SKU 清点"
        }
        feedback = Feedback(true, "$arrivalMessage，已进入确认箱数。$next")
    }

    private suspend fun doReceiveScan(code: String, recordId: String) {
        if (order == null) {
            ensureOrder(code) ?: return
            scan = ""
            return
        }
        if (matchesCurrentSku(code)) {
            applySkuScan(code, recordId)
            return
        }
        try {
            PdaApp.instance.workJournal.prepareRetry(recordId, "receive_box")
            val res = api.receiveBox(order!!.id, code, recordId)
            feedback = Feedback(true, res.message.orEmpty().ifBlank { "箱唛已确认，可继续扫箱唛或 SKU" })
            refreshOrder(); scan = ""
        } catch (e: Exception) {
            val msg = e.message.orEmpty()
            if (msg.contains("已确认") || msg.contains("请先在「到仓扫描」")) throw e
            applySkuScan(code, recordId)
        }
    }

    private suspend fun doQcScan(code: String, recordId: String) {
        val guess = ScanCodeClassifier.classify(code).typeKey
        if (order == null) {
            if (guess == "inbound_no" || guess == "carton") {
                ensureOrder(code) ?: return
                scan = ""
                feedback = Feedback(true, "已绑定 ${order?.no.orEmpty()}，请扫 SKU 或条码清点")
                return
            }
            throw ErpException("请先扫描入库单号绑定作业单，再扫 SKU")
        }
        if (guess == "inbound_no") {
            scan = ""
            throw ErpException("这是入库单号，清点请扫该 SKU / 条码 / 已绑 990")
        }
        if (guess == "carton") {
            scan = ""
            throw ErpException("清点请扫 SKU；箱唛请在「确认箱数」扫描")
        }
        applySkuScan(code, recordId)
    }

    private fun matchesCurrentSku(code: String): Boolean =
        order?.itemList?.any { it.matchesScan(code) } == true

    private suspend fun applySkuScan(code: String, recordId: String) {
        if (!session.hasPerm("inbound.qc")) {
            throw ErpException("扫 SKU 需要清点权限，请用仓库账号或在电脑端开通「入库 · 清点」")
        }
        PdaApp.instance.workJournal.prepareRetry(recordId, "scan_qc", quantity = qcIncrement)
        val res = api.scanQc(order!!.id, code, qcIncrement, recordId)
        if (res.itemId > 0) selectedItemId = res.itemId
        val sku = res.sku.orEmpty().ifBlank { code }
        feedback = Feedback(
            true,
            res.message.orEmpty().ifBlank { "$sku +${res.increment}（实收 ${res.actualQty}/${res.expectedQty}）" },
        )
        refreshOrder(); scan = ""
    }

    private fun enterQcAfterReceive(prefix: String) {
        if (!session.hasPerm("inbound.qc")) return
        val current = order ?: return
        mode = InboundMode.Qc
        PdaApp.instance.workJournal.activate(PdaResumeWork("inbound", InboundMode.Qc.key, current.id, current.no))
        val text = prefix.trim().ifBlank { "箱数已确认" }
        feedback = Feedback(true, "$text，已进入清点。请继续扫 SKU")
    }

    private suspend fun ensureOrder(code: String, allowedStatuses: Set<String>? = null, replace: Boolean = false): InboundOrder? {
        if (order != null && !replace) return order
        val page = api.inboundList(keyword = code, pageSize = 20)
        val match = page.items.orEmpty().firstOrNull { row ->
            listOfNotNull(row.inboundNo, row.warehouseNo, row.trackingNo).any { it.equals(code, true) }
        }
        if (match == null) { feedback = Feedback(false, "未找到精确匹配的入库单 $code，请核对单号/仓单号/跟踪号"); return null }
        val detail = api.inboundDetail(match.id)
        if (!detail.warehouseCode.isNullOrBlank() && detail.warehouseCode != session.warehouseCode) {
            throw ErpException("该入库单属于 ${detail.warehouseCode}，当前作业仓为 ${session.warehouseCode}")
        }
        if (allowedStatuses != null && detail.statusKey !in allowedStatuses) {
            throw ErpException("当前状态「${detail.statusText}」不可上架，请选择待上架单据")
        }
        applyOrder(detail)
        PdaApp.instance.workJournal.activate(PdaResumeWork("inbound", mode.key, detail.id, detail.no))
        return order
    }

    private suspend fun bindPutawayOrder(detail: InboundOrder) {
        if (session.warehouseCode.isBlank()) throw ErpException("请先在首页选择作业仓库")
        if (!detail.warehouseCode.isNullOrBlank() && detail.warehouseCode != session.warehouseCode) {
            throw ErpException("该入库单属于 ${detail.warehouseCode}，当前作业仓为 ${session.warehouseCode}")
        }
        if (detail.statusKey != "pending_putaway" && detail.statusKey != "exception") {
            throw ErpException("当前状态「${detail.statusText}」不可上架，仅待上架单据可进入")
        }
        applyOrder(detail)
        val first = detail.itemList.firstOrNull {
            (it.actualQty ?: 0) > 0 && it.remainingPutaway > 0
        }
        selectedItemId = first?.id
        putawayQty = first?.remainingPutaway?.coerceAtLeast(1) ?: 1
        locationCode = ""
        PdaApp.instance.workJournal.activate(PdaResumeWork("inbound", mode.key, detail.id, detail.no))
        feedback = Feedback(true, "已进入 ${detail.no}，请扫 SKU，再扫库位")
    }

    private suspend fun handlePutawayScan(code: String, recordId: String) {
        val guess = ScanCodeClassifier.classify(code).typeKey
        if (order == null || guess == "inbound_no") {
            if (order == null && (guess == "sku" || guess == "barcode" || guess == "location")) {
                throw ErpException("请先扫描或点选待上架入库单")
            }
            val bound = ensureOrder(code, setOf("pending_putaway"), replace = true) ?: return
            bindPutawayOrder(bound)
            scan = ""
            return
        }
        val current = order ?: return
        val skuHit = current.itemList.find { it.matchesScan(code) }
        if (skuHit != null) {
            if ((skuHit.actualQty ?: 0) <= 0) {
                feedback = Feedback(false, "${skuHit.skuCode} 清点实收为 0，不可上架")
                scan = ""; return
            }
            if (skuHit.remainingPutaway <= 0) {
                feedback = Feedback(false, "${skuHit.skuCode} 已上架完成，请扫下一件 SKU")
                scan = ""; return
            }
            selectedItemId = skuHit.id
            putawayQty = skuHit.remainingPutaway.coerceAtLeast(1)
            locationCode = ""
            lengthCm = skuHit.lengthCm?.takeIf { it > 0 }?.toString().orEmpty()
            widthCm = skuHit.widthCm?.takeIf { it > 0 }?.toString().orEmpty()
            heightCm = skuHit.heightCm?.takeIf { it > 0 }?.toString().orEmpty()
            weightKg = skuHit.weightKg?.takeIf { it > 0 }?.toString().orEmpty()
            feedback = Feedback(true, "已选 ${skuHit.skuCode}，待上架 ${skuHit.remainingPutaway}，可改每次件数后扫库位")
            scan = ""; return
        }
        if (selectedItemId == null) { feedback = Feedback(false, "请先扫描待上架 SKU"); return }
        locationCode = code.trim().uppercase(); scan = ""; doPutaway(recordId)
    }

    fun submitPutaway() {
        viewModelScope.launch {
            busy = true
            val o = order
            val recordId = PdaApp.instance.workJournal.beginScan("inbound", "putaway", locationCode, o?.id, o?.no)
            try {
                doPutaway(recordId)
                PdaApp.instance.workJournal.acknowledge(recordId, feedback?.message)
            }
            catch (e: Exception) {
                feedback = Feedback(false, e.message ?: "上架失败")
                if (PdaApp.instance.workJournal.isRetriable(e)) PdaApp.instance.workJournal.retainForRetry(recordId, feedback?.message)
                else PdaApp.instance.workJournal.fail(recordId, feedback?.message)
            }
            finally { busy = false }
        }
    }

    private suspend fun doPutaway(recordId: String? = null) {
        val o = order ?: return
        val item = selectedItem ?: run { feedback = Feedback(false, "请先扫描 SKU"); return }
        if (locationCode.isBlank()) { feedback = Feedback(false, "请扫描库位"); return }
        if (!item.hasMeasuredDims()) { feedback = Feedback(false, "${item.skuCode} 请先填写并保存体积"); return }
        val qty = putawayQty.coerceIn(1, item.remainingPutaway.coerceAtLeast(1))
        val loc = locationCode
        val requestId = recordId ?: java.util.UUID.randomUUID().toString()
        PdaApp.instance.workJournal.preparePostRetry(
            requestId,
            "/inbound/${o.id}/putaway",
            mapOf(
                "items" to listOf(mapOf(
                    "inboundItemId" to item.id,
                    "lines" to listOf(mapOf("locationCode" to loc, "qty" to qty)),
                )),
            ),
        )
        api.putaway(o.id, item.id, loc, qty, requestId)
        locationCode = ""; refreshOrder()
        val remaining = order?.itemList?.sumOf { it.remainingPutaway } ?: 0
        if (remaining <= 0) {
            putawayDoneNo = o.no
            feedback = Feedback(true, "${o.no} 上架完成")
        } else {
            feedback = Feedback(true, "${item.skuCode} → $loc ×$qty；请扫描下一件 SKU")
            val next = order?.itemList?.firstOrNull {
                (it.actualQty ?: 0) > 0 && it.remainingPutaway > 0
            }
            selectedItemId = next?.id
            putawayQty = next?.remainingPutaway?.coerceAtLeast(1) ?: 1
        }
    }

    fun submitQc() {
        val o = order ?: return
        val hasDiff = o.itemList.any { (it.actualQty ?: 0) != it.expectedQty }
        if (hasDiff && !acceptDiff) { feedback = Feedback(false, "存在收货差异，请确认差异处理后再提交"); return }
        viewModelScope.launch {
            busy = true
            val journal = PdaApp.instance.workJournal
            val recordId = journal.beginScan("inbound", "qc_submit", o.no, o.id, o.no)
            try {
                val items = o.itemList.map { mapOf(
                    "id" to it.id,
                    "sku" to it.skuCode,
                    "actualQty" to (it.actualQty ?: 0),
                    "qcStatus" to (it.qcStatus ?: "pass"),
                    "qcRemark" to it.qcRemark,
                ) }
                journal.preparePostRetry(recordId, "/inbound/${o.id}/qc", mapOf("items" to items, "acceptDiff" to acceptDiff))
                api.submitQc(o.id, items, acceptDiff, recordId)
                journal.acknowledge(recordId, "清点提交成功")
                refreshOrder()
                feedback = if (order?.statusKey == "exception") {
                    Feedback(false, "${o.no} 差异已登记，订单进入异常，等待主管核对放行")
                } else {
                    Feedback(true, "${o.no} 清点已提交；下一步：进入上架扫描")
                }
            } catch (e: Exception) {
                feedback = Feedback(false, e.message ?: "提交清点失败")
                if (journal.isRetriable(e)) journal.retainForRetry(recordId, feedback?.message) else journal.fail(recordId, feedback?.message)
            }
            finally { busy = false }
        }
    }

    fun saveMeasure() {
        val o = order ?: return
        val item = selectedItem ?: run { feedback = Feedback(false, "请先点选 SKU"); return }
        val l = lengthCm.toDoubleOrNull() ?: 0.0
        val w = widthCm.toDoubleOrNull() ?: 0.0
        val h = heightCm.toDoubleOrNull() ?: 0.0
        val weight = weightKg.toDoubleOrNull()?.takeIf { it > 0 }
        if (l <= 0 || w <= 0 || h <= 0) {
            feedback = Feedback(false, "请填写有效长宽高（cm）")
            return
        }
        viewModelScope.launch {
            busy = true
            try {
                when (mode) {
                    InboundMode.Putaway ->
                        api.measureDimensions(o.id, item.id, l, w, h, weight)
                    InboundMode.Qc, InboundMode.Receive ->
                        api.scanQc(o.id, item.skuCode, 0, null, l, w, h, weight)
                    else -> {
                        feedback = Feedback(false, "当前步骤不可保存测量")
                        return@launch
                    }
                }
                refreshOrder()
                feedback = Feedback(true, "${item.skuCode} 长宽高重量已保存")
            } catch (e: Exception) {
                feedback = Feedback(false, e.message ?: "保存失败")
            } finally {
                busy = false
            }
        }
    }

    fun resolveException(reason: String) {
        val o = order ?: return
        if (reason.trim().length < 2) { feedback = Feedback(false, "请填写异常放行原因"); return }
        viewModelScope.launch {
            busy = true
            try { api.resolveException(o.id, reason); refreshOrder(); feedback = Feedback(true, "已放行，可继续上架"); showExceptionRelease = false; exceptionReason = "" }
            catch (e: Exception) { feedback = Feedback(false, e.message ?: "放行失败") }
            finally { busy = false }
        }
    }

    fun confirmCartonCount(reason: String = "") {
        val id = order?.id ?: run { feedback = Feedback(false, "请先扫描单号绑定入库单"); return }
        if (cartonCount < scannedCartonCount) {
            feedback = Feedback(false, "已扫码确认 $scannedCartonCount 箱，实收箱数不能改小")
            cartonCount = scannedCartonCount
            return
        }
        val expected = order?.cartonList?.size ?: 0
        if (expected > 0 && cartonCount != expected && reason.trim().length < 2) {
            showCartonDifference = true
            return
        }
        viewModelScope.launch {
            busy = true; feedback = null
            val journal = PdaApp.instance.workJournal
            val recordId = journal.beginScan("inbound", "carton_count_submit", cartonCount.toString(), id, order?.no)
            try {
                journal.preparePostRetry(recordId, "/inbound/$id/received-carton-count", mapOf("receivedCartonCount" to cartonCount, "differenceReason" to reason.trim()))
                val res = api.recordReceivedCartonCount(id, cartonCount, reason, recordId)
                journal.acknowledge(recordId, "箱数登记成功")
                refreshOrder()
                showCartonDifference = false
                cartonDifferenceReason = ""
                enterQcAfterReceive(res.message.orEmpty().ifBlank { "实收箱数已登记" })
            } catch (e: Exception) {
                feedback = Feedback(false, e.message ?: "登记箱数失败")
                if (journal.isRetriable(e)) journal.retainForRetry(recordId, feedback?.message) else journal.fail(recordId, feedback?.message)
            } finally { busy = false }
        }
    }

    fun openQcIssue(item: InboundItem) {
        qcIssueItemId = item.id
        qcIssueQty = (item.actualQty ?: 0).toString()
        qcIssueType = when {
            (item.actualQty ?: 0) < item.expectedQty -> "short"
            (item.actualQty ?: 0) > item.expectedQty -> "over"
            else -> "damaged"
        }
        qcIssueRemark = item.qcRemark.orEmpty()
    }

    fun saveQcIssue() {
        val itemId = qcIssueItemId ?: return
        val actual = qcIssueQty.toIntOrNull()
        if (actual == null || actual < 0) { feedback = Feedback(false, "实收数量必须是非负整数"); return }
        if (qcIssueRemark.trim().length < 2) { feedback = Feedback(false, "请填写至少 2 个字的差异说明"); return }
        val labels = mapOf("short" to "少收", "over" to "超收", "damaged" to "破损", "rejected" to "拒收")
        val label = labels[qcIssueType] ?: "差异"
        order = order?.copy(items = order?.itemList?.map {
            if (it.id == itemId) it.copy(
                actualQty = actual,
                qcStatus = if (qcIssueType == "damaged" || qcIssueType == "rejected") "fail" else "pass",
                qcRemark = "[$label] ${qcIssueRemark.trim()}",
                diffQty = actual - it.expectedQty,
            ) else it
        })
        qcIssueItemId = null
        feedback = Feedback(true, "$label 已记录，提交清点后写入 ERP")
    }

    fun reportUnknownBarcode() {
        val o = order ?: return
        val code = unknownScanCode ?: return
        viewModelScope.launch {
            busy = true
            try {
                val res = api.reportInboundException(o.id, "unknown_barcode", code, unknownScanRemark)
                feedback = Feedback(true, res.message.orEmpty().ifBlank { "未知条码已登记" })
                unknownScanCode = null
                unknownScanRemark = ""
            } catch (e: Exception) {
                feedback = Feedback(false, e.message ?: "异常登记失败")
            } finally { busy = false }
        }
    }

    fun finishPutawayDone() {
        val no = putawayDoneNo
        putawayDoneNo = null
        clearOrder()
        feedback = Feedback(true, "${no.orEmpty()} 上架完成，已返回待上架列表")
    }

    fun clearOrder() {
        order = null; selectedItemId = null; locationCode = ""; feedback = null; scan = ""
        unknownScanCode = null; qcIssueItemId = null; showCartonDifference = false
        PdaApp.instance.workJournal.clearActive("inbound")
        if (mode == InboundMode.Putaway) loadPendingPutaway()
    }

    private suspend fun refreshOrder() {
        val id = order?.id ?: return
        applyOrder(api.inboundDetail(id))
        order?.let { PdaApp.instance.workJournal.activate(PdaResumeWork("inbound", mode.key, it.id, it.no)) }
        val still = order?.itemList?.find { it.id == selectedItemId }
        if (still == null) {
            selectedItemId = order?.itemList?.firstOrNull {
                (it.actualQty ?: 0) > 0 && it.remainingPutaway > 0
            }?.id
        }
    }
}

@Composable
fun InboundScreen(modeKey: String, onBack: () -> Unit, vm: InboundViewModel = viewModel()) {
    LaunchedEffect(modeKey) { vm.bindMode(modeKey) }
    LaunchedEffect(Unit) { ScanBus.codes.collect { vm.onHardwareScan(it) } }
    val order = vm.order
    val screenTitle = when (vm.mode) {
        InboundMode.Arrival -> tr("arrival")
        InboundMode.Receive -> tr("receive")
        InboundMode.Qc -> tr("qc")
        InboundMode.Putaway -> tr("putaway")
    }
    val scanLabel = when (vm.mode) {
        InboundMode.Arrival -> tr("scan_inbound")
        InboundMode.Receive -> tr("scan_carton_or_sku")
        InboundMode.Qc -> tr("scan_sku")
        InboundMode.Putaway -> if (order == null) tr("scan_inbound") else tr("scan_sku_location")
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(screenTitle, color = PdaText, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
            Text(
                tr("back"),
                color = PdaAccent,
                modifier = Modifier
                    .focusProperties { canFocus = false }
                    .clickable(onClick = onBack)
                    .padding(horizontal = 8.dp, vertical = 4.dp),
            )
        }
        ScanField(vm.scan, { vm.scan = it }, { vm.submitScan() }, scanLabel, enabled = true, focusNonce = "${vm.mode.key}-${vm.busy}")
        ScanQueueStatus(vm.pendingScanCount, vm.busy)
        if (vm.mode == InboundMode.Receive) {
            Text("可扫箱唛记箱数，也可扫 SKU / 条码 / 990 累加实收", color = PdaMuted, fontSize = 12.sp)
        }
        if (vm.mode == InboundMode.Qc) {
            Text("扫 SKU、商品条码或已绑 990，每扫一次按下方件数累加", color = PdaMuted, fontSize = 12.sp)
        }
        if (vm.mode == InboundMode.Putaway) {
            Text(
                if (order == null) "扫入库单号进入，或点选下方待上架单据" else "扫 SKU / 条码 / 990 选品，可手填每次上架件数，再扫库位",
                color = PdaMuted,
                fontSize = 12.sp,
            )
        }
        var qtyDialog by remember { mutableStateOf<String?>(null) }
        var qtyDraft by remember { mutableStateOf("") }
        val putawayMax = (vm.selectedItem?.remainingPutaway ?: 0).coerceAtLeast(1)
        val cartonMin = vm.scannedCartonCount.coerceAtLeast(1)
        when (vm.mode) {
            InboundMode.Receive -> QtyRow(
                label = "实收箱数",
                value = vm.cartonCount,
                onChange = { vm.cartonCount = it.coerceAtLeast(cartonMin) },
                onNumberClick = {
                    qtyDraft = vm.cartonCount.toString()
                    qtyDialog = "carton"
                },
            )
            InboundMode.Qc -> QtyRow(
                label = "每次件数",
                value = vm.qcIncrement,
                onChange = { vm.qcIncrement = it.coerceAtLeast(1) },
                onNumberClick = {
                    qtyDraft = vm.qcIncrement.toString()
                    qtyDialog = "qc"
                },
            )
            InboundMode.Putaway -> if (order != null) QtyRow(
                label = "每次上架件数",
                value = vm.putawayQty,
                onChange = { vm.putawayQty = it.coerceIn(1, putawayMax) },
                onNumberClick = {
                    qtyDraft = vm.putawayQty.toString()
                    qtyDialog = "putaway"
                },
            )
            else -> {}
        }
        if (qtyDialog != null) {
            val dialogTitle = when (qtyDialog) {
                "carton" -> "实收箱数"
                "putaway" -> "每次上架件数"
                else -> "每次件数"
            }
            val fieldLabel = if (qtyDialog == "carton") "箱数" else "件数"
            val maxQty = if (qtyDialog == "putaway") putawayMax else 9999
            val minQty = if (qtyDialog == "carton") cartonMin else 1
            AlertDialog(
                onDismissRequest = { qtyDialog = null },
                title = { Text(dialogTitle) },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("点数字手填，或用 − / + 调整。", color = PdaMuted, fontSize = 13.sp)
                        if (qtyDialog == "carton" && vm.scannedCartonCount > 0) {
                            Text(
                                "已扫码确认 ${vm.scannedCartonCount} 箱，不能填写更小数量。",
                                color = PdaWarn,
                                fontSize = 12.sp,
                            )
                        }
                        OutlinedTextField(
                            value = qtyDraft,
                            onValueChange = { raw -> qtyDraft = raw.filter { ch -> ch.isDigit() }.take(4) },
                            label = { Text(fieldLabel) },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                            colors = fieldColors(),
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                },
                confirmButton = {
                    TextButton(onClick = {
                        val n = qtyDraft.toIntOrNull()?.coerceIn(minQty, maxQty) ?: minQty
                        when (qtyDialog) {
                            "carton" -> vm.cartonCount = n
                            "putaway" -> vm.putawayQty = n
                            else -> vm.qcIncrement = n
                        }
                        qtyDialog = null
                    }) { Text("确定", color = PdaAccent) }
                },
                dismissButton = { TextButton(onClick = { qtyDialog = null }) { Text("取消") } },
            )
        }
        FeedbackBar(vm.feedback)
        if (order == null) {
            if (vm.mode == InboundMode.Putaway) {
                Text("待上架入库单", color = PdaInbound, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                if (vm.pendingOrders.isEmpty()) {
                    Text("当前仓库暂无待上架单据，可直接扫描入库单号", color = PdaMuted, fontSize = 13.sp)
                }
                vm.pendingOrders.forEach { row ->
                    val remaining = row.itemList.sumOf { it.remainingPutaway }
                    val expected = row.itemList.sumOf { it.expectedQty }
                    DocumentCard(
                        typeLabel = "待上架",
                        number = row.no,
                        accent = PdaInbound,
                        status = { StatusChip(row.statusText, statusTone(row.statusKey)) },
                        onClick = { vm.openPendingOrder(row.id) },
                    ) {
                        Text("仓库 ${row.warehouseCode.orEmpty().ifBlank { "—" }} · 待上架 $remaining / 应收 $expected", color = PdaMuted, fontSize = 12.sp)
                    }
                }
            } else {
                Text("先扫描单号绑定作业入库单", color = PdaMuted, fontSize = 13.sp)
            }
        }
        else {
            DocumentCard(
                typeLabel = "入库单",
                number = order.no,
                accent = PdaInbound,
                status = { StatusChip(order.statusText, statusTone(order.statusKey)) },
            ) {
                KeyValue("仓库", order.warehouseCode.orEmpty())
                KeyValue("件数", "${order.itemList.sumOf { it.actualQty ?: 0 }} / ${order.itemList.sumOf { it.expectedQty }}")
                if (order.receivedCartonCount != null && order.receivedCartonCount > 0) {
                    KeyValue("实收箱数", "${order.receivedCartonCount}")
                }
                if (order.cartonList.isNotEmpty()) KeyValue("外箱", "${order.cartonList.count { it.status == "received" }} / ${order.cartonList.size}")
                TextButton(onClick = { vm.clearOrder() }) { Text("换单", color = PdaAccent) }
            }
            if (vm.mode == InboundMode.Receive) {
                if (order.cartonList.isNotEmpty()) {
                    val received = order.cartonList.count { it.status == "received" }
                    Text(
                        "收箱进度 $received / ${order.cartonList.size} · ${order.cartonList.size - received} 箱未确认",
                        color = if (received == order.cartonList.size) PdaOk else PdaWarn,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
                BigButton("确认箱数", onClick = { vm.confirmCartonCount() }, enabled = !vm.busy, color = PdaOk)
            }
            if (order.statusKey == "exception") {
                if (PdaApp.instance.session.hasPerm("inbound.handle_exception")) {
                    BigButton("异常放行", onClick = { vm.showExceptionRelease = true }, enabled = !vm.busy, color = PdaWarn)
                } else {
                    Text("此异常单需由具备「异常放行」权限的主管处理", color = PdaWarn, fontSize = 13.sp)
                }
            }
            if (vm.mode == InboundMode.Qc || vm.mode == InboundMode.Receive) BigButton("提交清点", onClick = { vm.submitQc() }, enabled = !vm.busy && order.itemList.isNotEmpty() && PdaApp.instance.session.hasPerm("inbound.qc"), color = PdaOk)
            if ((vm.mode == InboundMode.Qc || vm.mode == InboundMode.Receive) && order.itemList.any { (it.actualQty ?: 0) != it.expectedQty }) {
                val canConfirmDiff = PdaApp.instance.session.hasPerm("inbound.confirm_diff")
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = vm.acceptDiff, onCheckedChange = { vm.acceptDiff = it }, enabled = canConfirmDiff)
                    Text(if (canConfirmDiff) "确认并提交本次收货差异" else "存在差异，需由具备差异确认权限的人员处理", color = PdaWarn, fontSize = 13.sp)
                }
            }
            if (vm.mode == InboundMode.Putaway) PutawayEditor(vm)
            Text("SKU 明细", color = PdaInbound, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            val showInlineMeasure = vm.mode == InboundMode.Qc || vm.mode == InboundMode.Receive
            val visibleItems = if (vm.mode == InboundMode.Putaway) {
                order.itemList.filter { (it.actualQty ?: 0) > 0 }
            } else {
                order.itemList
            }
            visibleItems.forEach { item ->
                val selected = item.id == vm.selectedItemId
                Column(
                    Modifier.fillMaxWidth().padding(bottom = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    SkuCard(
                        sku = item.skuCode,
                        bound990 = item.bound990,
                        progress = "${item.actualQty ?: 0}/${item.expectedQty}",
                        done = (item.actualQty ?: 0) == item.expectedQty,
                        selected = selected,
                        onClick = {
                            vm.selectedItemId = item.id
                            vm.putawayQty = item.remainingPutaway.coerceAtLeast(1)
                            vm.lengthCm = item.lengthCm?.takeIf { it > 0 }?.toString().orEmpty()
                            vm.widthCm = item.widthCm?.takeIf { it > 0 }?.toString().orEmpty()
                            vm.heightCm = item.heightCm?.takeIf { it > 0 }?.toString().orEmpty()
                            vm.weightKg = item.weightKg?.takeIf { it > 0 }?.toString().orEmpty()
                        },
                    ) {
                        Text(item.productName.orEmpty(), color = PdaMuted, fontSize = 12.sp)
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text("待上架 ${item.remainingPutaway}", color = PdaText, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                            Text("应收 ${item.expectedQty} · 实收 ${item.actualQty ?: 0}", color = PdaMuted, fontSize = 12.sp)
                        }
                        if ((item.actualQty ?: 0) != item.expectedQty) {
                            Text("差异 ${(item.actualQty ?: 0) - item.expectedQty}", color = PdaWarn, fontSize = 12.sp)
                        }
                        item.qcRemark?.takeIf { it.isNotBlank() }?.let {
                            Text(it, color = PdaWarn, fontSize = 12.sp)
                        }
                        if (vm.mode == InboundMode.Putaway && !item.hasMeasuredDims()) {
                            Text("缺少商品尺寸：请转「清点」扫描并测量", color = PdaWarn, fontSize = 12.sp)
                        }
                    }
                    AnimatedVisibility(
                        visible = selected && showInlineMeasure,
                        enter = expandVertically(),
                        exit = shrinkVertically(),
                    ) {
                        QcMeasureEditor(vm)
                    }
                    if (showInlineMeasure) {
                        TextButton(onClick = { vm.openQcIssue(item) }, enabled = !vm.busy) {
                            Text("登记少收 / 超收 / 破损 / 拒收", color = PdaWarn)
                        }
                    }
                }
            }
        }
    }
    if (vm.showExceptionRelease) ExceptionReleaseDialog(vm)
    if (vm.showCartonDifference) CartonDifferenceDialog(vm)
    if (vm.unknownScanCode != null) UnknownBarcodeDialog(vm)
    if (vm.qcIssueItemId != null) QcIssueDialog(vm)
    if (vm.putawayDoneNo != null) {
        AlertDialog(
            onDismissRequest = { vm.finishPutawayDone() },
            title = { Text("上架完成") },
            text = { Text("${vm.putawayDoneNo} 全部 SKU 已上架。", color = PdaMuted, fontSize = 14.sp) },
            confirmButton = {
                TextButton(onClick = { vm.finishPutawayDone() }) { Text("返回上架", color = PdaAccent) }
            },
        )
    }
}

@Composable
private fun ExceptionReleaseDialog(vm: InboundViewModel) {
    AlertDialog(
        onDismissRequest = { if (!vm.busy) vm.showExceptionRelease = false },
        title = { Text("确认异常放行") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("放行后订单将进入待上架。请记录放行依据，系统会保存操作人和原因。", color = PdaMuted, fontSize = 14.sp)
                OutlinedTextField(
                    value = vm.exceptionReason,
                    onValueChange = { vm.exceptionReason = it },
                    label = { Text("放行原因（必填）") },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 2,
                    colors = fieldColors(),
                )
            }
        },
        confirmButton = {
            TextButton(enabled = !vm.busy && vm.exceptionReason.trim().length >= 2, onClick = { vm.resolveException(vm.exceptionReason) }) { Text("确认放行", color = PdaWarn) }
        },
        dismissButton = { TextButton(enabled = !vm.busy, onClick = { vm.showExceptionRelease = false }) { Text("取消") } },
    )
}

@Composable
private fun QcMeasureEditor(vm: InboundViewModel) {
    Panel {
        Text("测量尺寸与重量", color = PdaText, fontWeight = FontWeight.Medium, fontSize = 14.sp)
        Text("确认后回写 ERP 商品资料", color = PdaMuted, fontSize = 12.sp)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            DimField("长(cm)", vm.lengthCm) { vm.lengthCm = it.filter { ch -> ch.isDigit() || ch == '.' } }
            DimField("宽(cm)", vm.widthCm) { vm.widthCm = it.filter { ch -> ch.isDigit() || ch == '.' } }
            DimField("高(cm)", vm.heightCm) { vm.heightCm = it.filter { ch -> ch.isDigit() || ch == '.' } }
        }
        OutlinedTextField(
            value = vm.weightKg,
            onValueChange = { vm.weightKg = it.filter { ch -> ch.isDigit() || ch == '.' } },
            label = { Text("重量(kg)") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            colors = fieldColors(),
        )
        BigButton("保存尺寸", onClick = { vm.saveMeasure() }, enabled = !vm.busy, color = PdaOk)
    }
}

@Composable
private fun PutawayEditor(vm: InboundViewModel) {
    val item = vm.selectedItem
    Panel {
        Text(item?.skuCode ?: "先扫 SKU", color = PdaText, fontWeight = FontWeight.Medium)
        if (item != null) {
            Text("本次上架 ${vm.putawayQty} 件 · 剩余 ${item.remainingPutaway} 件", color = PdaMuted, fontSize = 12.sp)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(onClick = { vm.putawayQty = 1 }, modifier = Modifier.weight(1f)) { Text("上架 1 件", color = PdaAccent) }
                TextButton(onClick = { vm.putawayQty = item.remainingPutaway.coerceAtLeast(1) }, modifier = Modifier.weight(1f)) { Text("上架全部剩余", color = PdaAccent) }
            }
        }
        OutlinedTextField(value = vm.locationCode, onValueChange = { vm.locationCode = it.uppercase() }, label = { Text("库位") }, singleLine = true, colors = fieldColors())
        if (item != null && !item.hasMeasuredDims()) {
            Text("需先测体积（cm）", color = PdaWarn, fontSize = 13.sp)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                DimField("长", vm.lengthCm) { vm.lengthCm = it }
                DimField("宽", vm.widthCm) { vm.widthCm = it }
                DimField("高", vm.heightCm) { vm.heightCm = it }
            }
            OutlinedTextField(
                value = vm.weightKg,
                onValueChange = { vm.weightKg = it.filter { ch -> ch.isDigit() || ch == '.' } },
                label = { Text("重量(kg)") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                colors = fieldColors(),
            )
            BigButton("保存尺寸", onClick = { vm.saveMeasure() }, enabled = !vm.busy)
        }
        BigButton("确认上架", onClick = { vm.submitPutaway() }, enabled = !vm.busy && item != null, color = PdaOk)
    }
}

@Composable
private fun CartonDifferenceDialog(vm: InboundViewModel) {
    val expected = vm.order?.cartonList?.size ?: 0
    AlertDialog(
        onDismissRequest = { if (!vm.busy) vm.showCartonDifference = false },
        title = { Text("确认收箱差异") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("预计 $expected 箱，实际登记 ${vm.cartonCount} 箱。差异必须说明原因后才能继续。", color = PdaWarn, fontSize = 14.sp)
                OutlinedTextField(
                    value = vm.cartonDifferenceReason,
                    onValueChange = { vm.cartonDifferenceReason = it },
                    label = { Text("原因，如少箱、破损、无箱唛") },
                    minLines = 2,
                    modifier = Modifier.fillMaxWidth(),
                    colors = fieldColors(),
                )
            }
        },
        confirmButton = {
            TextButton(
                enabled = !vm.busy && vm.cartonDifferenceReason.trim().length >= 2,
                onClick = { vm.confirmCartonCount(vm.cartonDifferenceReason) },
            ) { Text("登记差异并继续", color = PdaWarn) }
        },
        dismissButton = { TextButton(onClick = { vm.showCartonDifference = false }) { Text("返回核对") } },
    )
}

@Composable
private fun UnknownBarcodeDialog(vm: InboundViewModel) {
    AlertDialog(
        onDismissRequest = { if (!vm.busy) vm.unknownScanCode = null },
        title = { Text("未知条码") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("条码 ${vm.unknownScanCode.orEmpty()} 不属于当前入库单。可登记给主管核对，货物先放异常区。", color = PdaWarn, fontSize = 14.sp)
                OutlinedTextField(
                    value = vm.unknownScanRemark,
                    onValueChange = { vm.unknownScanRemark = it },
                    label = { Text("备注（可选）") },
                    modifier = Modifier.fillMaxWidth(),
                    colors = fieldColors(),
                )
            }
        },
        confirmButton = { TextButton(enabled = !vm.busy, onClick = { vm.reportUnknownBarcode() }) { Text("登记异常", color = PdaWarn) } },
        dismissButton = { TextButton(enabled = !vm.busy, onClick = { vm.unknownScanCode = null }) { Text("返回继续清点") } },
    )
}

@Composable
private fun QcIssueDialog(vm: InboundViewModel) {
    val item = vm.order?.itemList?.find { it.id == vm.qcIssueItemId }
    val options = listOf("short" to "少收", "over" to "超收", "damaged" to "破损", "rejected" to "拒收")
    AlertDialog(
        onDismissRequest = { if (!vm.busy) vm.qcIssueItemId = null },
        title = { Text("登记 ${item?.skuCode.orEmpty()} 收货差异") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    options.forEach { (key, label) ->
                        TextButton(
                            onClick = { vm.qcIssueType = key },
                            modifier = Modifier.weight(1f).background(
                                if (vm.qcIssueType == key) PdaWarn.copy(alpha = 0.2f) else PdaSurface2,
                                RoundedCornerShape(8.dp),
                            ),
                        ) { Text(label, color = if (vm.qcIssueType == key) PdaWarn else PdaMuted, fontSize = 12.sp) }
                    }
                }
                OutlinedTextField(
                    value = vm.qcIssueQty,
                    onValueChange = { vm.qcIssueQty = it.filter(Char::isDigit).take(6) },
                    label = { Text("最终实收数量（应收 ${item?.expectedQty ?: 0}）") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier.fillMaxWidth(),
                    colors = fieldColors(),
                )
                OutlinedTextField(
                    value = vm.qcIssueRemark,
                    onValueChange = { vm.qcIssueRemark = it },
                    label = { Text("差异原因（必填）") },
                    minLines = 2,
                    modifier = Modifier.fillMaxWidth(),
                    colors = fieldColors(),
                )
                if (vm.qcIssueType == "over") Text("超收提交仍需具备差异确认权限。", color = PdaWarn, fontSize = 12.sp)
                if (vm.qcIssueType == "damaged" || vm.qcIssueType == "rejected") Text("破损或拒收会将入库单转为异常，需主管放行。", color = PdaWarn, fontSize = 12.sp)
            }
        },
        confirmButton = { TextButton(onClick = { vm.saveQcIssue() }) { Text("保存差异", color = PdaWarn) } },
        dismissButton = { TextButton(onClick = { vm.qcIssueItemId = null }) { Text("取消") } },
    )
}

@Composable
private fun RowScope.DimField(label: String, value: String, onChange: (String) -> Unit) {
    OutlinedTextField(value = value, onValueChange = onChange, label = { Text(label) }, singleLine = true, modifier = Modifier.weight(1f), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), colors = fieldColors())
}

@Composable
private fun QtyRow(label: String, value: Int, onChange: (Int) -> Unit, onNumberClick: (() -> Unit)? = null) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        QtyButton("−") { onChange(value - 1) }
        Column(
            Modifier.weight(1.2f).then(
                if (onNumberClick != null) Modifier.clickable(onClick = onNumberClick) else Modifier,
            ),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(label, color = PdaMuted, fontSize = 12.sp)
            Text("$value", color = PdaText, fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
            if (onNumberClick != null) Text("点数字可手填", color = PdaMuted, fontSize = 11.sp)
        }
        QtyButton("+") { onChange(value + 1) }
    }
}

private fun statusTone(status: String) = when (status) {
    "completed", "confirmed" -> "ok"
    "exception" -> "err"
    "arrived", "receiving", "pending_putaway" -> "warn"
    else -> "info"
}
