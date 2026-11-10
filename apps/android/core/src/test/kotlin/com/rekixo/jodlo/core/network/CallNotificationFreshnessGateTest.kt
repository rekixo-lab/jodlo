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
    check(gate.accept(next, verified = false, nowMs = NOW + 5))
    check(!gate.accept(first, verified = true, nowMs = NOW + 6))
    check(gate.accept(next, verified = true, nowMs = NOW + 7))
    check(!gate.accept(first, verified = false, nowMs = NOW + 8))
    check(!gate.accept(next, verified = false, nowMs = NOW + 70_000))
    check(!gate.toString().contains(FIRST))
    check(!gate.toString().contains(SECOND))
    gate.clear()
    check(gate.accept(first, verified = false, nowMs = NOW + 9))
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

fun main() {
    testNotificationOrderingAndVerification()
    testSameDeadlineOtherIdAndExpiry()
    println("JODLO FCM notices: old/delayed push cannot replace newer pending call or downgrade verified ring")
}
