package com.takealot.pda.ui.sync

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
import androidx.compose.runtime.collectAsState
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
import com.takealot.pda.data.isAuthorizationFailure
import com.takealot.pda.data.PdaResumeWork
import com.takealot.pda.data.PdaScanRecord
import com.takealot.pda.data.syncContentMismatch
import com.takealot.pda.data.confirmsCurrentShortPick
import com.takealot.pda.data.countExitMessage
import com.takealot.pda.data.resolveSkuScan
import com.takealot.pda.ui.components.Feedback
import com.takealot.pda.ui.components.FeedbackBar
import com.takealot.pda.ui.components.Panel
import com.takealot.pda.ui.components.StatusChip
import com.takealot.pda.ui.outbound.continueAfterOutbound
import com.takealot.pda.ui.theme.PdaAccent
import com.takealot.pda.ui.theme.PdaErr
import com.takealot.pda.ui.theme.PdaMuted
import com.takealot.pda.ui.theme.PdaWarn
import com.takealot.pda.ui.theme.PdaText
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class SyncViewModel : ViewModel() {
    private val journal get() = PdaApp.instance.workJournal
    private val api get() = PdaApp.instance.api
    private val session get() = PdaApp.instance.session
    val records = journal.scanRecords
    var feedback by mutableStateOf<Feedback?>(null)
    var retryingId by mutableStateOf<String?>(null)

    fun canSee(record: PdaScanRecord) = journal.canSeeRecord(record)

    fun canReplay(record: PdaScanRecord) = journal.canReplay(record)

    fun retry(record: PdaScanRecord) {
        if (retryingId != null || journal.pendingRecords().none { it.id == record.id && it.retryAction != null }) return
        if (syncContentMismatch(record.message.orEmpty())) {
            feedback = Feedback(false, "这条记录的内容不同。请核对原单后结束本次，不要安全重试。")
            return
        }
        if (!canReplay(record)) return
        retryingId = record.id
        viewModelScope.launch {
            feedback = Feedback(false, "正在重新确认 ${record.scanCode}…", processing = true)
            try {
                var nextStep: String? = null
                api.replayAsOriginalOwner(record) {
                    when (record.retryAction) {
                        "arrival" -> {
                            val receipt = api.arrivalScan(record.scanCode, record.retryExtra.orEmpty())
                            val order = receipt.order ?: error("回执缺少入库单")
                            val mode = when {
                                order.statusKey == "pending_putaway" && session.hasPerm("inbound.putaway") -> "putaway"
                                order.statusKey in setOf("arrived", "receiving") &&
                                    (session.hasPerm("inbound.receive") || session.hasPerm("inbound.qc")) -> "receive"
                                else -> null
                            }
                            if (mode != null && order.warehouseCode == session.warehouseCode) {
                                journal.activateIfNoOtherWork(PdaResumeWork("inbound", mode, order.id, order.no))
                            }
                        }
                        "receive_box" -> {
                            val orderId = record.orderId ?: error("记录缺少入库单")
                            api.receiveBox(orderId, record.scanCode, record.id, record.orderNo, record.retryExtra)
                            nextStep = continueAfterInboundReceipt(record, orderId, boxScan = true)
                        }
                        "scan_qc", "scan_catalog_qc" -> {
                            val orderId = record.orderId ?: error("记录缺少入库单")
                            val catalogCount = record.retryAction == "scan_catalog_qc"
                            val storedCode = record.retryExtra?.takeIf { it.isNotBlank() }
                            if (catalogCount && (storedCode == null || (record.retryQuantity ?: 0) <= 0)) {
                                throw ErpException("原货盘清点请求缺少 SKU 或件数，请由主管核对", retriable = true)
                            }
                            val requestCode = storedCode ?: api.inboundDetail(orderId).resolveSkuScan(record.scanCode)
                            api.scanQc(orderId, requestCode, record.retryQuantity ?: 1, record.id,
                                catalogCount = catalogCount, orderNo = record.orderNo, expectedSku = record.retrySku)
                            nextStep = continueAfterInboundReceipt(record, orderId, skuScanMode = if (catalogCount) "catalog" else "qc")
                        }
                        "post" -> {
                            val result = api.retryPending(record)
                            val orderId = record.orderId
                            if (record.module == "inbound" && orderId != null) {
                                when (record.retryEndpoint) {
                                    "/inbound/$orderId/qc", "/inbound/$orderId/resolve-exception" ->
                                        nextStep = continueAfterInboundReceipt(record, orderId)
                                    "/inbound/$orderId/received-carton-count" ->
                                        nextStep = continueAfterInboundReceipt(record, orderId, cartonCount = true)
                                    "/inbound/$orderId/reduce-carton", "/inbound/$orderId/reduce-qc", "/inbound/$orderId/reduce-putaway" ->
                                        nextStep = continueAfterInboundReceipt(record, orderId, reduction = record.retryEndpoint.substringAfterLast('-'))
                                }
                            }
                            if (record.retryEndpoint == "/inbound/catalog-bind") {
                                val order = api.catalogBindingReceipt(result, record)
                                val canContinue = session.hasPerm("inbound.arrival_scan") && session.hasPerm("inbound.qc")
                                if (canContinue) {
                                    journal.activateIfNoOtherWork(PdaResumeWork("inbound", "catalog", order.id, order.no, warehouseCode = order.warehouseCode))
                                }
                                val saved = journal.active("inbound", "catalog", order.warehouseCode.orEmpty())?.orderId == order.id
                                val continueHint = if (saved) "打开「继续未完成作业」" else "进入「货盘入库」扫描原单"
                                val warehouseHint = if (order.warehouseCode == session.warehouseCode) ""
                                    else "切换到 ${order.warehouseCode.orEmpty()} 仓后"
                                nextStep = if (canContinue) "货盘绑定已确认。请返回首页，$warehouseHint$continueHint。"
                                    else "货盘绑定已确认。当前账号缺少续作权限，请交接给有权限的人员。"
                            }
                            if (record.module == "stocktake" && orderId != null &&
                                record.retryEndpoint == "/management-loop/stocktakes/$orderId/count") {
                                val plan = api.stocktakeCountReceipt(result, record, orderId)
                                val message = plan.countExitMessage(session.userId)
                                nextStep = when {
                                    plan.warehouseCode != session.warehouseCode ->
                                        "原盘点请求已确认。请返回首页切换到 ${plan.warehouseCode}，再核对原单。"
                                    message != null -> {
                                        if (journal.active("stocktake", "count")?.orderId == orderId) {
                                            journal.clearActive("stocktake", orderId)
                                        }
                                        "原盘点请求已确认。$message。"
                                    }
                                    !session.hasPerm("stocktake.count") ->
                                        "原盘点请求已确认。请交接给有盘点权限的人员继续。"
                                    else -> {
                                        journal.activateIfNoOtherWork(PdaResumeWork("stocktake", "count", orderId, plan.no))
                                        if (journal.active("stocktake", "count")?.orderId == orderId)
                                            "原盘点请求已确认。请返回首页打开「继续未完成作业」。"
                                        else "原盘点请求已确认。请从「盘点」列表重新打开原单。"
                                    }
                                }
                            }
                            if (record.module == "inbound" && orderId != null &&
                                record.retryEndpoint == "/inbound/$orderId/putaway" &&
                                journal.active("inbound", "putaway")?.orderId == orderId) {
                                val current = try {
                                    api.inboundDetail(orderId)
                                } catch (e: kotlinx.coroutines.CancellationException) {
                                    throw e
                                } catch (_: Exception) {
                                    null
                                }
                                if (current?.id == orderId && current.statusKey in setOf("completed", "confirmed", "cancelled") &&
                                    journal.active("inbound", "putaway")?.orderId == orderId) {
                                    journal.clearActive("inbound", orderId)
                                    nextStep = "上架结果已核对，请返回首页选择下一项作业。"
                                } else if (journal.active("inbound", "putaway")?.orderId == orderId) {
                                    nextStep = "原上架请求已确认，请返回首页打开「继续未完成作业」，按最新单据继续。"
                                }
                            }
                            if (record.module == "inbound" && record.retryEndpoint?.endsWith("/report-exception") == true) {
                                nextStep = "未知条码登记已确认。请返回原清点继续作业，勿重复登记同一条码。"
                            }
                            if (record.module == "outbound" && orderId != null) {
                                val completedMode = when (record.retryEndpoint) {
                                    "/outbound/$orderId/pick" -> "pick"
                                    "/outbound/$orderId/pack" -> "review"
                                    "/outbound/$orderId/ship" -> "ship"
                                    else -> null
                                }
                                if (completedMode == "ship") {
                                    journal.completeOutboundStage(orderId, "ship")
                                    val exception = result.asJsonObject.get("status").asString == "exception"
                                    nextStep = if (exception) "原发运已确认，OMS 同步完成。单据存在异常，请联系主管核对。"
                                    else "原发运已确认，OMS 同步完成。请返回首页选择下一项作业。"
                                } else if (completedMode != null) {
                                    val confirmed = when (completedMode) {
                                        "pick" -> "原拣货请求已确认"
                                        "review" -> "原复核请求已确认"
                                        else -> "原出库作业已确认"
                                    }
                                    nextStep = continueAfterOutbound(orderId, completedMode, confirmed)
                                }
                                if (record.retryEndpoint == "/outbound/$orderId/problem" && result.confirmsCurrentShortPick(record)) {
                                    journal.completeOutboundStage(orderId, "pick")
                                    nextStep = "短拣已登记并转交主管处理，请返回首页选择下一项作业。"
                                }
                            }
                        }
                        else -> error("该记录不能自动重试，请返回原任务核对后重新扫描")
                    }
                }
                journal.acknowledge(record.id, "重试成功，ERP 已确认")
                feedback = Feedback(true, nextStep ?: "${record.scanCode} 已与 ERP 确认")
            } catch (e: Exception) {
                val message = if (e is ErpException) e.message.orEmpty() else "暂时无法核对原请求，请检查网络后重试"
                val retryable = journal.isRetriable(e) || (e is ErpException && e.isAuthorizationFailure)
                if (retryable) journal.retainForRetry(record.id, message)
                else journal.fail(record.id, message)
                feedback = Feedback(false, message)
            } finally {
                retryingId = null
            }
        }
    }

    private suspend fun continueAfterInboundReceipt(
        record: PdaScanRecord, orderId: Int, cartonCount: Boolean = false, skuScanMode: String? = null, boxScan: Boolean = false, reduction: String? = null,
    ): String {
        val confirmed = when {
            record.mode == "resolve_exception" -> "原异常放行已确认"
            reduction != null -> "原减少数量请求已确认"
            boxScan -> "原箱唛收货已确认"
            cartonCount -> "原实收箱数请求已确认"
            skuScanMode != null -> "原扫码件数已确认"
            else -> "原清点请求已确认"
        }
        val order = try {
            api.inboundDetail(orderId)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            return "$confirmed。暂未读到单据最新状态，请返回首页，从原作业刷新单据后继续。"
        }
        val warehouse = order.warehouseCode
        if (order.id != orderId || order.no.isBlank() ||
            (!record.orderNo.isNullOrBlank() && order.no != record.orderNo) || warehouse.isNullOrBlank()) {
            return "$confirmed。暂无法核对原单及所属仓库，请返回首页，从原作业刷新单据。"
        }
        if (warehouse != session.warehouseCode) {
            return "$confirmed。请返回首页切换到 $warehouse，再核对单据最新进度。"
        }
        if ((boxScan || reduction == "carton") && order.statusKey in setOf("arrived", "receiving")) {
            if (!session.hasPerm("inbound.receive") && !session.hasPerm("inbound.qc")) {
                return "$confirmed。请交接给有相应入库权限的人员。"
            }
            val saved = journal.reconcileInboundResume(orderId, order.no, "receive")
            return if (saved) "$confirmed。请返回首页打开「继续未完成作业」，核对实收箱数。"
            else "$confirmed。请从首页进入「确认箱数」并扫描原单。"
        }
        if ((cartonCount || skuScanMode != null || reduction == "qc") && order.statusKey in setOf("arrived", "receiving")) {
            val catalog = skuScanMode == "catalog" || ((cartonCount || reduction == "qc") &&
                journal.active("inbound", "catalog")?.orderId == orderId)
            if (!session.hasPerm("inbound.qc") || (catalog && !session.hasPerm("inbound.arrival_scan"))) {
                return "$confirmed。请交接给有相应入库权限的人员。"
            }
            if (!catalog && order.cartonBlockMessage != null) {
                return "$confirmed。请从首页返回「确认箱数」核对最新进度：${order.cartonBlockMessage}"
            }
            val saved = journal.reconcileInboundResume(orderId, order.no, if (catalog) "catalog" else "qc")
            return if (saved) "$confirmed。请返回首页打开「继续未完成作业」进入清点。"
            else "$confirmed。请从首页进入「${if (catalog) "货盘入库" else "清点"}」并扫描原单。"
        }
        return when (order.statusKey) {
            "pending_putaway" -> if (session.hasPerm("inbound.putaway")) {
                val saved = journal.reconcileInboundResume(orderId, order.no, "putaway")
                if (saved) "$confirmed。请返回首页打开「继续未完成作业」，进入上架。"
                else "$confirmed。请从首页进入「上架」并选择原单。"
            } else {
                journal.reconcileInboundResume(orderId, order.no, null)
                "$confirmed。单据已待上架，请交接给有上架权限的人员。"
            }
            "completed", "confirmed", "cancelled" -> {
                journal.reconcileInboundResume(orderId, order.no, null)
                "$confirmed。单据当前为「${order.statusText}」，请返回首页选择下一项作业。"
            }
            "exception" -> "$confirmed。单据存在异常，请联系主管核对放行，再进入上架。"
            else -> "$confirmed。请返回首页，从原作业核对最新状态后继续。"
        }
    }

    fun dismiss(record: PdaScanRecord) {
        if (retryingId != null) return
        if (!journal.dismiss(record.id)) feedback = Feedback(false, "原请求结果待确认，请安全重试后继续")
    }
}

