package com.rekixo.jodlo

import android.graphics.Bitmap
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import com.rekixo.jodlo.core.network.ApiOutcome
import com.rekixo.jodlo.core.network.CustomerServiceCard
import com.rekixo.jodlo.core.network.RemoteCatalogRepository
import com.rekixo.jodlo.ui.theme.JodloTextAction
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

@Composable
internal fun ApprovedServicePhoto(
    repository: RemoteCatalogRepository?,
    card: CustomerServiceCard,
    checkedDetailRevision: Int,
) {
    if (repository == null || !card.hasPhoto) return
    // The exact public detail is revalidated on explicit Customer request.
    // An older approved photo must never survive that recheck merely because
    // the Listing ID/city stayed the same. Failed reads also stay scoped to it.
    var bitmap by remember(repository, card.listing, card.city, checkedDetailRevision) {
        mutableStateOf<Bitmap?>(null)
    }
    var busy by remember(repository, card.listing, card.city, checkedDetailRevision) {
        mutableStateOf(false)
    }
    var failed by remember(repository, card.listing, card.city, checkedDetailRevision) {
        mutableStateOf(false)
    }

    var open by remember(repository, card.listing, card.city, checkedDetailRevision) {
        mutableStateOf(false)
    }

    JodloTextAction(onClick = { open = true }, modifier = Modifier.fillMaxWidth()) {
        Text(stringResource(R.string.service_photo_view))
    }
    if (open) {
        LaunchedEffect(repository, card.listing, card.city, checkedDetailRevision) {
            busy = true
            failed = false
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
        ServiceDetailView(stringResource(R.string.navigation_service_photo), close = {
            bitmap = null
            failed = false
            open = false
        }) {
            if (busy) CircularProgressIndicator()
            bitmap?.let { ServicePhotoImage(it) }
            if (failed) Text(stringResource(R.string.service_photo_unavailable),
                color = MaterialTheme.colorScheme.error)
        }
    }
}
