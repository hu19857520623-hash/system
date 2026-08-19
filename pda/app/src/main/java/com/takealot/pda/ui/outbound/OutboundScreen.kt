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
import com.takealot.pda.data.outboundStatusLabel
import com.takealot.pda.scan.ScanBus
import com.takealot.pda.ui.components.BigButton
import com.takealot.pda.ui.components.Feedback
import com.takealot.pda.ui.components.FeedbackBar
import com.takealot.pda.ui.components.KeyValue
import com.takealot.pda.ui.components.Panel
import com.takealot.pda.ui.components.ScanField
import com.takealot.pda.ui.components.StatusChip
import com.takealot.pda.ui.theme.PdaAccent
import com.takealot.pda.ui.theme.PdaMuted
import com.takealot.pda.ui.theme.PdaOk
import com.takealot.pda.ui.theme.PdaSurface
import com.takealot.pda.ui.theme.PdaSurface2
import com.takealot.pda.ui.theme.PdaText
import com.takealot.pda.ui.theme.PdaWarn
import kotlinx.coroutines.launch

class OutboundViewModel : ViewModel() {
    private val api get() = PdaApp.instance.api
    private val session get() = PdaApp.instance.session
    var mode by mutableStateOf("pick")
    var scan by mutableStateOf("")
    var list by mutableStateOf<List<OutboundOrder>>(emptyList())
    var order by mutableStateOf<OutboundOrder?>(null)
    var lines by mutableStateOf<List<LocalPickLine>>(emptyList())
    var selectedSku by mutableStateOf<String?>(null)
    var feedback by mutableStateOf<Feedback?>(null)
    var busy by mutableStateOf(false)

    fun bindMode(key: String) {
        mode = if (key == "review") "review" else "pick"
        feedback = null; scan = ""; order = null; lines = emptyList(); loadList()
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
        try {
            if (order == null) { openByCode(code); scan = ""; return }
            val line = lines.find { it.sku.equals(code, true) }
            if (line != null) {
                selectedSku = line.sku
                val nextQty = if (mode == "pick") (line.scannedQty + 1).coerceAtMost(line.qty) else line.qty
                lines = lines.map { if (it.id == line.id) it.copy(scannedQty = nextQty) else it }
                feedback = Feedback(true, "${line.sku} $nextQty/${line.qty}"); scan = ""; return
            }
            if (mode == "pick" && selectedSku != null) {
                lines = lines.map { if (it.sku == selectedSku) it.copy(locationCode = code.trim().uppercase()) else it }
                feedback = Feedback(true, "库位 $code"); scan = ""; return
            }
            openByCode(code); scan = ""
        } catch (e: Exception) { feedback = Feedback(false, e.message ?: "扫描失败") }
        finally { busy = false }
    }

    private suspend fun openByCode(code: String) {
        val page = api.outboundList(keyword = code, warehouseCode = session.warehouseCode.ifBlank { null }, pageSize = 20)
        val match = page.items.orEmpty().firstOrNull { it.no.equals(code, true) || it.no.contains(code, true) }
            ?: page.items.orEmpty().firstOrNull()
            ?: throw ErpException("未找到出库单 $code")
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
        val nextOrder: OutboundOrder
        val nextLines: List<LocalPickLine>
        if (mode == "pick") {
            if (detail.statusKey == "pending_pick" || detail.pickerId == null) throw ErpException("请先在电脑端分配拣货员")
            if (detail.statusKey != "picking") throw ErpException("当前状态「${outboundStatusLabel(detail.statusKey)}」不可拣货")
            nextOrder = detail
            nextLines = api.pickSuggestions(id).itemList.map {
                LocalPickLine(it.id, it.sku.orEmpty(), it.productName.orEmpty(), it.qty, it.locationCode.orEmpty(), 0)
            }
        } else {
            nextOrder = when (detail.statusKey) {
                "picked" -> api.startReview(id)
                "reviewing" -> detail
                else -> throw ErpException("当前状态「${outboundStatusLabel(detail.statusKey)}」不可复核")
            }
            if (nextOrder.omsPreDeduct != null) feedback = Feedback(false, "OMS 单需在电脑端录入外箱尺寸后再复核")
            nextLines = nextOrder.itemList.map {
                LocalPickLine(it.id, it.sku.orEmpty(), it.productName.orEmpty(), if (it.pickedQty > 0) it.pickedQty else it.qty, it.locationCode.orEmpty(), 0)
            }
        }
        order = nextOrder; lines = nextLines; selectedSku = nextLines.firstOrNull()?.sku
    }

