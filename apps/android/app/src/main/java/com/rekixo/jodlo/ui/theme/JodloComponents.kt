package com.rekixo.jodlo.ui.theme

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedIconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import com.rekixo.jodlo.R

@Composable
internal fun JodloBrandHeading(title: String) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap),
    ) {
        Image(
            painter = painterResource(R.drawable.jodlo_mark),
            contentDescription = null,
            modifier = Modifier.size(JodloSizes.BrandMark),
        )
        Text(title, style = MaterialTheme.typography.headlineLarge)
    }
}

/** Shared JODLO flat outlined buttons. Deliberately no filled Material CTA. */
@Composable
fun JodloButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    content: @Composable RowScope.() -> Unit,
) {
    OutlinedButton(
        onClick = onClick,
        modifier = modifier.defaultMinSize(minHeight = JodloSizes.MinTouch),
        enabled = enabled,
        shape = RoundedCornerShape(JodloSizes.ActionRadius),
        border = BorderStroke(JodloSizes.Stroke, if (enabled)
            JodloPalette.AccentOutline else JodloPalette.Outline),
        colors = ButtonDefaults.outlinedButtonColors(
            containerColor = JodloPalette.Canvas,
            contentColor = JodloPalette.Text,
            disabledContainerColor = JodloPalette.Canvas,
            disabledContentColor = JodloPalette.MutedText,
        ),
        content = content,
    )
}

/** Secondary controls still use the same outline grammar and touch target. */
@Composable
fun JodloTextAction(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    content: @Composable RowScope.() -> Unit,
) {
    OutlinedButton(
        onClick = onClick,
        modifier = modifier.defaultMinSize(minHeight = JodloSizes.MinTouch),
        enabled = enabled,
        shape = RoundedCornerShape(JodloSizes.ActionRadius),
        border = BorderStroke(JodloSizes.Stroke, JodloPalette.Outline),
        contentPadding = PaddingValues(horizontal = JodloSizes.CardPadding, vertical = 4.dp),
        colors = ButtonDefaults.outlinedButtonColors(
            containerColor = JodloPalette.Canvas,
            contentColor = JodloPalette.Text,
            disabledContainerColor = JodloPalette.Canvas,
            disabledContentColor = JodloPalette.MutedText,
        ),
        content = content,
    )
}

/** Exactly one quiet hairline, no shadow and no raised card surface. */
@Composable
fun JodloCard(
    modifier: Modifier = Modifier,
    selected: Boolean = false,
    onClick: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val border = BorderStroke(
        JodloSizes.Stroke,
        if (selected) JodloPalette.AccentOutline else JodloPalette.Outline,
    )
    val colors = CardDefaults.outlinedCardColors(containerColor = JodloPalette.Surface)
    val elevation = CardDefaults.outlinedCardElevation(defaultElevation = 0.dp)
    if (onClick == null) {
        OutlinedCard(
            modifier = modifier,
            shape = RoundedCornerShape(JodloSizes.CardRadius),
            border = border,
            colors = colors,
            elevation = elevation,
            content = content,
        )
    } else {
        OutlinedCard(
            onClick = onClick,
            modifier = modifier,
            shape = RoundedCornerShape(JodloSizes.CardRadius),
            border = border,
            colors = colors,
            elevation = elevation,
            content = content,
        )
    }
}

/** Dark chips have visible green text AND a thin accent stroke when selected. */
@Composable
fun JodloChip(
    selected: Boolean,
    onClick: () -> Unit,
    label: @Composable () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    FilterChip(
        selected = selected,
        onClick = onClick,
        label = label,
        modifier = modifier.defaultMinSize(minHeight = JodloSizes.MinTouch),
        enabled = enabled,
        shape = RoundedCornerShape(JodloSizes.CardRadius),
        border = BorderStroke(JodloSizes.Stroke,
            if (selected) JodloPalette.AccentOutline else JodloPalette.Outline),
        colors = FilterChipDefaults.filterChipColors(
            containerColor = JodloPalette.Surface,
            labelColor = JodloPalette.Text,
            selectedContainerColor = JodloPalette.Surface,
            selectedLabelColor = JodloPalette.Accent,
        ),
    )
}

/** One border/field treatment across Customer, Worker and future forms. */
@Composable
fun JodloSearchField(
    value: String,
    onValueChange: (String) -> Unit,
    label: @Composable () -> Unit,
    modifier: Modifier = Modifier,
    singleLine: Boolean = true,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = label,
        modifier = modifier,
        singleLine = singleLine,
        shape = RoundedCornerShape(JodloSizes.CardRadius),
        colors = OutlinedTextFieldDefaults.colors(
            focusedTextColor = JodloPalette.Text,
            unfocusedTextColor = JodloPalette.Text,
            focusedContainerColor = JodloPalette.Canvas,
            unfocusedContainerColor = JodloPalette.Canvas,
            focusedBorderColor = JodloPalette.AccentOutline,
            unfocusedBorderColor = JodloPalette.Outline,
            focusedLabelColor = JodloPalette.Accent,
            unfocusedLabelColor = JodloPalette.MutedText,
            cursorColor = JodloPalette.Accent,
        ),
    )
}

/** Square outlines match the user-supplied call/chat/grid icon reference.
 * Only attach an actual icon and action to this once a capability is working;
 * disabled controls must never pretend that calls or messaging are live.
 */
@Composable
fun JodloSquareAction(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    content: @Composable () -> Unit,
) {
    OutlinedIconButton(
        onClick = onClick,
        modifier = modifier.defaultMinSize(
            minWidth = JodloSizes.MinTouch, minHeight = JodloSizes.MinTouch,
        ),
        enabled = enabled,
        shape = RoundedCornerShape(JodloSizes.ActionRadius),
        border = BorderStroke(JodloSizes.Stroke, JodloPalette.Outline),
        colors = androidx.compose.material3.IconButtonDefaults.outlinedIconButtonColors(
            containerColor = JodloPalette.Surface,
            contentColor = JodloPalette.Text,
            disabledContainerColor = JodloPalette.Surface,
            disabledContentColor = JodloPalette.MutedText,
        ),
        content = content,
    )
}
