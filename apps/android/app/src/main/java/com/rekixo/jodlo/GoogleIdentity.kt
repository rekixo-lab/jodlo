package com.rekixo.jodlo

import androidx.activity.ComponentActivity
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential

/** The Google proof is ephemeral. Do not log, persist, display or cache it.
 * The JODLO Worker backend remains the ONLY authority for verifying this token.
 * This can be called only after the founder configures a matching WEB OAuth client
 * and a reachable, approved HTTPS JODLO backend.
 */
internal suspend fun obtainGoogleIdToken(activity: ComponentActivity, serverClientId: String): String? {
    if (serverClientId.isBlank()) return null
    val request = GetCredentialRequest.Builder()
        .addCredentialOption(GetSignInWithGoogleOption.Builder(serverClientId).build())
        .build()
    val credential = CredentialManager.create(activity)
        .getCredential(context = activity, request = request).credential
    if (credential !is CustomCredential ||
        credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) return null
    return GoogleIdTokenCredential.createFrom(credential.data).idToken
}
