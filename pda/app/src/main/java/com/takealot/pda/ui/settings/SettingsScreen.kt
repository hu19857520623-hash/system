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
import com.takealot.pda.ui.components.LanguageSwitcher
import com.takealot.pda.ui.components.Panel
import com.takealot.pda.ui.components.fieldColors
import com.takealot.pda.ui.theme.PdaErr
import com.takealot.pda.ui.theme.PdaMuted
import com.takealot.pda.ui.theme.PdaText
import com.takealot.pda.ui.i18n.tr

@Composable
fun SettingsScreen(onBack: () -> Unit, onLogout: () -> Unit) {
    val currentLang = PdaApp.instance.language.language
    val session = PdaApp.instance.session
    val canManageServer = session.hasPerm("inbound.handle_exception")
    var baseUrl by remember { mutableStateOf(session.baseUrl) }
    var deviceStation by remember { mutableStateOf(session.deviceWorkstation) }
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(tr("settings"), color = PdaText, fontSize = 22.sp)
        Panel {
            Text(tr("language"), color = PdaText, fontSize = 16.sp)
            LanguageSwitcher()
        }
        Panel {
            KeyValue(tr("account"), session.realName.ifBlank { session.username })
            KeyValue(tr("username"), session.username)
            KeyValue("账号工位", session.userWorkstation.ifBlank { "未绑定" })
        }
        Panel {
            Text("本机工位", color = PdaText, fontSize = 16.sp)
            OutlinedTextField(
                value = deviceStation,
                onValueChange = { deviceStation = it.take(30) },
                label = { Text("设备工位") },
                placeholder = { Text("账号工位优先，未绑定时用本机") },
                singleLine = true,
                colors = fieldColors(),
            )
            Text("共享 PDA 可在此标注工位。登录账号若已绑工位，以账号为准。", color = PdaMuted, fontSize = 12.sp)
            BigButton(
                text = tr("save"),
                onClick = {
                    session.deviceWorkstation = deviceStation
                    onBack()
                },
            )
        }
        if (canManageServer) {
            Panel {
                Text("主管设置", color = PdaText, fontSize = 16.sp)
                OutlinedTextField(value = baseUrl, onValueChange = { baseUrl = it }, label = { Text(tr("server")) }, singleLine = true, colors = fieldColors())
                Text("服务器配置影响本机所有仓储作业，请确认地址后保存。", color = PdaMuted, fontSize = 12.sp)
                BigButton(
                    text = tr("save"),
                    onClick = {
                        session.baseUrl = baseUrl
                        onBack()
                    },
                )
            }
        } else {
            Text("服务器配置仅仓库主管可查看和修改。", color = PdaMuted, fontSize = 12.sp)
        }
        BigButton(tr("logout"), onClick = { session.logout(); onLogout() }, color = PdaErr)
        BigButton(tr("back"), onClick = onBack, color = PdaMuted)
    }
}
