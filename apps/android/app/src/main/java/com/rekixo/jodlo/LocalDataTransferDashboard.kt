package com.rekixo.jodlo

import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import com.rekixo.jodlo.core.network.HiddenPublicServices
import com.rekixo.jodlo.core.network.LocalPublicServiceBackup
import com.rekixo.jodlo.core.network.SavedPublicServices
import com.rekixo.jodlo.ui.theme.JodloButton
import com.rekixo.jodlo.ui.theme.JodloCard
import com.rekixo.jodlo.ui.theme.JodloSizes
import com.rekixo.jodlo.ui.theme.JodloTextAction
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** User-operated backup/restore for device-only public references.
 *
 * No account, automatic cloud upload, server, secret, provider identity,
 * cached URI, background poll or automatic mutation. Import first PREVIEWS
 * strict validated counts. Each explicit Merge applies to ONE already local
 * private preference with a durable commit, avoiding half-transaction claims.
 */
@Composable
internal fun LocalDataTransferDashboard(
    activity: ComponentActivity,
    saved: SavedPublicServices,
    hidden: HiddenPublicServices,
    onApplySaved: (SavedPublicServices) -> Boolean,
    onApplyHidden: (HiddenPublicServices) -> Boolean,
    onHome: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var notice by remember { mutableIntStateOf(0) }
    var preview by remember { mutableStateOf<LocalPublicServiceBackup?>(null) }
    var pendingExport by remember { mutableStateOf<LocalPublicServiceBackup?>(null) }

    val exportPicker = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("application/json"),
    ) { uri ->
        val snapshot = pendingExport
        pendingExport = null
        when {
            uri == null -> notice = R.string.local_backup_cancelled
            snapshot == null || snapshot.saved != saved || snapshot.hidden != hidden ->
                notice = R.string.local_backup_changed
            else -> {
                busy = true
                notice = 0
                scope.launch {
                    val ok = withContext(Dispatchers.IO) {
                        LocalPortableFileIO.write(activity.contentResolver, uri, snapshot)
                    }
                    busy = false
                    notice = if (ok) R.string.local_backup_export_saved
                        else R.string.local_backup_export_failed
                }
            }
        }
    }
    val importPicker = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument(),
    ) { uri ->
        preview = null
        if (uri == null) {
            notice = R.string.local_backup_cancelled
        } else {
            busy = true
            notice = 0
            scope.launch {
                val result = withContext(Dispatchers.IO) {
                    LocalPortableFileIO.readBounded(activity.contentResolver, uri)
                        ?.let(LocalPublicServiceBackup::decode)
                }
                preview = result
                busy = false
                notice = if (result == null) R.string.local_backup_invalid
                    else R.string.local_backup_preview_ready
            }
        }
    }

    fun exportNow() {
        if (busy) return
        notice = 0
        pendingExport = LocalPublicServiceBackup(saved, hidden)
        // File is written ONLY when the user chooses the document destination.
        exportPicker.launch("jodlo-device-public-services.json")
    }
    fun importNow() {
        if (busy) return
        notice = 0
        preview = null
        importPicker.launch(arrayOf("application/json", "text/plain"))
    }
    fun applySaved() {
        val incoming = preview ?: return
        if (busy) return
        val merged = saved.mergeFrom(incoming.saved)
        notice = when {
            merged == null -> R.string.local_backup_merge_blocked
            merged == saved -> R.string.local_backup_no_new_entries
            onApplySaved(merged) -> R.string.local_backup_saved_merged
            else -> R.string.local_backup_merge_failed
        }
    }
    fun applyHidden() {
        val incoming = preview ?: return
        if (busy) return
        val merged = hidden.mergeFrom(incoming.hidden)
        notice = when {
            merged == null -> R.string.local_backup_merge_blocked
            merged == hidden -> R.string.local_backup_no_new_entries
            onApplyHidden(merged) -> R.string.local_backup_hidden_merged
            else -> R.string.local_backup_merge_failed
        }
    }

    BackHandler { if (!busy) onHome() }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(
            JodloSizes.ScreenPadding),
        verticalArrangement = Arrangement.spacedBy(JodloSizes.Gap),
    ) {
        item {
            Text(stringResource(R.string.local_backup_heading),
                style = MaterialTheme.typography.headlineSmall)
            Text(stringResource(R.string.local_backup_privacy),
                style = MaterialTheme.typography.bodySmall)
            Text(stringResource(R.string.local_backup_current,
                saved.entries.size, hidden.ids.size),
                style = MaterialTheme.typography.bodyMedium)
        }
        item {
            JodloCard(modifier = Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(JodloSizes.CardPadding),
                    verticalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap),
                ) {
                    Text(stringResource(R.string.local_backup_export_heading),
                        style = MaterialTheme.typography.titleMedium)
                    Text(stringResource(R.string.local_backup_export_notice),
                        style = MaterialTheme.typography.bodySmall)
                    JodloButton(onClick = ::exportNow, enabled = !busy,
                        modifier = Modifier.fillMaxWidth()) {
                        Text(stringResource(R.string.local_backup_export_action))
                    }
                }
            }
        }
        item {
            JodloCard(modifier = Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(JodloSizes.CardPadding),
                    verticalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap),
                ) {
                    Text(stringResource(R.string.local_backup_import_heading),
                        style = MaterialTheme.typography.titleMedium)
                    Text(stringResource(R.string.local_backup_import_notice),
                        style = MaterialTheme.typography.bodySmall)
                    JodloButton(onClick = ::importNow, enabled = !busy,
                        modifier = Modifier.fillMaxWidth()) {
                        Text(stringResource(R.string.local_backup_import_action))
                    }
                }
            }
        }
        val result = preview
        if (result != null) {
            item {
                JodloCard(modifier = Modifier.fillMaxWidth()) {
                    Column(
                        modifier = Modifier.padding(JodloSizes.CardPadding),
                        verticalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap),
                    ) {
                        Text(stringResource(R.string.local_backup_preview_heading),
                            style = MaterialTheme.typography.titleMedium)
                        Text(stringResource(R.string.local_backup_preview_counts,
                            result.saved.entries.size, result.hidden.ids.size))
                        Text(stringResource(R.string.local_backup_merge_notice),
                            style = MaterialTheme.typography.bodySmall)
                        val mergedSaved = saved.mergeFrom(result.saved)
                        val mergedHidden = hidden.mergeFrom(result.hidden)
                        JodloButton(onClick = ::applySaved, enabled = !busy &&
                            mergedSaved != null && mergedSaved != saved,
                            modifier = Modifier.fillMaxWidth()) {
                            Text(stringResource(R.string.local_backup_merge_saved_action))
                        }
                        JodloButton(onClick = ::applyHidden, enabled = !busy &&
                            mergedHidden != null && mergedHidden != hidden,
                            modifier = Modifier.fillMaxWidth()) {
                            Text(stringResource(R.string.local_backup_merge_hidden_action))
                        }
                        if (mergedSaved == null || mergedHidden == null) {
                            Text(stringResource(R.string.local_backup_merge_blocked),
                                color = MaterialTheme.colorScheme.error,
                                style = MaterialTheme.typography.bodySmall)
                        }
                        JodloTextAction(onClick = {
                            preview = null
                            notice = 0
                        }, enabled = !busy) {
                            Text(stringResource(R.string.local_backup_discard_preview))
                        }
                    }
                }
            }
        }
        if (busy) item { CircularProgressIndicator() }
        if (notice != 0) item {
            Text(stringResource(notice), style = MaterialTheme.typography.bodySmall)
        }
        item {
            JodloTextAction(onClick = onHome, enabled = !busy) {
                Text(stringResource(R.string.help_back_home))
            }
        }
    }
}