    fun submitPick() {
        val o = order ?: return
        if (lines.any { it.locationCode.isBlank() }) { feedback = Feedback(false, "存在未填库位的 SKU"); return }
        if (lines.any { it.scannedQty <= 0 }) { feedback = Feedback(false, "请先扫描拣货 SKU"); return }
        viewModelScope.launch {
            busy = true
            try {
                api.pick(o.id, lines.map { mapOf("id" to it.id, "locationCode" to it.locationCode, "pickedQty" to it.scannedQty.coerceAtMost(it.qty).coerceAtLeast(1)) })
                feedback = Feedback(true, "${o.no} 拣货完成"); order = null; lines = emptyList(); loadList()
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
            try { api.pack(o.id); feedback = Feedback(true, "${o.no} 复核完成"); order = null; lines = emptyList(); loadList() }
            catch (e: Exception) { feedback = Feedback(false, e.message ?: "复核失败") }
            finally { busy = false }
        }
    }

    fun clearOrder() { order = null; lines = emptyList(); selectedSku = null; scan = "" }
}

@Composable
fun OutboundScreen(modeKey: String, onBack: () -> Unit, vm: OutboundViewModel = viewModel()) {
    LaunchedEffect(modeKey) { vm.bindMode(modeKey) }
    LaunchedEffect(Unit) { ScanBus.codes.collect { vm.onHardwareScan(it) } }
    val title = if (vm.mode == "pick") "拣货" else "复核"
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(title, color = PdaText, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
            TextButton(onClick = onBack) { Text("返回", color = PdaAccent) }
        }
        ScanField(vm.scan, { vm.scan = it }, { vm.submitScan() }, if (vm.order == null) "扫出库单号" else if (vm.mode == "pick") "扫 SKU 或库位" else "扫 SKU 复核", enabled = !vm.busy)
        FeedbackBar(vm.feedback)
        val order = vm.order
        if (order == null) {
            Text("待作业", color = PdaMuted, fontSize = 13.sp)
            if (vm.list.isEmpty()) Text("暂无任务，可直接扫描出库单号", color = PdaMuted, fontSize = 13.sp)
            vm.list.forEach { row ->
                Column(Modifier.fillMaxWidth().background(PdaSurface, RoundedCornerShape(10.dp)).clickable { vm.openOrder(row.id) }.padding(12.dp)) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(row.no, color = PdaText, fontWeight = FontWeight.Medium)
                        StatusChip(outboundStatusLabel(row.statusKey), "warn")
                    }
                    Text("${row.customerName.orEmpty()} · ${row.skuSummary.orEmpty().ifBlank { "${row.totalQty} 件" }}", color = PdaMuted, fontSize = 12.sp)
                }
            }
        } else {
            Panel {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(order.no, color = PdaText, fontWeight = FontWeight.SemiBold, fontSize = 18.sp)
                    StatusChip(outboundStatusLabel(order.statusKey), "warn")
                }
                KeyValue("客户", order.customerName.orEmpty())
                KeyValue("仓库", order.warehouseCode.orEmpty())
                TextButton(onClick = { vm.clearOrder() }) { Text("换单", color = PdaAccent) }
            }
            vm.lines.forEach { line ->
                Column(Modifier.fillMaxWidth().background(if (line.sku == vm.selectedSku) PdaSurface2 else PdaSurface, RoundedCornerShape(10.dp)).clickable { vm.selectedSku = line.sku }.padding(12.dp)) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(line.sku, color = PdaText, fontWeight = FontWeight.Medium)
                        Text("${line.scannedQty}/${line.qty}", color = if (line.done) PdaOk else PdaWarn, fontWeight = FontWeight.SemiBold)
                    }
                    Text(line.productName, color = PdaMuted, fontSize = 12.sp)
                    Text("库位 ${line.locationCode.ifBlank { "未填" }}", color = PdaMuted, fontSize = 12.sp)
                }
            }
            if (vm.mode == "pick") BigButton("提交拣货", onClick = { vm.submitPick() }, enabled = !vm.busy && vm.lines.isNotEmpty(), color = PdaOk)
            else BigButton("提交复核", onClick = { vm.submitReview() }, enabled = !vm.busy && vm.lines.isNotEmpty(), color = PdaOk)
        }
    }
}