@Composable
fun SyncScreen(onBack: () -> Unit, vm: SyncViewModel = viewModel()) {
    val all by vm.records.collectAsState()
    val records = all.filter { vm.canSee(it) && (it.state == "pending" || it.state == "failed") }.sortedByDescending { it.createdAt }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("待同步与异常记录", color = PdaText, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
            TextButton(onClick = onBack) { Text("返回", color = PdaAccent) }
        }
        Text("有原请求且账号匹配时可安全重试。其余记录请按提示人工核对。", color = PdaMuted, fontSize = 13.sp)
        FeedbackBar(vm.feedback)
        if (records.isEmpty()) {
            Panel { Text("没有待处理记录", color = PdaMuted, fontSize = 14.sp) }
        }
        records.forEach { record ->
            val mismatch = syncContentMismatch(record.message.orEmpty())
            val canRetry = record.state == "pending" && record.retryAction != null && vm.canReplay(record) && !mismatch
            Panel {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(record.scanCode, color = PdaText, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                    val status = when {
                        record.state == "failed" -> "失败"
                        canRetry -> "待同步"
                        else -> "待人工核对"
                    }
                    StatusChip(status, if (record.state == "pending") "warn" else "err")
                }
                Text("${record.workLabel()} · ${record.orderNo.orEmpty().ifBlank { "未绑定单据" }}", color = PdaMuted, fontSize = 12.sp)
                Text(SimpleDateFormat("MM-dd HH:mm:ss", Locale.getDefault()).format(Date(record.createdAt)), color = PdaMuted, fontSize = 12.sp)
                record.message?.takeIf { it.isNotBlank() }?.let { Text(it, color = PdaErr, fontSize = 13.sp) }
                if (record.state == "pending" && record.retryAction != null && !vm.canReplay(record)) {
                    Text(if (record.ownerId == null) "历史记录缺少提交账号，请由主管在 ERP 核对原单与流水" else "请切回提交时的账号和服务器后重试", color = PdaWarn, fontSize = 13.sp)
                }
                if (record.state == "pending" && record.retryAction == null) {
                    Text("缺少可重试的请求内容，请回原作业核对单据和实际进度后再关闭。", color = PdaWarn, fontSize = 13.sp)
                }
                if (mismatch) {
                    Text("内容不同。请核对原单后结束本次，不要安全重试。", color = PdaWarn, fontSize = 13.sp)
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    if (canRetry) {
                        TextButton(onClick = { vm.retry(record) }, enabled = vm.retryingId == null) {
                            Text("安全重试", color = PdaAccent)
                        }
                    }
                    if (mismatch || record.state == "failed" || record.retryAction == null) {
                        TextButton(onClick = { vm.dismiss(record) }, enabled = vm.retryingId == null) {
                            Text(if (mismatch) "已核对记录，结束本次" else "人工确认关闭", color = PdaMuted)
                        }
                    }
                }
            }
        }
    }
}

