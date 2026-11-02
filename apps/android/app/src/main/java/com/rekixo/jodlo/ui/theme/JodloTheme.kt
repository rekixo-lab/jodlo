package com.rekixo.jodlo.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// A single provisional visual direction, subject to actual founder screen review.
// Never scatter raw palette values throughout feature Composables.
private val LightColors = lightColorScheme(
    primary = Color(0xFF006A60),
    onPrimary = Color(0xFFFFFFFF),
    secondary = Color(0xFF46665F),
    background = Color(0xFFF7FAF8),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF18211E),
)
private val DarkColors = darkColorScheme(
    primary = Color(0xFF77DCCC),
    onPrimary = Color(0xFF00382F),
    secondary = Color(0xFFADCEC5),
    background = Color(0xFF101815),
    surface = Color(0xFF18221E),
    onSurface = Color(0xFFDEE7E1),
)

@Composable
fun JodloTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (isSystemInDarkTheme()) DarkColors else LightColors,
        content = content,
    )
}
