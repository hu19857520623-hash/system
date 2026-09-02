package com.takealot.pda.ui.components

import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.takealot.pda.PdaApp
import com.takealot.pda.data.AppLanguage
import com.takealot.pda.ui.theme.PdaAccent
import com.takealot.pda.ui.theme.PdaErr
import com.takealot.pda.ui.theme.PdaMuted
import com.takealot.pda.ui.theme.PdaOk
import com.takealot.pda.ui.theme.PdaSku
import com.takealot.pda.ui.theme.PdaSurface
import com.takealot.pda.ui.theme.PdaSurface2
import com.takealot.pda.ui.theme.PdaText
import com.takealot.pda.ui.theme.PdaWarn
import kotlinx.coroutines.delay

data class Feedback(val ok: Boolean, val message: String)

@Composable
fun ScanField(
    value: String, onValueChange: (String) -> Unit, onSubmit: () -> Unit,
    label: String, enabled: Boolean = true, autoFocus: Boolean = true,
) {
    val focus = remember { FocusRequester() }
    LaunchedEffect(autoFocus, enabled) {
        if (autoFocus && enabled) runCatching { focus.requestFocus() }
    }
    OutlinedTextField(
        value = value, onValueChange = onValueChange,
        modifier = Modifier.fillMaxWidth().focusRequester(focus),
        enabled = enabled, singleLine = true, label = { Text(label) },
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done, keyboardType = KeyboardType.Ascii),
        keyboardActions = KeyboardActions(onDone = { onSubmit() }),
        colors = fieldColors(),
    )
}

@Composable
fun fieldColors() = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = PdaAccent, unfocusedBorderColor = PdaMuted.copy(alpha = 0.5f),
    focusedLabelColor = PdaAccent, cursorColor = PdaAccent,
    focusedTextColor = PdaText, unfocusedTextColor = PdaText,
)

@Composable
fun LanguageSwitcher() {
    val current = PdaApp.instance.language.language
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        AppLanguage.entries.forEach { language ->
            val selected = current == language
            Box(
                Modifier.weight(1f).height(44.dp)
                    .background(if (selected) PdaAccent else PdaSurface2, RoundedCornerShape(10.dp))
                    .clickable { PdaApp.instance.language.set(language) },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    language.label,
                    color = if (selected) Color(0xFF1A1204) else PdaText,
                    fontSize = 13.sp,
                    fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                )
            }
        }
    }
}

@Composable
fun BigButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, color: Color = PdaAccent) {
    Button(
        onClick = onClick, enabled = enabled,
        modifier = modifier.fillMaxWidth().height(52.dp),
        shape = RoundedCornerShape(10.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = color, contentColor = Color(0xFF1A1204),
            disabledContainerColor = PdaSurface2, disabledContentColor = PdaMuted,
        ),
    ) { Text(text, fontSize = 16.sp) }
}

@Composable
fun FeedbackBar(feedback: Feedback?) {
    if (feedback == null) return
    val context = LocalContext.current
    LaunchedEffect(feedback.ok, feedback.message) {
        val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) (context.getSystemService(VibratorManager::class.java))?.defaultVibrator
        else context.getSystemService(Vibrator::class.java)
        val effect = if (feedback.ok) VibrationEffect.createOneShot(45, VibrationEffect.DEFAULT_AMPLITUDE)
        else VibrationEffect.createWaveform(longArrayOf(0, 80, 55, 130), -1)
        vibrator?.vibrate(effect)
        val tone = ToneGenerator(AudioManager.STREAM_NOTIFICATION, 80)
        try {
            tone.startTone(if (feedback.ok) ToneGenerator.TONE_PROP_ACK else ToneGenerator.TONE_PROP_NACK, if (feedback.ok) 90 else 180)
            delay(if (feedback.ok) 100 else 190)
        } finally {
            tone.release()
        }
    }
    Box(
        Modifier.fillMaxWidth()
            .background(if (feedback.ok) PdaOk.copy(alpha = 0.18f) else PdaErr.copy(alpha = 0.18f), RoundedCornerShape(8.dp))
            .padding(12.dp),
    ) { Text(feedback.message, color = if (feedback.ok) PdaOk else PdaErr, fontSize = 15.sp) }
}

@Composable
fun StatusChip(text: String, tone: String = "info") {
    val bg = when (tone) { "ok" -> PdaOk.copy(alpha = 0.2f); "err" -> PdaErr.copy(alpha = 0.2f); "warn" -> PdaWarn.copy(alpha = 0.2f); else -> PdaSurface2 }
    val fg = when (tone) { "ok" -> PdaOk; "err" -> PdaErr; "warn" -> PdaWarn; else -> PdaMuted }
    Text(text, color = fg, fontSize = 12.sp, modifier = Modifier.background(bg, RoundedCornerShape(6.dp)).padding(horizontal = 8.dp, vertical = 4.dp))
}

@Composable
fun Panel(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Column(modifier.fillMaxWidth().background(PdaSurface, RoundedCornerShape(12.dp)).padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { content() }
}

@Composable
fun DocumentCard(
    typeLabel: String,
    number: String,
    accent: Color,
    modifier: Modifier = Modifier,
    status: (@Composable () -> Unit)? = null,
    onClick: (() -> Unit)? = null,
    content: @Composable () -> Unit,
) {
    val clickModifier = if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier
    Row(
        modifier.fillMaxWidth()
            .background(PdaSurface, RoundedCornerShape(12.dp))
            .border(1.dp, accent.copy(alpha = 0.35f), RoundedCornerShape(12.dp))
            .then(clickModifier),
    ) {
        Box(Modifier.width(5.dp).height(96.dp).background(accent, RoundedCornerShape(topStart = 12.dp, bottomStart = 12.dp)))
        Column(Modifier.weight(1f).padding(12.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(typeLabel, color = accent, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                    Text(number, color = PdaText, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
                }
                status?.invoke()
            }
            content()
        }
    }
}

@Composable
fun SkuCard(
    sku: String,
    progress: String,
    done: Boolean,
    selected: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
    content: @Composable () -> Unit,
) {
    val borderColor = if (selected) PdaSku else PdaSku.copy(alpha = 0.22f)
    Column(
        modifier.fillMaxWidth()
            .background(if (selected) PdaSurface2 else PdaSurface, RoundedCornerShape(10.dp))
            .border(if (selected) 2.dp else 1.dp, borderColor, RoundedCornerShape(10.dp))
            .clickable(onClick = onClick)
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Column {
                Text("SKU", color = PdaSku, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                Text(sku, color = PdaText, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
            }
            StatusChip(progress, if (done) "ok" else "warn")
        }
        content()
    }
}

@Composable
fun KeyValue(label: String, value: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        Text(label, color = PdaMuted, fontSize = 13.sp)
        Text(value, color = PdaText, fontSize = 14.sp)
    }
}

@Composable
fun RowScope.QtyButton(label: String, onClick: () -> Unit) {
    Button(
        onClick = onClick, modifier = Modifier.weight(1f).height(44.dp),
        colors = ButtonDefaults.buttonColors(containerColor = PdaSurface2, contentColor = PdaText),
        shape = RoundedCornerShape(8.dp),
    ) { Text(label, fontSize = 18.sp) }
}
