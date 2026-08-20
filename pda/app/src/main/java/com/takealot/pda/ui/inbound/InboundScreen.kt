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
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
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
import com.takealot.pda.data.InboundItem
import com.takealot.pda.data.InboundOrder
import com.takealot.pda.scan.ScanBus
import com.takealot.pda.ui.components.BigButton
import com.takealot.pda.ui.components.Feedback
import com.takealot.pda.ui.components.FeedbackBar
import com.takealot.pda.ui.components.KeyValue
import com.takealot.pda.ui.components.Panel
import com.takealot.pda.ui.components.QtyButton
import com.takealot.pda.ui.components.ScanField
import com.takealot.pda.ui.components.StatusChip
import com.takealot.pda.ui.components.fieldColors
import com.takealot.pda.ui.theme.PdaAccent
import com.takealot.pda.ui.theme.PdaMuted
import com.takealot.pda.ui.theme.PdaOk
import com.takealot.pda.ui.theme.PdaSurface2
import com.takealot.pda.ui.theme.PdaText
import com.takealot.pda.ui.theme.PdaWarn
import kotlinx.coroutines.launch

enum class InboundMode(val key: String, val title: String, val scanLabel: String) {
    Arrival("arrival", "到仓扫描", "扫入库单 / 跟踪号"),
    Receive("receive", "扫箱收货", "扫外箱标 / SKU"),
    Qc("qc", "清点", "扫 SKU"),
    Putaway("putaway", "上架", "扫 SKU 或库位");
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
    val selectedItem: InboundItem? get() = order?.itemList?.find { it.id == selectedItemId }

    fun bindMode(key: String) { mode = InboundMode.from(key); feedback = null; scan = "" }
    fun onHardwareScan(code: String) { scan = code; submitScan() }
    fun submitScan() {
        val code = scan.trim(); if (code.isEmpty() || busy) return
        viewModelScope.launch { runScan(code) }
    }

    private suspend fun runScan(code: String) {
        busy = true; feedback = null
        try {
            when (mode) {
                InboundMode.Arrival -> doArrival(code)
                InboundMode.Receive -> {
                    ensureOrder(code) ?: return
                    val res = api.receiveBox(order!!.id, code, cartonCount)
                    feedback = Feedback(true, res.message.orEmpty().ifBlank { "收货成功" })
                    refreshOrder(); scan = ""
                }
                InboundMode.Qc -> {
                    ensureOrder(code) ?: return
                    val res = api.scanQc(order!!.id, code, qcIncrement)
                    feedback = Feedback(true, res.message.orEmpty().ifBlank { "${res.sku.orEmpty()} +${res.increment}" })
                    refreshOrder(); scan = ""
                }
                InboundMode.Putaway -> handlePutawayScan(code)
            }
        } catch (e: Exception) {
            feedback = Feedback(false, e.message ?: "操作失败")
        } finally { busy = false }
    }

    private suspend fun doArrival(code: String) {
        val wh = session.warehouseCode
        if (wh.isBlank()) throw ErpException("请先在首页选择作业仓库")
        val res = api.arrivalScan(code, wh)
        order = res.order
        feedback = Feedback(true, res.message.orEmpty().ifBlank { if (res.alreadyScanned) "已到仓" else "到仓成功" })
        scan = ""
        if (order?.id != null) refreshOrder()
    }

    private suspend fun ensureOrder(code: String): InboundOrder? {
        if (order != null) return order
        val page = api.inboundList(keyword = code, pageSize = 20)
        val match = page.items.orEmpty().firstOrNull { row ->
            listOfNotNull(row.inboundNo, row.warehouseNo, row.trackingNo).any { it.equals(code, true) }
        } ?: page.items.orEmpty().firstOrNull()
        if (match == null) { feedback = Feedback(false, "未找到入库单 $code，请先扫单号"); return null }
        order = api.inboundDetail(match.id)
        return order
    }