private fun PdaScanRecord.workLabel(): String = when (module) {
    "inbound" -> when (mode) {
        "arrival" -> "电商入库"
        "receive", "carton_count_submit" -> "确认箱数"
        "qc" -> "清点数量"
        "qc_submit" -> "提交清点"
        "catalog" -> "货盘入库"
        "putaway" -> "上架"
        "measure" -> "测量商品"
        "report_exception" -> "登记入库异常"
        "resolve_exception" -> "处理入库异常"
        "reduce_carton" -> "减少箱数"
        "reduce_qc" -> "减少实收数量"
        "reduce_putaway" -> "减少上架数量"
        else -> "入库作业"
    }
    "outbound" -> when (mode) {
        "pick" -> "拣货"
        "pick_submit" -> "提交拣货"
        "review" -> "复核"
        "pack_submit" -> "提交复核"
        "ship" -> "发运"
        "ship_submit" -> "确认发运"
        "reduce_pick" -> "减少拣货数量"
        "reduce_review" -> "减少复核数量"
        "problem_stock_short" -> "登记短拣"
        "problem_barcode_issue" -> "登记条码异常"
        else -> "出库作业"
    }
    "stocktake" -> when (mode) {
        "count_submit" -> "提交盘点数量"
        "reduce_count" -> "减少盘点数量"
        else -> "盘点"
    }
    else -> "仓库作业"
}
