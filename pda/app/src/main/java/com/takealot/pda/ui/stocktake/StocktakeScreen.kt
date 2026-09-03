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
import com.takealot.pda.data.StocktakeLine
import com.takealot.pda.data.StocktakePlan
import com.takealot.pda.data.stocktakeStatusLabel
import com.takealot.pda.scan.ScanBus
import com.takealot.pda.ui.components.BigButton
import com.takealot.pda.ui.components.DocumentCard
import com.takealot.pda.ui.components.Feedback
import com.takealot.pda.ui.components.FeedbackBar
import com.takealot.pda.ui.components.KeyValue
import com.takealot.pda.ui.components.QtyButton
import com.takealot.pda.ui.components.ScanField
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

class StocktakeViewModel : ViewModel() {
    private val api get() = PdaApp.instance.api
    private val session get() = PdaApp.instance.session
    var scan by mutableStateOf("")
    var list by mutableStateOf<List<StocktakePlan>>(emptyList())
    var plan by mutableStateOf<StocktakePlan?>(null)
    var locationCode by mutableStateOf("")
    var selectedLineId by mutableStateOf<Int?>(null)
    var qty by mutableIntStateOf(1)
    var feedback by mutableStateOf<Feedback?>(null)
    var busy by mutableStateOf(false)
    val selectedLine: StocktakeLine? get() = plan?.lineList?.find { it.id == selectedLineId }

    fun bind() {
        feedback = null
        scan = ""
        loadList()
        val resume = PdaApp.instance.workJournal.active("stocktake", "count") ?: return
        viewModelScope.launch {
            try {
                openPlan(resume.orderId)
                feedback = Feedback(true, "已恢复 ${resume.orderNo} 的未完成作业")
            } catch (_: Exception) {
                PdaApp.instance.workJournal.clearActive("stocktake")
            }
        }
    }

    fun loadList() {
        viewModelScope.launch {
            try {
                list = api.stocktakes(warehouseCode = session.warehouseCode.ifBlank { null }, status = "counting")
            } catch (e: Exception) {
                feedback = Feedback(false, e.message ?: "加载盘点任务失败")
            }
        }
    }

    fun onHardwareScan(code: String) { scan = code; submitScan() }

    fun submitScan() {
        val code = scan.trim()
        if (code.isEmpty() || busy) return
        viewModelScope.launch { runScan(code) }
    }

    private suspend fun runScan(code: String) {
        busy = true
        feedback = null
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
            val locationHit = current.lineList.firstOrNull { it.loc.equals(normalized, ignoreCase = true) }
            if (locationHit != null) {
                locationCode = locationHit.loc
                selectedLineId = current.lineList.firstOrNull { it.loc.equals(locationCode, ignoreCase = true) && it.isOpen }?.id
                    ?: locationHit.id
                qty = 1
                feedback = Feedback(true, "库位 ${locationHit.loc}")
                scan = ""
                journal.acknowledge(recordId, feedback?.message)
                return
            }
            val skuHits = current.lineList.filter { it.matchesScan(normalized) }
            val skuHit = when {
                locationCode.isNotBlank() -> skuHits.firstOrNull { it.loc.equals(locationCode, ignoreCase = true) }
                else -> skuHits.firstOrNull { it.isOpen } ?: skuHits.firstOrNull()
            } ?: throw ErpException("盘点单中没有 $normalized")
            locationCode = skuHit.loc
            selectedLineId = skuHit.id
            qty = 1
            feedback = Feedback(true, "${skuHit.skuCode} · ${skuHit.loc}")
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
        viewModelScope.launch {
            busy = true
            try {
                val detail = api.stocktake(id)
                plan = detail
                locationCode = ""
                selectedLineId = detail.lineList.firstOrNull { it.isOpen }?.id
                qty = 1
                PdaApp.instance.workJournal.activate(PdaResumeWork("stocktake", "count", detail.id, detail.no))
            } catch (e: Exception) {
                feedback = Feedback(false, e.message ?: "打开盘点单失败")
            } finally {
                busy = false
            }
        }
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
        val detail = api.stocktake(hit.id)
        plan = detail
        locationCode = ""
        selectedLineId = detail.lineList.firstOrNull { it.isOpen }?.id
        qty = 1
        PdaApp.instance.workJournal.activate(PdaResumeWork("stocktake", "count", detail.id, detail.no))
        feedback = Feedback(true, "${detail.no} 已打开")
    }

    fun submitCount() {
        val current = plan ?: return
        val line = selectedLine ?: run {
            feedback = Feedback(false, "请先扫库位和 SKU")
            return
        }
        if (!line.isOpen) {
            feedback = Feedback(false, "该明细已盘完")
            return
        }
        viewModelScope.launch {
            busy = true
            try {
                plan = api.stocktakeCount(current.id, line.id, qty)
                val refreshed = plan!!
                PdaApp.instance.workJournal.activate(PdaResumeWork("stocktake", "count", refreshed.id, refreshed.no))
                val next = refreshed.lineList.firstOrNull { it.loc.equals(locationCode, ignoreCase = true) && it.isOpen }
                    ?: refreshed.lineList.firstOrNull { it.isOpen }
                selectedLineId = next?.id
                if (next == null) {
                    locationCode = ""
                    PdaApp.instance.workJournal.clearActive("stocktake")
                    feedback = Feedback(true, if (refreshed.statusKey == "pending_approval") "盘点完成，等待审批" else "本单已盘完")
                    loadList()
                } else {
                    locationCode = next.loc
                    qty = 1
                    feedback = Feedback(true, "${line.skuCode} 已提交")
                }
            } catch (e: Exception) {
                feedback = Feedback(false, e.message ?: "提交失败")
            } finally {
                busy = false
            }
        }
    }

    fun clearPlan() {
        plan = null
        locationCode = ""
        selectedLineId = null
        scan = ""
        PdaApp.instance.workJournal.clearActive("stocktake")
        loadList()
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
        ScanField(vm.scan, { vm.scan = it }, { vm.submitScan() }, tr("scan_stocktake"), enabled = !vm.busy)
        FeedbackBar(vm.feedback)
        val plan = vm.plan
        if (plan == null) {
            Text("待作业", color = PdaMuted, fontSize = 13.sp)
            if (vm.list.isEmpty()) Text("暂无盘点任务，可直接扫描盘点单号", color = PdaMuted, fontSize = 13.sp)
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
                TextButton(onClick = { vm.clearPlan() }) { Text("换单", color = PdaAccent) }
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
                    sku = line.skuCode,
                    progress = progress,
                    done = !line.isOpen,
                    selected = line.id == vm.selectedLineId,
                    onClick = {
                        vm.selectedLineId = line.id
                        vm.locationCode = line.loc
                        vm.qty = 1
                    },
                ) {
                    Text("库位 ${line.loc}", color = PdaText, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                    if (!plan.blindCount) Text("账面 ${line.bookQty ?: 0}", color = PdaMuted, fontSize = 12.sp)
                    Text(stocktakeStatusLabel(line.statusKey), color = PdaMuted, fontSize = 12.sp)
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
                BigButton("提交实盘", onClick = { vm.submitCount() }, enabled = !vm.busy, color = PdaOk)
            }
        }
    }
}
