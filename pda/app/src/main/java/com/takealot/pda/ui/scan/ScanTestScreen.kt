package com.takealot.pda.ui.scan

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.takealot.pda.scan.ScanBus
import com.takealot.pda.scan.ScanCodeClassifier
import com.takealot.pda.scan.ScanGuess
import com.takealot.pda.ui.components.BigButton
import com.takealot.pda.ui.components.Feedback
import com.takealot.pda.ui.components.FeedbackBar
import com.takealot.pda.ui.components.ScanField
import com.takealot.pda.ui.i18n.tr
import com.takealot.pda.ui.theme.PdaAccent
import com.takealot.pda.ui.theme.PdaMuted
import com.takealot.pda.ui.theme.PdaOk
import com.takealot.pda.ui.theme.PdaSurface
import com.takealot.pda.ui.theme.PdaSurface2
import com.takealot.pda.ui.theme.PdaText

data class ScanTestHit(val code: String, val guess: ScanGuess)

@Composable
fun ScanTestScreen(onBack: () -> Unit) {
    var scan by remember { mutableStateOf("") }
    var last by remember { mutableStateOf<ScanTestHit?>(null) }
    var history by remember { mutableStateOf<List<ScanTestHit>>(emptyList()) }
    var seen by remember { mutableStateOf(setOf<String>()) }
    var feedback by remember { mutableStateOf<Feedback?>(null) }

    fun accept(code: String) {
        val value = code.trim()
        if (value.isEmpty()) return
        val guess = ScanCodeClassifier.classify(value)
        val hit = ScanTestHit(value, guess)
        last = hit
        history = (listOf(hit) + history).take(20)
        seen = seen + guess.checkKey
        feedback = Feedback(true, "${tr(guess.titleKey)} · ${value.take(48)}")
        scan = ""
    }

    LaunchedEffect(Unit) { ScanBus.codes.collect { accept(it) } }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(tr("scan_test"), color = PdaText, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
            TextButton(onClick = onBack) { Text(tr("back"), color = PdaAccent) }
        }
        Text(tr("scan_test_hint"), color = PdaMuted, fontSize = 13.sp)
        ScanField(scan, { scan = it }, { accept(scan) }, tr("scan_test_field"))
        FeedbackBar(feedback)
        val current = last
        if (current != null) {
            Column(
                Modifier.fillMaxWidth().background(PdaSurface, RoundedCornerShape(12.dp)).padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(tr("scan_test_last"), color = PdaMuted, fontSize = 12.sp)
                Text(
                    current.code,
                    color = PdaText,
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Bold,
                    fontFamily = FontFamily.Monospace,
                )
                Text(tr(current.guess.titleKey), color = PdaAccent, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                Text(tr(current.guess.useKey), color = PdaMuted, fontSize = 13.sp)
                Text("${tr("scan_test_len")} ${current.code.length}", color = PdaMuted, fontSize = 12.sp)
            }
        }
        Text(tr("scan_test_samples"), color = PdaMuted, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
        ScanCodeClassifier.checklist.chunked(2).forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { item ->
                    Text(
                        item.sample,
                        color = PdaAccent,
                        fontSize = 12.sp,
                        fontFamily = FontFamily.Monospace,
                        modifier = Modifier
                            .weight(1f)
                            .background(PdaSurface2, RoundedCornerShape(8.dp))
                            .clickable { accept(item.sample) }
                            .padding(horizontal = 10.dp, vertical = 10.dp),
                    )
                }
                if (row.size == 1) {
                    Text("", modifier = Modifier.weight(1f))
                }
            }
        }
        Text(tr("scan_test_checklist"), color = PdaMuted, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
        ScanCodeClassifier.checklist.forEach { item ->
            val done = item.checkKey in seen
            Row(
                Modifier.fillMaxWidth().background(if (done) PdaOk.copy(alpha = 0.12f) else PdaSurface2, RoundedCornerShape(10.dp)).padding(12.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(tr(item.titleKey), color = if (done) PdaOk else PdaText, fontSize = 15.sp)
                Text(if (done) tr("scan_test_ok") else tr("scan_test_pending"), color = if (done) PdaOk else PdaMuted, fontSize = 13.sp)
            }
        }
        if (history.isNotEmpty()) {
            Text(tr("scan_test_history"), color = PdaMuted, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            history.forEach { hit ->
                Column(
                    Modifier.fillMaxWidth().border(1.dp, PdaMuted.copy(alpha = 0.25f), RoundedCornerShape(10.dp)).padding(10.dp),
                ) {
                    Text(hit.code, color = PdaText, fontFamily = FontFamily.Monospace, fontSize = 14.sp)
                    Text(tr(hit.guess.titleKey), color = PdaMuted, fontSize = 12.sp)
                }
            }
        }
        BigButton(tr("scan_test_clear"), onClick = {
            last = null
            history = emptyList()
            seen = emptySet()
            feedback = null
            scan = ""
        }, color = PdaMuted)
    }
}
