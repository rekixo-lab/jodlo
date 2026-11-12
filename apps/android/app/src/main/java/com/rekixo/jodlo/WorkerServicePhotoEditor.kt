package com.rekixo.jodlo

import android.util.Base64
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.res.stringResource
import com.rekixo.jodlo.core.network.AccountPrivateReadMarker
import com.rekixo.jodlo.core.network.InMemorySessionCoordinator
import com.rekixo.jodlo.core.network.OwnServicePhoto
import com.rekixo.jodlo.core.network.ServicePhotoStatus
import com.rekixo.jodlo.core.network.SessionResult
import com.rekixo.jodlo.ui.theme.JodloButton
import com.rekixo.jodlo.ui.theme.JodloSizes
import com.rekixo.jodlo.ui.theme.JodloTextAction
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
internal fun WorkerServicePhotoEditor(
    activity: ComponentActivity, session: InMemorySessionCoordinator?,
    listingId: String, enabled: Boolean, onWriteFinished: (Int) -> Unit,
) {
    if (session == null) return
    val scope = rememberCoroutineScope()
    // A sign-in change must discard previous account's cached editor data.
    val sessionEpoch = session.accountExportSessionMarker()
    var loaded by remember(session, listingId, sessionEpoch) {
        mutableStateOf<Pair<AccountPrivateReadMarker, OwnServicePhoto>?>(null)
    }
    var preview by remember(session, listingId, sessionEpoch) { mutableStateOf<PreparedServicePhoto?>(null) }
    var pickerOwner by remember(session, listingId, sessionEpoch) { mutableStateOf<AccountPrivateReadMarker?>(null) }
    var export by remember(session, listingId, sessionEpoch) { mutableStateOf<Pair<AccountPrivateReadMarker, String>?>(null) }
    var removing by remember(session, listingId, sessionEpoch) { mutableStateOf(false) }
    var busy by remember(session, listingId, sessionEpoch) { mutableStateOf(false) }
    var notice by remember(session, listingId, sessionEpoch) { mutableStateOf(0) }
    val marker = session.accountPrivateReadMarker()
    val photo = loaded?.takeIf { it.first == marker }?.second

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        val owner = pickerOwner
        pickerOwner = null
        if (uri != null && owner != null && owner == session.accountPrivateReadMarker()) {
            busy = true
            notice = 0
            scope.launch {
                try {
                    val result = withContext(Dispatchers.IO) { prepareServicePhoto(activity.contentResolver, uri) }
                    if (session.accountPrivateReadMarker() == owner) preview = result
                    if (preview == null) notice = R.string.worker_photo_invalid
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (_: Exception) {
                    notice = R.string.worker_photo_invalid
                } finally {
                    busy = false
                }
            }
        }
    }
    val saveFile = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("image/jpeg")) { uri ->
        val file = export
        export = null
        if (uri != null && file != null && session.accountPrivateReadMarker() == file.first) {
            busy = true
            scope.launch {
                try {
                    val saved = withContext(Dispatchers.IO) {
                        if (session.accountPrivateReadMarker() != file.first) false
                        else activity.contentResolver.openOutputStream(uri, "wt")?.use {
                            it.write(Base64.decode(file.second, Base64.NO_WRAP))
                            true
                        } ?: false
                    }
                    notice = if (saved) R.string.worker_photo_copy_saved else R.string.worker_photo_failed
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (_: Exception) {
                    notice = R.string.worker_photo_failed
                } finally {
                    busy = false
                }
            }
        }
    }

    fun read(download: Boolean) {
        val owner = session.accountPrivateReadMarker() ?: return
        if (!enabled || busy) return
        if (!download) {
            loaded = null
            preview = null
            removing = false
        }
        busy = true
        notice = 0
        scope.launch {
            try {
                val result = withContext(Dispatchers.IO) { session.ownServicePhoto(owner, listingId, download) }
                if (result is SessionResult.Success && session.accountPrivateReadMarker() == owner) {
                    if (download) {
                        val jpeg = result.value.photo?.jpeg
                        if (jpeg != null) {
                            export = owner to jpeg
                            saveFile.launch("jodlo-service-photo.jpg")
                        } else notice = R.string.worker_photo_failed
                    } else loaded = owner to result.value
                } else notice = R.string.worker_photo_failed
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                export = null
                notice = R.string.worker_photo_failed
            } finally {
                busy = false
            }
        }
    }

    fun write(jpeg: String?) {
        val owner = session.accountPrivateReadMarker() ?: return
        val previous = loaded?.takeIf { it.first == owner }?.second ?: return
        if (!enabled || busy || previous.revision >= Int.MAX_VALUE ||
            (jpeg == null && (!removing || previous.status == ServicePhotoStatus.CLEARED))) return
        loaded = null
        preview = null
        removing = false
        busy = true
        scope.launch {
            val result = try {
                withContext(Dispatchers.IO) {
                    session.changeServicePhoto(owner, listingId, previous.revision, jpeg)
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                null
            } finally {
                busy = false
            }
            val updated = session.accountPrivateReadMarker()
            val confirmed = result is SessionResult.Success &&
                updated == owner.copy(writeRevision = owner.writeRevision + 1)
            if (session.accountExportSessionMarker() == owner.sessionGeneration) {
                onWriteFinished(when {
                    !confirmed -> R.string.worker_photo_failed
                    jpeg == null -> R.string.worker_photo_removed
                    else -> R.string.worker_photo_submitted
                })
            }
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap)) {
        val ready = enabled && !busy && pickerOwner == null && export == null
        JodloTextAction(onClick = { read(false) }, enabled = ready && marker != null) {
            Text(stringResource(R.string.worker_photo_manage))
        }
        if (photo != null) {
            Text(stringResource(when (photo.status) {
                ServicePhotoStatus.CLEARED -> R.string.worker_photo_empty
                ServicePhotoStatus.PENDING -> R.string.worker_details_pending
                ServicePhotoStatus.APPROVED -> R.string.worker_details_approved
                ServicePhotoStatus.REJECTED -> R.string.worker_photo_rejected
            }))
            Text(stringResource(R.string.worker_photo_privacy), style = MaterialTheme.typography.bodySmall)
            JodloTextAction(onClick = {
                val owner = session.accountPrivateReadMarker() ?: return@JodloTextAction
                if (loaded?.first != owner) return@JodloTextAction
                pickerOwner = owner
                preview = null
                removing = false
                picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
            }, enabled = ready && photo.revision < Int.MAX_VALUE) {
                Text(stringResource(R.string.worker_photo_choose))
            }
            preview?.let { prepared ->
                ServicePhotoImage(prepared.bitmap)
                JodloButton(onClick = { write(prepared.jpeg) }, enabled = ready) {
                    Text(stringResource(R.string.worker_photo_submit))
                }
            }
            if (photo.status != ServicePhotoStatus.CLEARED) {
                JodloTextAction(onClick = { read(true) }, enabled = ready) {
                    Text(stringResource(R.string.worker_photo_save_copy))
                }
                JodloTextAction(onClick = {
                    if (removing) write(null) else { removing = true; preview = null }
                }, enabled = ready && photo.revision < Int.MAX_VALUE) {
                    Text(stringResource(if (removing) R.string.worker_photo_confirm_remove else R.string.worker_photo_remove))
                }
                if (removing) JodloTextAction(onClick = { removing = false }, enabled = ready) {
                    Text(stringResource(R.string.guided_post_back))
                }
            }
        }
        if (notice != 0) Text(stringResource(notice))
    }
}
