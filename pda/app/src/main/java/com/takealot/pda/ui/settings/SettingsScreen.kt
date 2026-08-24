package com.takealot.pda.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.takealot.pda.PdaApp
import com.takealot.pda.ui.components.BigButton
import com.takealot.pda.ui.components.KeyValue
import com.takealot.pda.ui.components.Panel
import com.takealot.pda.ui.components.fieldColors
import com.takealot.pda.ui.theme.PdaErr
import com.takealot.pda.ui.theme.PdaMuted
import com.takealot.pda.ui.theme.PdaText
import com.takealot.pda.ui.i18n.tr

@Composable
fun SettingsScreen(onBack: () -> Unit, onLogout: () -> Unit) {
    val session = PdaApp.instance.session
    var baseUrl by remember { mutableStateOf(session.baseUrl) }
    var warehouseCode by remember { mutableStateOf(session.warehouseCode) }
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(tr("settings"), color = PdaText, fontSize = 22.sp)
        Panel {
            KeyValue(tr("account"), session.realName.ifBlank { session.username })
            KeyValue(tr("username"), session.username)
        }
        OutlinedTextField(value = baseUrl, onValueChange = { baseUrl = it }, label = { Text(tr("server")) }, singleLine = true, colors = fieldColors())
        OutlinedTextField(value = warehouseCode, onValueChange = { warehouseCode = it }, label = { Text(tr("warehouse_code")) }, singleLine = true, colors = fieldColors())
        Text("PDA 需与后端同一局域网。后端 LISTEN_HOST 需为 0.0.0.0。", color = PdaMuted, fontSize = 12.sp)
        BigButton(
            text = tr("save"),
            onClick = {
                session.baseUrl = baseUrl
                session.warehouseCode = warehouseCode.trim()
                onBack()
            },
        )
        BigButton(tr("logout"), onClick = { session.logout(); onLogout() }, color = PdaErr)
        BigButton(tr("back"), onClick = onBack, color = PdaMuted)
    }
}
