package com.takealot.pda.ui.inbound

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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
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
import com.takealot.pda.scan.ScanBus
import com.takealot.pda.ui.components.BigButton
import com.takealot.pda.ui.components.DocumentCard
import com.takealot.pda.ui.components.Feedback
import com.takealot.pda.ui.components.FeedbackBar
import com.takealot.pda.ui.components.KeyValue
import com.takealot.pda.ui.components.Panel
import com.takealot.pda.ui.components.QtyButton
import com.takealot.pda.ui.components.ScanField
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

enum class InboundMode(val key: String, val title: String, val scanLabel: String) {
    Arrival("arrival", "到仓扫描", "扫入库单号"),
    Receive("receive", "确认箱数", "扫外箱标"),
    Qc("qc", "清点", "扫 SKU"),
    Putaway("putaway", "上架", "扫 SKU / 条码或库位");
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
    var selectedItemId by mutableStateOf<Int?>(null)
    var locationCode by mutableStateOf("")
    var putawayQty by mutableIntStateOf(1)
    var lengthCm by mutableStateOf("")
    var widthCm by mutableStateOf("")
    var heightCm by mutableStateOf("")
    var acceptDiff by mutableStateOf(false)
    var exceptionReason by mutableStateOf("")
    var showExceptionRelease by mutableStateOf(false)
    val selectedItem: InboundItem? get() = order?.itemList?.find { it.id == selectedItemId }

