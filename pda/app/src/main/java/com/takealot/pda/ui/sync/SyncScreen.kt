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
import com.takealot.pda.data.PdaScanRecord
import com.takealot.pda.ui.components.Feedback
import com.takealot.pda.ui.components.FeedbackBar
import com.takealot.pda.ui.components.Panel
import com.takealot.pda.ui.components.StatusChip
import com.takealot.pda.ui.theme.PdaAccent
import com.takealot.pda.ui.theme.PdaErr
import com.takealot.pda.ui.theme.PdaMuted
import com.takealot.pda.ui.theme.PdaText
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class SyncViewModel : ViewModel() {
    private val journal get() = PdaApp.instance.workJournal
    private val api get() = PdaApp.instance.api
    val records = journal.scanRecords
    var feedback by mutableStateOf<Feedback?>(null)
    var retryingId by mutableStateOf<String?>(null)

    fun retry(record: PdaScanRecord) {
        if (retryingId != null || record.state != "pending") return
        viewModelScope.launch {
            retryingId = record.id
            feedback = Feedback(false, "正在重新确认 ${record.scanCode}…", processing = true)
            try {
                when (record.retryAction) {
                    "arrival" -> api.arrivalScan(record.scanCode, record.retryExtra.orEmpty())
                    "receive_box" -> {
                        val orderId = record.orderId ?: error("记录缺少入库单")
                        try {
                            api.receiveBox(orderId, record.scanCode, record.id)
                        } catch (e: Exception) {
                            if (!e.message.orEmpty().contains("已确认")) throw e
                        }
                    }
                    "scan_qc" -> api.scanQc(
                        record.orderId ?: error("记录缺少入库单"),
                        record.scanCode,
                        record.retryQuantity ?: 1,
                        record.id,
                    )
                    "post" -> api.retryPending(record)
                    else -> error("该记录不能自动重试，请返回原任务核对后重新扫描")
                }
                journal.acknowledge(record.id, "重试成功，ERP 已确认")
                feedback = Feedback(true, "${record.scanCode} 已与 ERP 确认")
            } catch (e: Exception) {
                if (journal.isRetriable(e)) journal.retainForRetry(record.id, e.message)
                else journal.fail(record.id, e.message)
                feedback = Feedback(false, e.message ?: "重试失败")
            } finally {
                retryingId = null
            }
        }
    }

    fun dismiss(record: PdaScanRecord) {
        journal.dismiss(record.id)
    }
}

@Composable
fun SyncScreen(onBack: () -> Unit, vm: SyncViewModel = viewModel()) {
    val all by vm.records.collectAsState()
    val records = all.filter { it.state == "pending" || it.state == "failed" }.sortedByDescending { it.createdAt }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("待同步与异常记录", color = PdaText, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
            TextButton(onClick = onBack) { Text("返回", color = PdaAccent) }
        }
        Text("待同步记录可以安全重试；业务校验失败的记录请核对后关闭。", color = PdaMuted, fontSize = 13.sp)
        FeedbackBar(vm.feedback)
        if (records.isEmpty()) {
            Panel { Text("没有待处理记录", color = PdaMuted, fontSize = 14.sp) }
        }
        records.forEach { record ->
            Panel {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(record.scanCode, color = PdaText, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                    StatusChip(if (record.state == "pending") "待同步" else "失败", if (record.state == "pending") "warn" else "err")
                }
                Text("${record.module} · ${record.mode} · ${record.orderNo.orEmpty().ifBlank { "未绑定单据" }}", color = PdaMuted, fontSize = 12.sp)
                Text(SimpleDateFormat("MM-dd HH:mm:ss", Locale.getDefault()).format(Date(record.createdAt)), color = PdaMuted, fontSize = 12.sp)
                record.message?.takeIf { it.isNotBlank() }?.let { Text(it, color = PdaErr, fontSize = 13.sp) }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    if (record.state == "pending" && record.retryAction != null) {
                        TextButton(onClick = { vm.retry(record) }, enabled = vm.retryingId == null) {
                            Text("安全重试", color = PdaAccent)
                        }
                    }
                    TextButton(onClick = { vm.dismiss(record) }, enabled = vm.retryingId == null) {
                        Text("人工确认关闭", color = PdaMuted)
                    }
                }
            }
        }
    }
}
