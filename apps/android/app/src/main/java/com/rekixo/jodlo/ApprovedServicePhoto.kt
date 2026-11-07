package com.rekixo.jodlo

import android.graphics.Bitmap
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
import com.rekixo.jodlo.core.network.ApiOutcome
import com.rekixo.jodlo.core.network.CustomerServiceCard
import com.rekixo.jodlo.core.network.RemoteCatalogRepository
import com.rekixo.jodlo.ui.theme.JodloSizes
import com.rekixo.jodlo.ui.theme.JodloTextAction
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
internal fun ApprovedServicePhoto(repository: RemoteCatalogRepository?, card: CustomerServiceCard) {
    if (repository == null || !card.hasPhoto) return
    val scope = rememberCoroutineScope()
    var bitmap by remember(repository, card.listing, card.city) { mutableStateOf<Bitmap?>(null) }
    var busy by remember(repository, card.listing, card.city) { mutableStateOf(false) }
    var failed by remember(repository, card.listing, card.city) { mutableStateOf(false) }

    Column(verticalArrangement = Arrangement.spacedBy(JodloSizes.SmallGap)) {
        if (bitmap == null) {
            JodloTextAction(onClick = {
                if (busy) return@JodloTextAction
                busy = true
                failed = false
                scope.launch {
                    try {
                        bitmap = withContext(Dispatchers.IO) {
                            when (val result = repository.publicServicePhoto(card.listing, card.city)) {
                                is ApiOutcome.Ok -> decodeServicePhoto(result.value.jpeg)
                                is ApiOutcome.Failed -> null
                            }
                        }
                        failed = bitmap == null
                    } catch (cancelled: CancellationException) {
                        throw cancelled
                    } catch (_: Exception) {
                        failed = true
                    } finally {
                        busy = false
                    }
                }
            }, enabled = !busy) { Text(stringResource(R.string.service_photo_view)) }
        }
        bitmap?.let { ServicePhotoImage(it) }
        if (failed) Text(stringResource(R.string.service_photo_unavailable), color = MaterialTheme.colorScheme.error)
    }
}