    fun bindMode(key: String) {
        mode = InboundMode.from(key); feedback = null; scan = ""
        val resume = PdaApp.instance.workJournal.active("inbound", mode.key) ?: return
        viewModelScope.launch {
            try {
                order = api.inboundDetail(resume.orderId)
                feedback = Feedback(true, "已恢复 ${resume.orderNo} 的未完成作业")
            } catch (_: Exception) {
                PdaApp.instance.workJournal.clearActive("inbound")
            }
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
        val recordId = journal.beginScan("inbound", mode.key, code, order?.id, order?.no)
        try {
            when (mode) {
                InboundMode.Arrival -> doArrival(code)
                InboundMode.Receive -> {
                    if (order == null) {
                        ensureOrder(code) ?: return
                        scan = ""
                        return
                    }
                    val res = api.receiveBox(order!!.id, code)
                    feedback = Feedback(true, res.message.orEmpty().ifBlank { "外箱已确认" })
                    refreshOrder(); scan = ""
                }
                InboundMode.Qc -> {
                    ensureOrder(code) ?: return
                    val res = api.scanQc(order!!.id, code, qcIncrement, recordId)
                    feedback = Feedback(true, res.message.orEmpty().ifBlank { "${res.sku.orEmpty()} +${res.increment}" })
                    refreshOrder(); scan = ""
                }
                InboundMode.Putaway -> handlePutawayScan(code)
            }
            journal.acknowledge(recordId, feedback?.message)
        } catch (e: Exception) {
            feedback = Feedback(false, e.message ?: "操作失败")
            if (journal.isRetriable(e)) journal.retainForRetry(recordId, feedback?.message)
            else journal.fail(recordId, feedback?.message)
        } finally { busy = false }
    }

    private suspend fun doArrival(code: String) {
        val wh = session.warehouseCode
        if (wh.isBlank()) throw ErpException("请先在首页选择作业仓库")
        val res = api.arrivalScan(code, wh)
        order = res.order
        order?.let { PdaApp.instance.workJournal.activate(PdaResumeWork("inbound", mode.key, it.id, it.no)) }
        feedback = Feedback(true, res.message.orEmpty().ifBlank { if (res.alreadyScanned) "已到仓" else "到仓成功" })
        scan = ""
        if (order?.id != null) refreshOrder()
    }

    private suspend fun ensureOrder(code: String): InboundOrder? {
        if (order != null) return order
        val page = api.inboundList(keyword = code, pageSize = 20)
        val match = page.items.orEmpty().firstOrNull { row ->
            listOfNotNull(row.inboundNo, row.warehouseNo, row.trackingNo).any { it.equals(code, true) }
        }
        if (match == null) { feedback = Feedback(false, "未找到精确匹配的入库单 $code，请核对单号/仓单号/跟踪号"); return null }
        order = api.inboundDetail(match.id)
        if (order?.warehouseCode != session.warehouseCode) throw ErpException("该入库单属于 ${order?.warehouseCode}，当前作业仓为 ${session.warehouseCode}")
        order?.let { PdaApp.instance.workJournal.activate(PdaResumeWork("inbound", mode.key, it.id, it.no)) }
        return order
    }

    private suspend fun handlePutawayScan(code: String) {
        val current = order ?: ensureOrder(code) ?: return
        val skuHit = current.itemList.find { it.matchesScan(code) }
        if (skuHit != null) {
            selectedItemId = skuHit.id
            putawayQty = skuHit.remainingPutaway.coerceAtLeast(1)
            locationCode = ""
            lengthCm = skuHit.lengthCm?.takeIf { it > 0 }?.toString().orEmpty()
            widthCm = skuHit.widthCm?.takeIf { it > 0 }?.toString().orEmpty()
            heightCm = skuHit.heightCm?.takeIf { it > 0 }?.toString().orEmpty()
            feedback = Feedback(true, "已选 ${skuHit.skuCode}，待上架 ${skuHit.remainingPutaway}")
            scan = ""; return
        }
        if (selectedItemId == null) { feedback = Feedback(false, "请先扫描待上架 SKU"); return }
        locationCode = code.trim().uppercase(); scan = ""; submitPutaway()
    }

    fun submitPutaway() {
        val o = order ?: return
        val item = selectedItem ?: run { feedback = Feedback(false, "请先扫描 SKU"); return }
        if (locationCode.isBlank()) { feedback = Feedback(false, "请扫描库位"); return }
        if (!item.hasMeasuredDims()) { feedback = Feedback(false, "${item.skuCode} 请先填写并保存体积"); return }
        viewModelScope.launch {
            busy = true
            try {
                api.putaway(o.id, item.id, locationCode, putawayQty.coerceAtLeast(1))
                feedback = Feedback(true, "${item.skuCode} → $locationCode ×$putawayQty；请扫描下一件 SKU")
                locationCode = ""; refreshOrder()
                val next = order?.itemList?.firstOrNull { it.remainingPutaway > 0 }
                selectedItemId = next?.id; putawayQty = next?.remainingPutaway?.coerceAtLeast(1) ?: 1
            } catch (e: Exception) { feedback = Feedback(false, e.message ?: "上架失败") }
            finally { busy = false }
        }
    }

    fun submitQc() {
        val o = order ?: return
        val hasDiff = o.itemList.any { (it.actualQty ?: 0) != it.expectedQty }
        if (hasDiff && !acceptDiff) { feedback = Feedback(false, "存在收货差异，请确认差异处理后再提交"); return }
        viewModelScope.launch {
            busy = true
            try {
                api.submitQc(o.id, o.itemList.map { mapOf("id" to it.id, "sku" to it.skuCode, "actualQty" to (it.actualQty ?: 0), "qcStatus" to (it.qcStatus ?: "pass")) }, acceptDiff)
                refreshOrder(); feedback = Feedback(true, "${o.no} 清点已提交；下一步：进入上架扫描")
            } catch (e: Exception) { feedback = Feedback(false, e.message ?: "提交清点失败") }
            finally { busy = false }
        }
    }

    fun saveMeasure() {
        val o = order ?: return; val item = selectedItem ?: return
        val l = lengthCm.toDoubleOrNull() ?: 0.0; val w = widthCm.toDoubleOrNull() ?: 0.0; val h = heightCm.toDoubleOrNull() ?: 0.0
        if (l <= 0 || w <= 0 || h <= 0) { feedback = Feedback(false, "请填写有效长宽高（cm）"); return }
        viewModelScope.launch {
            busy = true
            try { api.measureDimensions(o.id, item.id, l, w, h); refreshOrder(); feedback = Feedback(true, "${item.skuCode} 尺寸已保存") }
            catch (e: Exception) { feedback = Feedback(false, e.message ?: "保存尺寸失败") }
            finally { busy = false }
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

    fun confirmCartonCount() {
        val id = order?.id ?: run { feedback = Feedback(false, "请先扫描单号绑定入库单"); return }
        viewModelScope.launch {
            busy = true; feedback = null
            try {
                val res = api.recordReceivedCartonCount(id, cartonCount)
                feedback = Feedback(true, res.message.orEmpty().ifBlank { "实收箱数已登记" })
                refreshOrder()
            } catch (e: Exception) {
                feedback = Feedback(false, e.message ?: "登记箱数失败")
            } finally { busy = false }
        }
    }

    fun clearOrder() { order = null; selectedItemId = null; locationCode = ""; feedback = null; scan = ""; PdaApp.instance.workJournal.clearActive("inbound") }

    private suspend fun refreshOrder() {
        val id = order?.id ?: return
        order = api.inboundDetail(id)
        order?.let { PdaApp.instance.workJournal.activate(PdaResumeWork("inbound", mode.key, it.id, it.no)) }
        val still = order?.itemList?.find { it.id == selectedItemId }
        if (still == null) selectedItemId = order?.itemList?.firstOrNull { it.remainingPutaway > 0 }?.id
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
        InboundMode.Receive -> tr("scan_carton")
        InboundMode.Qc -> tr("scan_sku")
        InboundMode.Putaway -> tr("scan_sku_location")
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(screenTitle, color = PdaText, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
            TextButton(onClick = onBack) { Text(tr("back"), color = PdaAccent) }
        }
        ScanField(vm.scan, { vm.scan = it }, { vm.submitScan() }, scanLabel, enabled = !vm.busy)
        when (vm.mode) {
            InboundMode.Receive -> QtyRow("实收箱数", vm.cartonCount) { vm.cartonCount = it.coerceAtLeast(1) }
            InboundMode.Qc -> QtyRow("每次件数", vm.qcIncrement) { vm.qcIncrement = it.coerceAtLeast(1) }
            else -> {}
        }
        FeedbackBar(vm.feedback)
        if (order == null) Text("先扫描单号绑定作业入库单", color = PdaMuted, fontSize = 13.sp)
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
                BigButton("确认箱数", onClick = { vm.confirmCartonCount() }, enabled = !vm.busy && order != null, color = PdaOk)
            }
            if (order.statusKey == "exception") {
                if (PdaApp.instance.session.hasPerm("inbound.handle_exception")) {
                    BigButton("异常放行", onClick = { vm.showExceptionRelease = true }, enabled = !vm.busy, color = PdaWarn)
                } else {
                    Text("此异常单需由具备「异常放行」权限的主管处理", color = PdaWarn, fontSize = 13.sp)
                }
            }
            if (vm.mode == InboundMode.Qc) BigButton("提交清点", onClick = { vm.submitQc() }, enabled = !vm.busy && order.itemList.isNotEmpty(), color = PdaOk)
            if (vm.mode == InboundMode.Qc && order.itemList.any { (it.actualQty ?: 0) != it.expectedQty }) {
                val canConfirmDiff = PdaApp.instance.session.hasPerm("inbound.confirm_diff")
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = vm.acceptDiff, onCheckedChange = { vm.acceptDiff = it }, enabled = canConfirmDiff)
                    Text(if (canConfirmDiff) "确认并提交本次收货差异" else "存在差异，需由具备差异确认权限的人员处理", color = PdaWarn, fontSize = 13.sp)
                }
            }
            if (vm.mode == InboundMode.Putaway) PutawayEditor(vm)
            Text("SKU 明细", color = PdaInbound, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            order.itemList.forEach { item ->
                SkuCard(
                    sku = item.skuCode,
                    progress = "${item.actualQty ?: 0}/${item.expectedQty}",
                    done = (item.actualQty ?: 0) == item.expectedQty,
                    selected = item.id == vm.selectedItemId,
                    onClick = {
                        vm.selectedItemId = item.id
                        vm.putawayQty = item.remainingPutaway.coerceAtLeast(1)
                        vm.lengthCm = item.lengthCm?.takeIf { it > 0 }?.toString().orEmpty()
                        vm.widthCm = item.widthCm?.takeIf { it > 0 }?.toString().orEmpty()
                        vm.heightCm = item.heightCm?.takeIf { it > 0 }?.toString().orEmpty()
                    },
                ) {
                    Text(item.productName.orEmpty(), color = PdaMuted, fontSize = 12.sp)
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("待上架 ${item.remainingPutaway}", color = PdaText, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                        Text("应收 ${item.expectedQty} · 实收 ${item.actualQty ?: 0}", color = PdaMuted, fontSize = 12.sp)
                    }
                    if ((item.actualQty ?: 0) != item.expectedQty) Text("差异 ${(item.actualQty ?: 0) - item.expectedQty}", color = PdaWarn, fontSize = 12.sp)
                    if (vm.mode == InboundMode.Putaway && !item.hasMeasuredDims()) Text("缺少商品尺寸：请转「清点」扫描并测量", color = PdaWarn, fontSize = 12.sp)
                }
            }
        }
    }
    if (vm.showExceptionRelease) ExceptionReleaseDialog(vm)
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
private fun PutawayEditor(vm: InboundViewModel) {
    val item = vm.selectedItem
    Panel {
        Text(item?.skuCode ?: "先扫 SKU", color = PdaText, fontWeight = FontWeight.Medium)
        OutlinedTextField(value = vm.locationCode, onValueChange = { vm.locationCode = it.uppercase() }, label = { Text("库位") }, singleLine = true, colors = fieldColors())
        QtyRow("上架数量", vm.putawayQty) { vm.putawayQty = it.coerceAtLeast(1) }
        if (item != null && !item.hasMeasuredDims()) {
            Text("需先测体积（cm）", color = PdaWarn, fontSize = 13.sp)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                DimField("长", vm.lengthCm) { vm.lengthCm = it }
                DimField("宽", vm.widthCm) { vm.widthCm = it }
                DimField("高", vm.heightCm) { vm.heightCm = it }
            }
            BigButton("保存尺寸", onClick = { vm.saveMeasure() }, enabled = !vm.busy)
        }
        BigButton("确认上架", onClick = { vm.submitPutaway() }, enabled = !vm.busy && item != null, color = PdaOk)
    }
}

@Composable
private fun RowScope.DimField(label: String, value: String, onChange: (String) -> Unit) {
    OutlinedTextField(value = value, onValueChange = onChange, label = { Text(label) }, singleLine = true, modifier = Modifier.weight(1f), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), colors = fieldColors())
}

@Composable
private fun QtyRow(label: String, value: Int, onChange: (Int) -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        QtyButton("−") { onChange(value - 1) }
        Column(Modifier.weight(1.2f), verticalArrangement = Arrangement.Center) {
            Text(label, color = PdaMuted, fontSize = 12.sp)
            Text("$value", color = PdaText, fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
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
