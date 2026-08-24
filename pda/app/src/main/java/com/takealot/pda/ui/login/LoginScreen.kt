package com.takealot.pda.ui.login

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.takealot.pda.PdaApp
import com.takealot.pda.data.ErpException
import com.takealot.pda.ui.components.BigButton
import com.takealot.pda.ui.components.Feedback
import com.takealot.pda.ui.components.FeedbackBar
import com.takealot.pda.ui.components.fieldColors
import com.takealot.pda.ui.theme.PdaMuted
import com.takealot.pda.ui.theme.PdaText
import com.takealot.pda.ui.i18n.tr
import kotlinx.coroutines.launch

@Composable
fun LoginScreen(onLoggedIn: () -> Unit) {
    val session = PdaApp.instance.session
    val api = PdaApp.instance.api
    var baseUrl by remember { mutableStateOf(session.baseUrl) }
    var username by remember { mutableStateOf(session.username) }
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var feedback by remember { mutableStateOf<Feedback?>(null) }
    val scope = rememberCoroutineScope()

    fun submit() {
        if (busy) return
        session.baseUrl = baseUrl
        busy = true
        feedback = null
        scope.launch {
            try {
                api.login(username.trim(), password)
                onLoggedIn()
            } catch (e: ErpException) {
                feedback = Feedback(false, e.message ?: "登录失败")
            } catch (e: Exception) {
                feedback = Feedback(false, e.message ?: "无法连接服务器")
            } finally {
                busy = false
            }
        }
    }

    Column(Modifier.fillMaxSize().padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(tr("pda_title"), color = PdaText, fontSize = 28.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 28.dp))
        Text(tr("pda_subtitle"), color = PdaMuted, fontSize = 14.sp)
        OutlinedTextField(value = baseUrl, onValueChange = { baseUrl = it }, label = { Text(tr("server")) }, singleLine = true, modifier = Modifier.padding(top = 12.dp), colors = fieldColors())
        OutlinedTextField(value = username, onValueChange = { username = it }, label = { Text(tr("username")) }, singleLine = true, colors = fieldColors())
        OutlinedTextField(value = password, onValueChange = { password = it }, label = { Text(tr("password")) }, singleLine = true, visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), colors = fieldColors())
        FeedbackBar(feedback)
        BigButton(if (busy) tr("logging_in") else tr("login"), onClick = { submit() }, enabled = !busy && username.isNotBlank() && password.isNotBlank())
        Text("真机请填局域网地址，例如 http://192.168.1.20:3000/api", color = PdaMuted, fontSize = 12.sp)
    }
}
