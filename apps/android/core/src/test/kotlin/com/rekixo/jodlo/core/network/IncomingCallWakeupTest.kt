package com.rekixo.jodlo.core.network

private const val ID = "call_12345678"
private const val NOW = 1_700_000_000_000L

private fun testUnverifiedWakeupAdmission() {
    val valid = IncomingCallWakeup.fromPush("call_ring", ID, (NOW + 45_000).toString(), NOW)
    check(valid != null)
    check(valid.invitationId == ID && valid.remainingMs(NOW) == 45_000L)
    check(valid.remainingMs(NOW + 45_000L) == 0L)
    check(IncomingCallWakeup.fromPush("other", ID, (NOW + 10_000).toString(), NOW) == null)
    check(IncomingCallWakeup.fromPush("call_ring", "too", (NOW + 10_000).toString(), NOW) == null)
    check(IncomingCallWakeup.fromPush("call_ring", ID, "invalid", NOW) == null)
    check(IncomingCallWakeup.fromPush("call_ring", ID, null, NOW) == null)
    check(IncomingCallWakeup.fromIntent(ID, NOW, NOW) == null)
    check(IncomingCallWakeup.fromIntent(ID, NOW + 90_001, NOW) == null)
    check(IncomingCallWakeup.fromIntent(ID, NOW + 90_000, NOW) != null)
    check(IncomingCallWakeup.fromIntent(ID, Long.MAX_VALUE, NOW) == null)
    check(IncomingCallWakeup.fromIntent(ID, NOW + 1, -1) == null)
}

private fun testServerOwnedConfirmationOnly() {
    val pending = IncomingCallWakeup.fromIntent(ID, NOW + 30_000, NOW)!!
    val verified = CallSignal(CallRole.RECEIVER, CallPhase.RINGING, NOW + 30_000)
    check(pending.matchesAuthenticatedRing(verified, NOW))
    check(!pending.matchesAuthenticatedRing(verified, NOW + 30_000))
    check(!pending.matchesAuthenticatedRing(CallSignal(CallRole.CALLER, CallPhase.RINGING, NOW + 30_000), NOW))
    check(!pending.matchesAuthenticatedRing(CallSignal(CallRole.RECEIVER, CallPhase.ACCEPTED, NOW + 30_000), NOW))
    check(!pending.matchesAuthenticatedRing(CallSignal(CallRole.RECEIVER, CallPhase.RINGING, NOW + 29_999), NOW))
}

fun main() {
    testUnverifiedWakeupAdmission()
    testServerOwnedConfirmationOnly()
    println("JODLO FCM cold-start: bounded unverified wakeup and authenticated ring-only admission OK")
}
