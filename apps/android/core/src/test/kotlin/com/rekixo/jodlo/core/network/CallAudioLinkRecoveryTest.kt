package com.rekixo.jodlo.core.network

private fun joinMustNotHangForever() {
    val gate = CallAudioLinkRecovery()
    gate.begin(100)
    check(!gate.expired(false, 100))
    check(!gate.expired(false, 45_099))
    check(gate.expired(false, 45_100))
}

private fun reconnectUsesShorterBudgetAndResetsOnSuccess() {
    val gate = CallAudioLinkRecovery()
    gate.begin(1_000)
    check(!gate.expired(true, 2_000))
    check(!gate.expired(false, 5_000))
    check(!gate.expired(false, 34_999))
    check(gate.expired(false, 35_000))
    check(!gate.expired(true, 36_000))
    check(!gate.expired(false, 90_000))
    check(!gate.expired(false, 119_999))
    check(gate.expired(false, 120_000))
}

private fun newCallAndClockAnomaliesAreSafe() {
    val gate = CallAudioLinkRecovery(100, 50)
    gate.begin(10)
    check(!gate.expired(false, -1))
    check(!gate.expired(false, 5)) // never fail due to a backward clock
    check(!gate.expired(false, 104))
    check(gate.expired(false, 105))
    gate.begin(200)
    check(!gate.expired(false, 249))
    check(!gate.expired(true, 250))
    check(!gate.expired(false, 250))
    check(!gate.expired(false, 299))
    check(gate.expired(false, 300))
    check(runCatching { CallAudioLinkRecovery(0, 20) }.isFailure)
    check(runCatching { CallAudioLinkRecovery(100, -1) }.isFailure)
}

fun main() {
    joinMustNotHangForever()
    reconnectUsesShorterBudgetAndResetsOnSuccess()
    newCallAndClockAnomaliesAreSafe()
    println("JODLO bounded Agora join/reconnect recovery: JVM tests OK")
}
