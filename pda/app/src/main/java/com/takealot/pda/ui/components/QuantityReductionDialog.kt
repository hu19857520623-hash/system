package com.takealot.pda.ui.components

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.takealot.pda.ui.theme.*

@Composable
fun QuantityReductionDialog(label: String, current: Int, unit: String = "件", note: String = "", busy: Boolean, onDismiss: () -> Unit, onConfirm: (Int, String) -> Unit) {
    var draft by remember { mutableStateOf("1") }
    var reason by remember { mutableStateOf("") }
    val quantity = draft.toIntOrNull()
    Dialog(onDismissRequest = { if (!busy) onDismiss() }, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        BoxWithConstraints(Modifier.fillMaxWidth().imePadding().padding(horizontal = 16.dp, vertical = 24.dp)) {
            Surface(Modifier.fillMaxWidth().heightIn(max = maxHeight), shape = RoundedCornerShape(16.dp), color = PdaSurface) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("减少已记录数量", color = PdaWarn, fontSize = 20.sp)
                    Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(label, color = PdaText)
                        Text("当前 $current $unit", color = PdaText)
                        if (note.isNotBlank()) Text(note, color = PdaWarn, fontSize = 13.sp)
                        OutlinedTextField(draft, { draft = it.filter(Char::isDigit).take(6) }, label = { Text("减少数量（$unit）") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.fillMaxWidth(), colors = fieldColors())
                        if (quantity != null && quantity in 1..current) Text("减少后：${current - quantity} $unit", color = PdaAccent)
                        OutlinedTextField(reason, { reason = it.take(500) }, label = { Text("原因（必填）") }, minLines = 2, maxLines = 3, modifier = Modifier.fillMaxWidth(), colors = fieldColors())
                    }
                    BigButton("确认减少", enabled = !busy && quantity != null && quantity in 1..current && reason.trim().length >= 2, onClick = { onConfirm(quantity!!, reason.trim()) }, color = PdaWarn)
                    TextButton(onClick = onDismiss, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text("取消，保留原数量", color = PdaAccent) }
                }
            }
        }
    }
}
