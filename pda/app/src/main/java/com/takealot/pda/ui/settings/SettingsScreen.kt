package com.takealot.pda.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.takealot.pda.PdaApp
import com.takealot.pda.scan.ScanDiagnostics
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
    val scanTimings by ScanDiagnostics.scans.collectAsState()
    val requestTimings by ScanDiagnostics.requests.collectAsState()
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(tr("settings"), color = PdaText, fontSize = 22.sp)
        Panel {
            Text(tr("language"), color = PdaText, fontSize = 16.sp)
            LanguageSwitcher()
        }
        Panel {
            KeyValue(tr("account"), session.realName.ifBlank { session.username })
            KeyValue(tr("username"), session.username)
            KeyValue("账号工位", session.userWorkstation.ifBlank { "未绑定" })
            BigButton(tr("logout"), onClick = { session.logout(); onLogout() }, color = PdaErr)
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
                Text("正式环境：${com.takealot.pda.data.SessionStore.PRODUCTION_API_BASE}", color = PdaMuted, fontSize = 12.sp)
                Text("局域网地址（192.168…）海外仓连不上，会自动改回正式服务器。", color = PdaMuted, fontSize = 12.sp)
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
        Panel {
            Text("扫码性能诊断", color = PdaText, fontSize = 16.sp)
            val latest = scanTimings.lastOrNull()
            if (latest == null) Text("本次启动尚无扫码样本", color = PdaMuted, fontSize = 12.sp)
            else {
                KeyValue("最近扫码环节", "${latest.module} · ${latest.mode}")
                KeyValue("排队 / 处理", "${latest.queueMs} / ${latest.processingMs} ms")
                val recent = scanTimings.takeLast(20)
                KeyValue("最近 ${recent.size} 次平均", "排队 ${recent.map { it.queueMs }.average().toLong()} ms · 处理 ${recent.map { it.processingMs }.average().toLong()} ms")
            }
            requestTimings.lastOrNull()?.let {
                KeyValue("最近接口", it.path)
                KeyValue("日志落盘 / 接口解析", "${it.journalMs} / ${it.requestMs} ms")
            }
            Text("仅记录本次启动的耗时，不记录条码或账号密钥；接口耗时包含网络、服务器及响应解析。", color = PdaMuted, fontSize = 12.sp)
        }
        BigButton(tr("back"), onClick = onBack, color = PdaMuted)
    }
}
