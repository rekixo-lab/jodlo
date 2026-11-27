package com.rekixo.jodlo

import androidx.compose.runtime.Composable
import com.rekixo.jodlo.core.network.AccountPrivateReadMarker
import com.rekixo.jodlo.core.network.InMemorySessionCoordinator
import com.rekixo.jodlo.core.network.PlayMinutePackCatalog
import com.rekixo.jodlo.core.network.PlayPurchaseSettlement

/** Default builds have no Play SDK, connection or checkout surface. */
@Composable
internal fun PlayMinutePurchaseSection(
    session: InMemorySessionCoordinator,
    owner: AccountPrivateReadMarker,
    catalog: PlayMinutePackCatalog,
    accountBusy: Boolean,
    onSettlementAttemptFinished: (PlayPurchaseSettlement?) -> Unit,
) = Unit