    private suspend fun handlePutawayScan(code: String) {
        val current = order ?: ensureOrder(code) ?: return
        val skuHit = current.itemList.find { it.skuCode.equals(code, true) }
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
                feedback = Feedback(true, "${item.skuCode} → $locationCode ×$putawayQty")
                locationCode = ""; refreshOrder()
                val next = order?.itemList?.firstOrNull { it.remainingPutaway > 0 }
                selectedItemId = next?.id; putawayQty = next?.remainingPutaway?.coerceAtLeast(1) ?: 1
            } catch (e: Exception) { feedback = Feedback(false, e.message ?: "上架失败") }
            finally { busy = false }
        }
    }

    fun submitQc() {
        val o = order ?: return
        viewModelScope.launch {
            busy = true
            try {
                api.submitQc(o.id, o.itemList.map { mapOf("id" to it.id, "sku" to it.skuCode, "actualQty" to (it.actualQty ?: 0), "qcStatus" to (it.qcStatus ?: "pass")) }, acceptDiff)
                refreshOrder(); feedback = Feedback(true, "${o.no} 清点已提交")
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

    fun resolveException() {
        val o = order ?: return
        viewModelScope.launch {
            busy = true
            try { api.resolveException(o.id); refreshOrder(); feedback = Feedback(true, "已放行，可继续上架") }
            catch (e: Exception) { feedback = Feedback(false, e.message ?: "放行失败") }
            finally { busy = false }
        }
    }

    fun clearOrder() { order = null; selectedItemId = null; locationCode = ""; feedback = null; scan = "" }

    private suspend fun refreshOrder() {
        val id = order?.id ?: return
        order = api.inboundDetail(id)
        val still = order?.itemList?.find { it.id == selectedItemId }
        if (still == null) selectedItemId = order?.itemList?.firstOrNull { it.remainingPutaway > 0 }?.id
    }
}

@Composable
fun InboundScreen(modeKey: String, onBack: () -> Unit, vm: InboundViewModel = viewModel()) {
    LaunchedEffect(modeKey) { vm.bindMode(modeKey) }
    LaunchedEffect(Unit) { ScanBus.codes.collect { vm.onHardwareScan(it) } }
    val order = vm.order
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(vm.mode.title, color = PdaText, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
            TextButton(onClick = onBack) { Text("返回", color = PdaAccent) }
        }
        ScanField(vm.scan, { vm.scan = it }, { vm.submitScan() }, vm.mode.scanLabel, enabled = !vm.busy)
        when (vm.mode) {
            InboundMode.Receive -> QtyRow("收货箱数", vm.cartonCount) { vm.cartonCount = it.coerceAtLeast(1) }
            InboundMode.Qc -> QtyRow("每次件数", vm.qcIncrement) { vm.qcIncrement = it.coerceAtLeast(1) }
            else -> {}
        }
        FeedbackBar(vm.feedback)
        if (order == null) Text("先扫描单号绑定作业入库单", color = PdaMuted, fontSize = 13.sp)
        else {
            Panel {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(order.no, color = PdaText, fontWeight = FontWeight.SemiBold, fontSize = 18.sp)
                    StatusChip(order.statusText, statusTone(order.statusKey))
                }
                KeyValue("仓库", order.warehouseCode.orEmpty())
                KeyValue("件数", "${order.itemList.sumOf { it.actualQty ?: 0 }} / ${order.itemList.sumOf { it.expectedQty }}")
                if (order.cartonList.isNotEmpty()) KeyValue("外箱", "${order.cartonList.count { it.status == "received" }} / ${order.cartonList.size}")
                TextButton(onClick = { vm.clearOrder() }) { Text("换单", color = PdaAccent) }
            }
            if (order.statusKey == "exception") BigButton("异常放行", onClick = { vm.resolveException() }, enabled = !vm.busy, color = PdaWarn)
            if (vm.mode == InboundMode.Qc) BigButton("提交清点", onClick = { vm.submitQc() }, enabled = !vm.busy && order.itemList.isNotEmpty(), color = PdaOk)
            if (vm.mode == InboundMode.Putaway) PutawayEditor(vm)
            Text("明细", color = PdaMuted, fontSize = 13.sp)
            order.itemList.forEach { item ->
                Column(
                    Modifier.fillMaxWidth().background(if (item.id == vm.selectedItemId) PdaSurface2 else PdaSurface2.copy(alpha = 0.45f), RoundedCornerShape(10.dp)).clickable {
                        vm.selectedItemId = item.id
                        vm.putawayQty = item.remainingPutaway.coerceAtLeast(1)
                        vm.lengthCm = item.lengthCm?.takeIf { it > 0 }?.toString().orEmpty()
                        vm.widthCm = item.widthCm?.takeIf { it > 0 }?.toString().orEmpty()
                        vm.heightCm = item.heightCm?.takeIf { it > 0 }?.toString().orEmpty()
                    }.padding(12.dp),
                ) {
                    Text(item.skuCode, color = PdaText, fontWeight = FontWeight.Medium)
                    Text(item.productName.orEmpty(), color = PdaMuted, fontSize = 12.sp)
                    Text("应收 ${item.expectedQty} · 实收 ${item.actualQty ?: 0} · 待上架 ${item.remainingPutaway}", color = PdaMuted, fontSize = 12.sp)
                }
            }
        }
    }
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
