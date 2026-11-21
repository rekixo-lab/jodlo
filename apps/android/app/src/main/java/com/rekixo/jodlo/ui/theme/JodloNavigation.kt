package com.rekixo.jodlo.ui.theme

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import com.rekixo.jodlo.R

internal enum class JodloDestination(val route: String, val title: Int, val icon: Int) {
    HOME("home", R.string.tab_home, R.drawable.jodlo_nav_home),
    SERVICES("feed", R.string.tab_feed, R.drawable.jodlo_nav_services),
    SAVED("saved", R.string.navigation_saved, R.drawable.jodlo_nav_saved),
    WORKER("worker", R.string.tab_worker, R.drawable.jodlo_nav_worker),
    ACCOUNT("account", R.string.tab_account, R.drawable.jodlo_nav_account),
}

@Composable
internal fun JodloNavigation(selected: JodloDestination, navigate: (JodloDestination) -> Unit) {
    HorizontalDivider(color = JodloPalette.Outline)
    Row(Modifier.fillMaxWidth().selectableGroup().padding(JodloSizes.SmallGap)) {
        for (destination in JodloDestination.entries) {
            val active = destination == selected
            val tone = if (active) JodloPalette.Accent else JodloPalette.MutedText
            Surface(
                modifier = Modifier.weight(1f),
                shape = RoundedCornerShape(JodloSizes.CardRadius),
                color = if (active) JodloPalette.ActiveSurface else JodloPalette.Canvas,
                border = if (active) BorderStroke(JodloSizes.Stroke, JodloPalette.AccentOutline) else null,
            ) {
                Column(
                    modifier = Modifier.defaultMinSize(minHeight = JodloSizes.MinTouch)
                        .selectable(active, role = Role.Tab, onClick = { navigate(destination) })
                        .padding(vertical = JodloSizes.SmallGap),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(JodloSizes.Stroke),
                ) {
                    Icon(painterResource(destination.icon), contentDescription = null,
                        modifier = Modifier.size(JodloSizes.NavigationIcon), tint = tone)
                    Text(stringResource(destination.title), textAlign = TextAlign.Center,
                        style = MaterialTheme.typography.labelSmall, color = tone)
                }
            }
        }
    }
}

@Composable
internal fun JodloAppBar(title: String?, onBack: (() -> Unit)? = null, action: @Composable () -> Unit = {}) {
    Row(
        Modifier.fillMaxWidth().background(JodloPalette.Canvas).padding(
            horizontal = JodloSizes.ScreenPadding, vertical = JodloSizes.SmallGap,
        ),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap),
    ) {
        if (onBack != null) JodloSquareAction(onClick = onBack) {
            Icon(painterResource(R.drawable.jodlo_nav_back), stringResource(R.string.guided_post_back))
        }
        Column(Modifier.weight(1f)) {
            if (title == null) JodloBrandHeading(stringResource(R.string.app_name), compact = true)
            else Text(title, style = MaterialTheme.typography.titleLarge)
        }
        action()
    }
    HorizontalDivider(color = JodloPalette.Outline)
}
