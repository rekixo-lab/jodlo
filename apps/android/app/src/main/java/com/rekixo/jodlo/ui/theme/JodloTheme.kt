package com.rekixo.jodlo.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Founder-approved 2026-11-02 reference: flat near-black, hairline charcoal
 * outlines, restrained emerald/teal accent, no gloss/blur/elevation/3D.
 * Original user screenshots remain conversation attachments; see
 * docs/UI_REFERENCE_2026-11-02.md for measured reference colors.
 */
object JodloPalette {
    val Canvas = Color(0xFF000000)
    val Surface = Color(0xFF000000)
    val Text = Color(0xFFEDEDED)
    val MutedText = Color(0xFF929292)
    val Outline = Color(0xFF262626)
    val Accent = Color(0xFF40C877)
    val AccentOutline = Color(0xFF08391A)
    val Error = Color(0xFFFF8888)
}

object JodloSizes {
    val Stroke = 1.dp
    val CardRadius = 10.dp
    val ActionRadius = 12.dp
    val ScreenPadding = 16.dp
    val CardPadding = 12.dp
    val Gap = 12.dp
    val SmallGap = 8.dp
    val BrandMark = 48.dp
    val MinTouch = 48.dp
    val CallBadge = 88.dp
    val CallWaveStroke = 4.dp
}

private val JodloDarkColors = darkColorScheme(
    primary = JodloPalette.Accent,
    onPrimary = JodloPalette.Canvas,
    secondary = JodloPalette.MutedText,
    onSecondary = JodloPalette.Text,
    background = JodloPalette.Canvas,
    onBackground = JodloPalette.Text,
    surface = JodloPalette.Surface,
    onSurface = JodloPalette.Text,
    surfaceVariant = JodloPalette.Surface,
    onSurfaceVariant = JodloPalette.MutedText,
    outline = JodloPalette.Outline,
    outlineVariant = JodloPalette.Outline,
    error = JodloPalette.Error,
    onError = JodloPalette.Canvas,
)

private val JodloShapes = Shapes(
    small = RoundedCornerShape(JodloSizes.CardRadius),
    medium = RoundedCornerShape(JodloSizes.CardRadius),
    large = RoundedCornerShape(JodloSizes.ActionRadius),
)

private val JodloTypography = Typography(
    headlineLarge = TextStyle(
        fontSize = 23.sp, lineHeight = 30.sp, fontWeight = FontWeight.Medium,
        color = JodloPalette.Text,
    ),
    headlineMedium = TextStyle(
        fontSize = 20.sp, lineHeight = 27.sp, fontWeight = FontWeight.Medium,
        color = JodloPalette.Text,
    ),
    titleLarge = TextStyle(
        fontSize = 18.sp, lineHeight = 24.sp, fontWeight = FontWeight.Medium,
        color = JodloPalette.Text,
    ),
    titleMedium = TextStyle(
        fontSize = 15.sp, lineHeight = 22.sp, fontWeight = FontWeight.Medium,
        color = JodloPalette.Text,
    ),
    bodyMedium = TextStyle(
        fontSize = 14.sp, lineHeight = 21.sp, color = JodloPalette.Text,
    ),
    bodySmall = TextStyle(
        fontSize = 12.sp, lineHeight = 18.sp, color = JodloPalette.MutedText,
    ),
    labelSmall = TextStyle(
        fontSize = 11.sp, lineHeight = 16.sp, color = JodloPalette.MutedText,
    ),
)

@Composable
fun JodloTheme(content: @Composable () -> Unit) {
    // The user approved a dark-only product identity, not automatic light mode.
    MaterialTheme(
        colorScheme = JodloDarkColors,
        shapes = JodloShapes,
        typography = JodloTypography,
        content = content,
    )
}
