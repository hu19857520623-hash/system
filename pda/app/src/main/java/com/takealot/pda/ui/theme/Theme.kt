package com.takealot.pda.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

val PdaBg = Color(0xFF111418)
val PdaSurface = Color(0xFF1C2128)
val PdaSurface2 = Color(0xFF252C36)
val PdaAccent = Color(0xFFF5A623)
val PdaOk = Color(0xFF3DDC97)
val PdaErr = Color(0xFFFF6B6B)
val PdaWarn = Color(0xFFF5C542)
val PdaMuted = Color(0xFF8B949E)
val PdaText = Color(0xFFF2F4F7)

private val colors = darkColorScheme(
    primary = PdaAccent,
    onPrimary = Color(0xFF1A1204),
    background = PdaBg,
    onBackground = PdaText,
    surface = PdaSurface,
    onSurface = PdaText,
    surfaceVariant = PdaSurface2,
    onSurfaceVariant = PdaMuted,
    error = PdaErr,
    onError = Color.White,
)

@Composable
fun PdaTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = colors,
        typography = MaterialTheme.typography.copy(
            bodyLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Normal, fontSize = 16.sp, color = PdaText),
            titleLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.SemiBold, fontSize = 22.sp, color = PdaText),
        ),
        content = content,
    )
}
