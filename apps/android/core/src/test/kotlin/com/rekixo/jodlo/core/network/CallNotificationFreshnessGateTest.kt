package com.rekixo.jodlo.core.network

private const val NOW = 1_700_000_000_000L
private const val FIRST = "first_call_12345"
private const val SECOND = "second_call_67890"

private fun testNotificationOrderingAndVerification() {
    val gate = CallNotificationFreshnessGate()
    val first = IncomingCallWakeup.fromIntent(FIRST, NOW + 35_000, NOW)!!
    val next = IncomingCallWakeup.fromIntent(SECOND, NOW + 70_000, NOW)!!
    check(gate.accept(first, verified = false, nowMs = NOW))
    check(!gate.accept(first, verified = false, nowMs = NOW + 1))
    check(gate.accept(first, verified = true, nowMs = NOW + 2))
    check(!gate.accept(first, verified = false, nowMs = NOW + 3))
    check(!gate.accept(first, verified = true, nowMs = NOW + 4))
    // The first ring is server-verified. A delayed generic event for a new
    // ring cannot steal the one PendingIntent, even with a later deadline.
    check(!gate.accept(next, verified = false, nowMs = NOW + 5))
    check(!gate.accept(first, verified = true, nowMs = NOW + 6))
    check(gate.accept(next, verified = true, nowMs = NOW + 7))
    check(!gate.accept(first, verified = false, nowMs = NOW + 8))
    check(!gate.accept(next, verified = false, nowMs = NOW + 70_000))
    check(!gate.toString().contains(FIRST))
    check(!gate.toString().contains(SECOND))
    gate.clear()
    check(gate.accept(first, verified = false, nowMs = NOW + 9))
}

private fun testVerifiedNoticeCannotBeReplacedByUnverifiedNewerDeadline() {
    val gate = CallNotificationFreshnessGate()
    val confirmed = IncomingCallWakeup.fromIntent(FIRST, NOW + 45_000L, NOW)!!
    val sameIdNewDeadline = IncomingCallWakeup.fromIntent(FIRST, NOW + 80_000L, NOW)!!
    val laterUnverified = IncomingCallWakeup.fromIntent(SECOND, NOW + 70_000L, NOW)!!
    check(gate.accept(confirmed, verified = false, nowMs = NOW))
    check(gate.accept(confirmed, verified = true, nowMs = NOW + 1))
    // Old payload duplicated with a different future expiry cannot silently
    // rename or prolong this invitation, even if a server ACK happens.
    check(!gate.accept(sameIdNewDeadline, verified = false, nowMs = NOW + 2))
    check(!gate.accept(sameIdNewDeadline, verified = true, nowMs = NOW + 3))
    check(!gate.accept(laterUnverified, verified = false, nowMs = NOW + 4))
    // But an independently authenticated, more recent incoming call can
    // replace the old one, and may never be downgraded to generic.
    check(gate.accept(laterUnverified, verified = true, nowMs = NOW + 5))
    check(!gate.accept(laterUnverified, verified = false, nowMs = NOW + 6))
    check(!gate.accept(confirmed, verified = true, nowMs = NOW + 7))
    // After the previous ring has timed out, a new short-lived generic
    // wakeup is legitimate and does not inherit its old priority.
    val afterExpiry = IncomingCallWakeup.fromIntent(FIRST, NOW + 85_000L, NOW)!!
    check(gate.accept(afterExpiry, verified = false, nowMs = NOW + 70_000L))
}

private fun testFailedPostRestoresPreviousVerifiedNotification() {
    val gate = CallNotificationFreshnessGate()
    val first = IncomingCallWakeup.fromIntent(FIRST, NOW + 25_000L, NOW)!!
    val second = IncomingCallWakeup.fromIntent(SECOND, NOW + 50_000L, NOW)!!
    check(gate.accept(first, verified = false, nowMs = NOW))
    gate.notificationPosted(first, verified = false)
    check(gate.accept(first, verified = true, nowMs = NOW + 1))
    gate.notificationPosted(first, verified = true)
    check(gate.accept(second, verified = true, nowMs = NOW + 2))
    // The Android OS rejected the newer notice. The existing verified
    // PendingIntent must retain priority, not become a blank gate.
    gate.notificationPostFailed(second, verified = true)
    check(!gate.accept(first, verified = false, nowMs = NOW + 3))
    check(!gate.accept(second, verified = false, nowMs = NOW + 4))
    check(gate.accept(second, verified = true, nowMs = NOW + 5))
    gate.notificationPosted(second, verified = true)
    check(!gate.accept(first, verified = true, nowMs = NOW + 6))
    // Initial post errors also leave no phantom notice behind.
    gate.clear()
    check(gate.accept(first, verified = false, nowMs = NOW + 7))
    gate.notificationPostFailed(first, verified = false)
    check(gate.accept(first, verified = false, nowMs = NOW + 8))
}

private fun testSameDeadlineOtherIdAndExpiry() {
    val gate = CallNotificationFreshnessGate()
    val first = IncomingCallWakeup.fromIntent(FIRST, NOW + 40_000, NOW)!!
    val different = IncomingCallWakeup.fromIntent(SECOND, NOW + 40_000, NOW)!!
    check(gate.accept(first, verified = false, nowMs = NOW))
    check(!gate.accept(different, verified = false, nowMs = NOW + 1))
    check(!gate.accept(different, verified = true, nowMs = NOW + 2))
    check(!gate.accept(first, verified = true, nowMs = NOW + 40_000))
    check(gate.accept(different, verified = false, nowMs = NOW + 3_000 + 40_000).not())
    val newer = IncomingCallWakeup.fromIntent(SECOND, NOW + 60_000, NOW)!!
    check(gate.accept(newer, verified = false, nowMs = NOW + 41_000))
}

internal fun testCallNotificationFreshnessGate() {
    testNotificationOrderingAndVerification()
    testVerifiedNoticeCannotBeReplacedByUnverifiedNewerDeadline()
    testFailedPostRestoresPreviousVerifiedNotification()
    testSameDeadlineOtherIdAndExpiry()
}
