package com.takealot.pda.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.takealot.pda.PdaApp
import com.takealot.pda.data.Warehouse
import com.takealot.pda.ui.theme.PdaAccent
import com.takealot.pda.ui.theme.PdaMuted
import com.takealot.pda.ui.theme.PdaSurface
import com.takealot.pda.ui.theme.PdaSurface2
import com.takealot.pda.ui.theme.PdaText

@Composable
fun HomeScreen(onInbound: (String) -> Unit, onOutbound: (String) -> Unit, onSettings: () -> Unit) {
    val session = PdaApp.instance.session
    val api = PdaApp.instance.api
    var warehouses by remember { mutableStateOf<List<Warehouse>>(emptyList()) }
    var menuOpen by remember { mutableStateOf(false) }
    var warehouseCode by remember { mutableStateOf(session.warehouseCode) }

    LaunchedEffect(Unit) {
        runCatching { api.warehouses("overseas") }.onSuccess { list ->
            warehouses = list
            if (warehouseCode.isBlank() && list.isNotEmpty()) {
                session.warehouseCode = list.first().code
                session.warehouseName = list.first().title
                warehouseCode = list.first().code
            }
        }
    }

    val currentWh = warehouses.find { it.code == warehouseCode }
    val whLabel = currentWh?.let { "${it.title} (${it.code})" } ?: warehouseCode.ifBlank { "未选择仓库" }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Column {
                Text("你好，${session.realName.ifBlank { session.username }}", color = PdaText, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
                Text("轻量仓库作业", color = PdaMuted, fontSize = 13.sp)
            }
            TextButton(onClick = onSettings) { Text("设置", color = PdaAccent) }
        }
        Column {
            Text("作业仓库", color = PdaMuted, fontSize = 12.sp)
            Text(whLabel, color = PdaText, fontSize = 16.sp, modifier = Modifier.fillMaxWidth().background(PdaSurface, RoundedCornerShape(10.dp)).clickable { menuOpen = true }.padding(14.dp))
            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                warehouses.forEach { wh ->
                    DropdownMenuItem(text = { Text("${wh.title} (${wh.code})") }, onClick = {
                        session.warehouseCode = wh.code
                        session.warehouseName = wh.title
                        warehouseCode = wh.code
                        menuOpen = false
                    })
                }
            }
        }
        Text("入库", color = PdaMuted, fontSize = 13.sp, modifier = Modifier.padding(top = 8.dp))
        WorkTile("到仓扫描", "扫入库单 / 跟踪号", session.hasPerm("inbound.arrival_scan")) { onInbound("arrival") }
        WorkTile("扫箱收货", "扫外箱标或 SKU", session.hasPerm("inbound.receive")) { onInbound("receive") }
        WorkTile("清点", "扫 SKU 累加实收", session.hasPerm("inbound.qc")) { onInbound("qc") }
        WorkTile("上架", "扫 SKU 再扫库位", session.hasPerm("inbound.putaway")) { onInbound("putaway") }
        Text("出库", color = PdaMuted, fontSize = 13.sp, modifier = Modifier.padding(top = 8.dp))
        WorkTile("拣货", "扫出库单，按库位拣货", session.hasPerm("outbound.pick")) { onOutbound("pick") }
        WorkTile("复核", "扫 SKU 核对后提交", session.hasPerm("outbound.pack")) { onOutbound("review") }
    }
}

@Composable
private fun WorkTile(title: String, subtitle: String, enabled: Boolean, onClick: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().height(76.dp).background(if (enabled) PdaSurface else PdaSurface2, RoundedCornerShape(12.dp)).clickable(enabled = enabled, onClick = onClick).padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Text(title, color = if (enabled) PdaText else PdaMuted, fontSize = 18.sp, fontWeight = FontWeight.Medium)
        Text(if (enabled) subtitle else "无权限", color = PdaMuted, fontSize = 13.sp)
    }
}
