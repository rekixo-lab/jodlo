package com.rekixo.jodlo

import android.content.Context
import android.content.res.Configuration
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import com.rekixo.jodlo.core.network.Language
import com.rekixo.jodlo.ui.theme.JodloBrandHeading
import com.rekixo.jodlo.ui.theme.JodloButton
import com.rekixo.jodlo.ui.theme.JodloCard
import com.rekixo.jodlo.ui.theme.JodloChip
import com.rekixo.jodlo.ui.theme.JodloSizes
import com.rekixo.jodlo.ui.theme.JodloTextAction
import java.util.Locale

internal val LocalJodloLanguage = compositionLocalOf { Language.HI }

@Composable
internal fun JodloLanguage(
    context: Context,
    content: @Composable (firstRun: Boolean, choose: (Language) -> Unit) -> Unit,
) {
    val settings = remember(context) { context.getSharedPreferences("jodlo_appearance", Context.MODE_PRIVATE) }
    val saved = remember(settings) { settings.getString("language", null) }
    val systemConfiguration = LocalConfiguration.current
    var language by remember(settings) {
        mutableStateOf(when (saved) {
            "hi" -> Language.HI
            "en" -> Language.EN
            else -> if (systemConfiguration.locales[0].language == "en") Language.EN else Language.HI
        })
    }
    val localized = remember(context, systemConfiguration, language) {
        val override = Configuration(systemConfiguration)
        override.setLocale(Locale.forLanguageTag(if (language == Language.HI) "hi" else "en"))
        context.createConfigurationContext(override)
    }
    CompositionLocalProvider(
        LocalContext provides localized,
        LocalConfiguration provides localized.resources.configuration,
        LocalJodloLanguage provides language,
    ) {
        content(saved == null) { choice ->
            language = choice
            settings.edit().putString("language", if (choice == Language.HI) "hi" else "en").apply()
        }
    }
}

@Composable
internal fun WelcomeScreen(
    chooseLanguage: (Language) -> Unit,
    openHome: () -> Unit,
    openAccount: () -> Unit,
) {
    val language = LocalJodloLanguage.current
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())
        .padding(JodloSizes.ScreenPadding),
        verticalArrangement = Arrangement.spacedBy(JodloSizes.Gap, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        JodloBrandHeading(stringResource(R.string.app_name))
        Text(stringResource(R.string.home_heading), style = MaterialTheme.typography.headlineLarge)
        Row(horizontalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap)) {
            JodloChip(language == Language.HI, { chooseLanguage(Language.HI) },
                { Text(stringResource(R.string.language_hindi)) })
            JodloChip(language == Language.EN, { chooseLanguage(Language.EN) },
                { Text(stringResource(R.string.language_english)) })
        }
        JodloButton(openHome, Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.navigation_browse_guest))
        }
        JodloTextAction(openAccount, Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.google_sign_in))
        }
    }
}

@Composable
internal fun CallAlertsScreen(openSettings: () -> Unit) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())
        .padding(JodloSizes.ScreenPadding),
        verticalArrangement = Arrangement.spacedBy(JodloSizes.Gap),
    ) {
        JodloCard(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(JodloSizes.CardPadding),
                verticalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap),
            ) {
                Text(stringResource(R.string.navigation_no_pending_alert),
                    style = MaterialTheme.typography.titleMedium)
                Text(stringResource(R.string.navigation_alert_hint),
                    style = MaterialTheme.typography.bodySmall)
            }
        }
        JodloButton(openSettings, Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.navigation_call_account))
        }
    }
}
