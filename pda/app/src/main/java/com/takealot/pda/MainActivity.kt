package com.takealot.pda

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.takealot.pda.scan.ScanBroadcastReceiver
import com.takealot.pda.ui.home.HomeScreen
import com.takealot.pda.ui.inbound.InboundScreen
import com.takealot.pda.ui.login.LoginScreen
import com.takealot.pda.ui.outbound.OutboundScreen
import com.takealot.pda.ui.settings.SettingsScreen
import com.takealot.pda.ui.theme.PdaBg
import com.takealot.pda.ui.theme.PdaTheme

class MainActivity : ComponentActivity() {
    private val scanReceiver = ScanBroadcastReceiver()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent { PdaTheme { PdaRoot() } }
    }

    override fun onResume() {
        super.onResume()
        ScanBroadcastReceiver.register(this, scanReceiver)
    }

    override fun onPause() {
        runCatching { unregisterReceiver(scanReceiver) }
        super.onPause()
    }
}

@Composable
private fun PdaRoot() {
    val session = PdaApp.instance.session
    var loggedIn by remember { mutableStateOf(session.isLoggedIn) }
    Box(Modifier.fillMaxSize().background(PdaBg).systemBarsPadding()) {
        if (!loggedIn) LoginScreen(onLoggedIn = { loggedIn = true })
        else PdaNav(onLogout = { loggedIn = false })
    }
}

@Composable
private fun PdaNav(onLogout: () -> Unit) {
    val nav = rememberNavController()
    NavHost(navController = nav, startDestination = "home") {
        composable("home") {
            HomeScreen(
                onInbound = { nav.navigate("inbound/$it") },
                onOutbound = { nav.navigate("outbound/$it") },
                onSettings = { nav.navigate("settings") },
            )
        }
        composable("inbound/{mode}", arguments = listOf(navArgument("mode") { type = NavType.StringType })) {
            InboundScreen(modeKey = it.arguments?.getString("mode") ?: "arrival", onBack = { nav.popBackStack() })
        }
        composable("outbound/{mode}", arguments = listOf(navArgument("mode") { type = NavType.StringType })) {
            OutboundScreen(modeKey = it.arguments?.getString("mode") ?: "pick", onBack = { nav.popBackStack() })
        }
        composable("settings") {
            SettingsScreen(onBack = { nav.popBackStack() }, onLogout = { nav.popBackStack(); onLogout() })
        }
    }
}
