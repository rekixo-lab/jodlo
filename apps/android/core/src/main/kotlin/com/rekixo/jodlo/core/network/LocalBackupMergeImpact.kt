package com.rekixo.jodlo.core.network

/**
 * Honest, immutable, NO-IO preview of an explicitly imported local backup.
 * Counts never contain a stable account, Worker ID, contact, location or call
 * claim. No data is written. Merge actions must recompute against CURRENT
 * device state on tap; an earlier impact cannot authorize a stale merge.
 */
enum class LocalMergeBlock {
    NONE, SAVED_CATEGORY_CONFLICT, SAVED_CAPACITY, HIDDEN_CAPACITY,
}

data class LocalCollectionImpact(
    val alreadyHere: Int,
    val additional: Int,
    val wouldTotal: Int,
    val block: LocalMergeBlock,
) {
    val canMerge: Boolean get() = block == LocalMergeBlock.NONE
}

data class LocalBackupMergeImpact(
    val saved: LocalCollectionImpact,
    val hidden: LocalCollectionImpact,
    /** Only a hypothetical if both independently permitted merges complete. */
    val hiddenSavedIfBothMerged: Int?,
) {
    companion object {
        fun inspect(
            currentSaved: SavedPublicServices,
            currentHidden: HiddenPublicServices,
            incoming: LocalPublicServiceBackup,
        ): LocalBackupMergeImpact {
            val knownSaved = currentSaved.entries.associateBy { it.id }
            val alreadySaved = incoming.saved.entries.count { it.id in knownSaved }
            val newSaved = incoming.saved.entries.size - alreadySaved
            val categoryConflict = incoming.saved.entries.any {
                knownSaved[it.id]?.categoryId?.let { original ->
                    original != it.categoryId
                } == true
            }
            val savedTotal = currentSaved.entries.size + newSaved
            val savedBlock = when {
                categoryConflict -> LocalMergeBlock.SAVED_CATEGORY_CONFLICT
                savedTotal > SavedPublicServices.MAX_ENTRIES -> LocalMergeBlock.SAVED_CAPACITY
                else -> LocalMergeBlock.NONE
            }
            val knownHidden = currentHidden.ids.toSet()
            val alreadyHidden = incoming.hidden.ids.count { it in knownHidden }
            val newHidden = incoming.hidden.ids.size - alreadyHidden
            val hiddenTotal = currentHidden.ids.size + newHidden
            val hiddenBlock = if (hiddenTotal > HiddenPublicServices.MAX_ENTRIES)
                LocalMergeBlock.HIDDEN_CAPACITY else LocalMergeBlock.NONE
            val sharedCount = if (savedBlock == LocalMergeBlock.NONE &&
                hiddenBlock == LocalMergeBlock.NONE) {
                val mergedSaved = currentSaved.mergeFrom(incoming.saved)
                    ?: error("Validated Saved merge must match impact")
                val mergedHidden = currentHidden.mergeFrom(incoming.hidden)
                    ?: error("Validated Hidden merge must match impact")
                mergedSaved.entries.count { mergedHidden.contains(it.id) }
            } else null
            return LocalBackupMergeImpact(
                LocalCollectionImpact(alreadySaved,newSaved,savedTotal,savedBlock),
                LocalCollectionImpact(alreadyHidden,newHidden,hiddenTotal,hiddenBlock),
                sharedCount,
            )
        }
    }
}
