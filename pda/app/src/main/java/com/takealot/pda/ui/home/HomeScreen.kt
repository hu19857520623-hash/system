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
import com.takealot.pda.data.AppLanguage
import com.takealot.pda.ui.i18n.tr
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
    var inboundTodo by remember { mutableStateOf(0) }
    var outboundTodo by remember { mutableStateOf(0) }
    var languageMenuOpen by remember { mutableStateOf(false) }

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

    LaunchedEffect(warehouseCode) {
        if (warehouseCode.isBlank()) return@LaunchedEffect
        runCatching {
            val inbound = listOf("arrived", "receiving", "pending_putaway", "exception").sumOf { status ->
                api.inboundList(status = status, pageSize = 100).items.orEmpty().count { it.warehouseCode == warehouseCode }
            }
            val outbound = listOf("picking", "picked", "reviewing").sumOf { status ->
                api.outboundList(status = status, warehouseCode = warehouseCode, pageSize = 100).items.orEmpty().size
            }
            inboundTodo = inbound
            outboundTodo = outbound
        }
    }

    val currentWh = warehouses.find { it.code == warehouseCode }
    val whLabel = currentWh?.let { "${it.title} (${it.code})" } ?: warehouseCode.ifBlank { tr("no_warehouse") }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Column {
                Text(tr("greeting", session.realName.ifBlank { session.username }), color = PdaText, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
                Text(tr("light_work"), color = PdaMuted, fontSize = 13.sp)
            }
            Row {
                TextButton(onClick = { languageMenuOpen = true }) { Text(PdaApp.instance.language.language.label, color = PdaAccent) }
                DropdownMenu(expanded = languageMenuOpen, onDismissRequest = { languageMenuOpen = false }) {
                    AppLanguage.entries.forEach { language ->
                        DropdownMenuItem(text = { Text(language.label) }, onClick = { PdaApp.instance.language.set(language); languageMenuOpen = false })
                    }
                }
                TextButton(onClick = onSettings) { Text(tr("settings"), color = PdaAccent) }
            }
        }
        Column {
            Text(tr("work_warehouse"), color = PdaMuted, fontSize = 12.sp)
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
        val active = PdaApp.instance.workJournal.latestActive()
        if (active != null) {
            WorkTile(tr("resume"), "${active.orderNo} · ${active.mode}", true) {
                if (active.module == "inbound") onInbound(active.mode) else onOutbound(active.mode)
            }
        }
        Text(tr("my_todo"), color = PdaMuted, fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TodoTile(tr("inbound_todo"), inboundTodo, Modifier.weight(1f)) { onInbound("receive") }
            TodoTile(tr("outbound_todo"), outboundTodo, Modifier.weight(1f)) { onOutbound("pick") }
        }
        Text(tr("inbound"), color = PdaMuted, fontSize = 13.sp, modifier = Modifier.padding(top = 8.dp))
        WorkTile(tr("arrival"), tr("arrival_hint"), session.hasPerm("inbound.arrival_scan") && warehouseCode.isNotBlank(), warehouseCode.isBlank()) { onInbound("arrival") }
        WorkTile(tr("receive"), tr("receive_hint"), session.hasPerm("inbound.receive") && warehouseCode.isNotBlank(), warehouseCode.isBlank()) { onInbound("receive") }
        WorkTile(tr("qc"), tr("qc_hint"), session.hasPerm("inbound.qc") && warehouseCode.isNotBlank(), warehouseCode.isBlank()) { onInbound("qc") }
        WorkTile(tr("putaway"), tr("putaway_hint"), session.hasPerm("inbound.putaway") && warehouseCode.isNotBlank(), warehouseCode.isBlank()) { onInbound("putaway") }
        Text(tr("outbound"), color = PdaMuted, fontSize = 13.sp, modifier = Modifier.padding(top = 8.dp))
        WorkTile(tr("pick"), tr("pick_hint"), session.hasPerm("outbound.pick") && warehouseCode.isNotBlank(), warehouseCode.isBlank()) { onOutbound("pick") }
        WorkTile(tr("review"), tr("review_hint"), session.hasPerm("outbound.pack") && warehouseCode.isNotBlank(), warehouseCode.isBlank()) { onOutbound("review") }
    }
}

@Composable
private fun TodoTile(title: String, count: Int, modifier: Modifier, onClick: () -> Unit) {
    Column(
        modifier.background(PdaSurface, RoundedCornerShape(12.dp)).clickable(onClick = onClick).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(title, color = PdaMuted, fontSize = 12.sp)
        Text("$count", color = if (count > 0) PdaAccent else PdaText, fontSize = 24.sp, fontWeight = FontWeight.SemiBold)
        Text(if (count > 0) tr("tap_to_handle") else tr("no_todo"), color = PdaMuted, fontSize = 12.sp)
    }
}

@Composable
private fun WorkTile(title: String, subtitle: String, enabled: Boolean, needsWarehouse: Boolean = false, onClick: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().height(76.dp).background(if (enabled) PdaSurface else PdaSurface2, RoundedCornerShape(12.dp)).clickable(enabled = enabled, onClick = onClick).padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Text(title, color = if (enabled) PdaText else PdaMuted, fontSize = 18.sp, fontWeight = FontWeight.Medium)
        Text(if (enabled) subtitle else if (needsWarehouse) tr("select_warehouse") else tr("no_permission"), color = PdaMuted, fontSize = 13.sp)
    }
}
