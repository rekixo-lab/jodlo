package com.rekixo.jodlo.core.network

private val info = "Reliable repairs and installation work."

private fun valid(name: String, details: String = info,
                  years: String = "", rate: String = ""): ServiceProfile {
    val result = ServiceProfileDraftValidator.validate(name, details, years, rate)
    check(result.issue == null)
    return requireNotNull(result.profile)
}

private fun invalid(name: String = "Ravi", details: String = info,
                    years: String = "", rate: String = "",
                    issue: ServiceProfileDraftIssue) {
    val result = ServiceProfileDraftValidator.validate(name, details, years, rate)
    check(result.profile == null && result.issue == issue)
}

private fun verifyDrafts() {
    check(valid("  Cafe\u0301  ").displayName == "Café")
    check(valid("रवि", "घरेलू इलेक्ट्रिकल मरम्मत और इंस्टॉलेशन", "12", "1500")
        == ServiceProfile("रवि", "घरेलू इलेक्ट्रिकल मरम्मत और इंस्टॉलेशन", 12, 1500))
    check(valid("Worker", years = "0", rate = "10000000").visitRateInr == 10_000_000)
    check(valid("Worker").experienceYears == null)
    check(valid("Worker", "A".repeat(400)).description.length == 400)
    check(valid("😀😀").displayName.codePointCount(0, valid("😀😀").displayName.length) == 2)
    invalid(name = "A", issue = ServiceProfileDraftIssue.NAME_LENGTH)
    invalid(name = "A".repeat(61), issue = ServiceProfileDraftIssue.NAME_LENGTH)
    invalid(details = "too short", issue = ServiceProfileDraftIssue.DESCRIPTION_LENGTH)
    invalid(details = "A".repeat(401), issue = ServiceProfileDraftIssue.DESCRIPTION_LENGTH)
    invalid(name = "help@example.com", issue = ServiceProfileDraftIssue.RESTRICTED_TEXT)
    invalid(details = "Visit https://example.com for details", issue = ServiceProfileDraftIssue.RESTRICTED_TEXT)
    invalid(details = "Contact WWW.example.com now", issue = ServiceProfileDraftIssue.RESTRICTED_TEXT)
    invalid(details = "Call 98 765 4321 about the job", issue = ServiceProfileDraftIssue.RESTRICTED_TEXT)
    invalid(details = "संपर्क ९८७६५४३२१० पर करें", issue = ServiceProfileDraftIssue.RESTRICTED_TEXT)
    invalid(details = "Repair <script> service text", issue = ServiceProfileDraftIssue.RESTRICTED_TEXT)
    invalid(details = "Bad\u0000 control text description", issue = ServiceProfileDraftIssue.RESTRICTED_TEXT)
    invalid(years = "-1", issue = ServiceProfileDraftIssue.EXPERIENCE)
    invalid(years = "81", issue = ServiceProfileDraftIssue.EXPERIENCE)
    invalid(years = "twelve", issue = ServiceProfileDraftIssue.EXPERIENCE)
    invalid(rate = "0", issue = ServiceProfileDraftIssue.RATE)
    invalid(rate = "10000001", issue = ServiceProfileDraftIssue.RATE)
    invalid(rate = "10.50", issue = ServiceProfileDraftIssue.RATE)
    invalid(rate = "999999999999999999", issue = ServiceProfileDraftIssue.RATE)
}

private fun verifySafeDraftRecheck() {
    val old = ServiceProfile("Existing name", "Old approved work description", 6, 300)
    val edit = ServiceProfileDraftFields("Fresh repair", "A more detailed service description", "7", "350")
    val changed = ServiceProfileDraftRecovery.afterConfirmedRead(edit, true, old)
    check(changed.unsentLocalChanges && changed.fields == edit)
    // A different approved/pending server version never overwrites unsent input.
    check(ServiceProfileDraftRecovery.afterConfirmedRead(edit, true, null)
        == ServiceProfileDraftRecheck(edit, true))
    val invalid = edit.copy(description = "Call 9876543210 for details")
    check(ServiceProfileDraftRecovery.afterConfirmedRead(invalid, true, old)
        == ServiceProfileDraftRecheck(invalid, true))
    // If an uncertain previous PUT DID commit, reloading the owner GET is
    // sufficient reconciliation. Do not send a second (duplicate) write.
    val committed = ServiceProfile("Fresh repair", "A more detailed service description", 7, 350)
    check(ServiceProfileDraftRecovery.afterConfirmedRead(edit, true, committed)
        == ServiceProfileDraftRecheck(ServiceProfileDraftFields.fromServer(committed), false))
    val normalized = edit.copy(name = "  Fresh repair  ")
    check(!ServiceProfileDraftRecovery.afterConfirmedRead(normalized, true, committed)
        .unsentLocalChanges)
    // Initial load or an unedited refresh always follows server authority.
    check(ServiceProfileDraftRecovery.afterConfirmedRead(edit, false, old)
        == ServiceProfileDraftRecheck(ServiceProfileDraftFields.fromServer(old), false))
    check(ServiceProfileDraftRecovery.afterConfirmedRead(edit, false, null)
        == ServiceProfileDraftRecheck(ServiceProfileDraftFields("", "", "", ""), false))
    // A rejected/bad-response GET cannot call afterConfirmedRead: only the
    // editor's exact account-marker/SessionResult.Success branch may do so.
}

fun main() {
    verifyDrafts()
    verifySafeDraftRecheck()
    println("JODLO Worker profile draft validation and read-only recovery: PASS")
}
