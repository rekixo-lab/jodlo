package com.rekixo.jodlo

import androidx.compose.runtime.Composable
import com.rekixo.jodlo.core.network.AccountPrivateReadMarker
import com.rekixo.jodlo.core.network.InMemorySessionCoordinator
import com.rekixo.jodlo.core.network.PlayMinutePackCatalog

/** Normal Android APK: no Play Billing dependency, no restore UI,
 * no Play connection and no receipt processing. This tiny type-compatible
 * seam prevents fragile reflection, fake Google data or duplicate screens. */
@Composable
internal fun PlayRestoreAccountDiagnostic(
    session: InMemorySessionCoordinator,
    owner: AccountPrivateReadMarker,
    catalog: PlayMinutePackCatalog,
    accountBusy: Boolean,
) = Unit
