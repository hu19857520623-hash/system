package com.takealot.pda.ui.home

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.takealot.pda.PdaApp
import com.takealot.pda.data.Warehouse
import com.takealot.pda.ui.components.LanguageSwitcher
import com.takealot.pda.scan.ScanBus
import com.takealot.pda.ui.i18n.tr
import com.takealot.pda.ui.theme.PdaAccent
import com.takealot.pda.ui.theme.PdaMuted
import com.takealot.pda.ui.theme.PdaInbound
import com.takealot.pda.ui.theme.PdaErr
import com.takealot.pda.ui.theme.PdaOk
import com.takealot.pda.ui.theme.PdaOutbound
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
    val networkOnline = rememberNetworkOnline()
    val scannerReady by ScanBus.receiverActive.collectAsState()

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

    val currentLang = PdaApp.instance.language.language
    val currentWh = warehouses.find { it.code == warehouseCode }
    val whLabel = currentWh?.let { "${it.title} (${it.code})" } ?: warehouseCode.ifBlank { tr("no_warehouse") }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(tr("greeting", session.realName.ifBlank { session.username }), color = PdaText, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
                Text(tr("light_work"), color = PdaMuted, fontSize = 13.sp)
            }
            TextButton(onClick = onSettings) { Text(tr("settings"), color = PdaAccent) }
        }
        LanguageSwitcher()
        Column(
            Modifier.fillMaxWidth().background(PdaSurface, RoundedCornerShape(12.dp)).border(1.dp, PdaMuted.copy(alpha = 0.25f), RoundedCornerShape(12.dp)).padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                StatusItem("仓库", whLabel, warehouseCode.isNotBlank(), Modifier.weight(1f))
                StatusItem("账号", session.username.ifBlank { "—" }, session.username.isNotBlank(), Modifier.weight(1f))
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                StatusItem("网络", if (networkOnline) "已连接" else "已断开", networkOnline, Modifier.weight(1f))
                StatusItem("扫码枪", if (scannerReady) "已就绪" else "未连接", scannerReady, Modifier.weight(1f))
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
            WorkTile(tr("resume"), "${active.orderNo} · ${active.mode}", PdaAccent, true) {
                if (active.module == "inbound") onInbound(active.mode) else onOutbound(active.mode)
            }
        }
        Text(tr("my_todo"), color = PdaMuted, fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TodoTile(tr("inbound_todo"), inboundTodo, PdaInbound, Modifier.weight(1f)) { onInbound("receive") }
            TodoTile(tr("outbound_todo"), outboundTodo, PdaOutbound, Modifier.weight(1f)) { onOutbound("pick") }
        }
        Text("${tr("inbound")} · INBOUND", color = PdaInbound, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 8.dp))
        WorkTile(tr("arrival"), tr("arrival_hint"), PdaInbound, session.hasPerm("inbound.arrival_scan") && warehouseCode.isNotBlank(), warehouseCode.isBlank()) { onInbound("arrival") }
        WorkTile(tr("receive"), tr("receive_hint"), PdaInbound, session.hasPerm("inbound.receive") && warehouseCode.isNotBlank(), warehouseCode.isBlank()) { onInbound("receive") }
        WorkTile(tr("qc"), tr("qc_hint"), PdaInbound, session.hasPerm("inbound.qc") && warehouseCode.isNotBlank(), warehouseCode.isBlank()) { onInbound("qc") }
        WorkTile(tr("putaway"), tr("putaway_hint"), PdaInbound, session.hasPerm("inbound.putaway") && warehouseCode.isNotBlank(), warehouseCode.isBlank()) { onInbound("putaway") }
        Text("${tr("outbound")} · OUTBOUND", color = PdaOutbound, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 8.dp))
        WorkTile(tr("pick"), tr("pick_hint"), PdaOutbound, session.hasPerm("outbound.pick") && warehouseCode.isNotBlank(), warehouseCode.isBlank()) { onOutbound("pick") }
        WorkTile(tr("review"), tr("review_hint"), PdaOutbound, session.hasPerm("outbound.pack") && warehouseCode.isNotBlank(), warehouseCode.isBlank()) { onOutbound("review") }
    }
}

@Composable
private fun rememberNetworkOnline(): Boolean {
    val context = LocalContext.current
    val connectivity = remember(context) {
        context.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    }
    fun currentStatus(): Boolean {
        val network = connectivity.activeNetwork ?: return false
        val capabilities = connectivity.getNetworkCapabilities(network) ?: return false
        return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }
    var online by remember(connectivity) { mutableStateOf(currentStatus()) }
    DisposableEffect(connectivity) {
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) { online = currentStatus() }
            override fun onLost(network: Network) { online = currentStatus() }
            override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
                online = capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            }
        }
        val request = NetworkRequest.Builder().addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET).build()
        runCatching { connectivity.registerNetworkCallback(request, callback) }
        onDispose { runCatching { connectivity.unregisterNetworkCallback(callback) } }
    }
    return online
}

@Composable
private fun StatusItem(label: String, value: String, healthy: Boolean, modifier: Modifier = Modifier) {
    Column(modifier.background(PdaSurface2, RoundedCornerShape(8.dp)).padding(horizontal = 10.dp, vertical = 8.dp)) {
        Text(label, color = PdaMuted, fontSize = 11.sp)
        Text(value, color = if (healthy) PdaOk else PdaErr, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
    }
}

@Composable
private fun TodoTile(title: String, count: Int, accent: androidx.compose.ui.graphics.Color, modifier: Modifier, onClick: () -> Unit) {
    Column(
        modifier.background(PdaSurface, RoundedCornerShape(12.dp)).border(1.dp, accent.copy(alpha = 0.35f), RoundedCornerShape(12.dp)).clickable(onClick = onClick).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(title, color = accent, fontSize = 12.sp, fontWeight = FontWeight.Medium)
        Text("$count", color = if (count > 0) accent else PdaText, fontSize = 24.sp, fontWeight = FontWeight.SemiBold)
        Text(if (count > 0) tr("tap_to_handle") else tr("no_todo"), color = PdaMuted, fontSize = 12.sp)
    }
}

@Composable
private fun WorkTile(title: String, subtitle: String, accent: androidx.compose.ui.graphics.Color, enabled: Boolean, needsWarehouse: Boolean = false, onClick: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().height(76.dp).background(if (enabled) PdaSurface else PdaSurface2, RoundedCornerShape(12.dp)).border(1.dp, accent.copy(alpha = if (enabled) 0.3f else 0.1f), RoundedCornerShape(12.dp)).clickable(enabled = enabled, onClick = onClick).padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Text(title, color = if (enabled) accent else PdaMuted, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
        Text(if (enabled) subtitle else if (needsWarehouse) tr("select_warehouse") else tr("no_permission"), color = PdaMuted, fontSize = 13.sp)
    }
}
