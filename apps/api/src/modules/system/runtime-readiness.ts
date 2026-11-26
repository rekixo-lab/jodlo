import type {D1Database,Env,RateLimitBinding} from "../../data/d1.ts";
import {validGoogleClientId} from "../identity/google.ts";
import {callUsageConfigured} from "../interactions/agora-usage-webhook.ts";
import {playSettlementConfigured} from "../interactions/google-play-settlement-handler.ts";
import {validJodloPubSubPolicy} from "../interactions/google-play-pubsub-auth.ts";
import {configuredPlayRefundPolicy} from "../interactions/play-refund-review.ts";
import {configuredPlayLicenseTestBindings} from "../interactions/play-license-test-policy.ts";

const flags=["CONTACT_BLOCKS_ENABLED","CALL_HISTORY_ENABLED","CALL_DEVICES_ENABLED",
  "CALL_SIGNALING_ENABLED","CALL_MEDIA_VERIFICATION_ENABLED","CALL_USAGE_ENABLED",
  "PLAY_CATALOG_ENABLED","PLAY_ACCOUNT_VIEW_ENABLED","PLAY_VERIFICATION_ENABLED",
  "PLAY_SETTLEMENT_ENABLED","PLAY_RTDN_ENABLED","PLAY_REFUND_HOLDS_ENABLED",
  "PLAY_LICENSE_TEST_ENABLED","OPERATIONS_ENABLED"] as const;
type Flag=typeof flags[number];
const validSecret=(value:unknown)=>typeof value==="string"&&/^[a-f0-9]{64}$/.test(value)&&value!=="0".repeat(64);
const limiter=(value:RateLimitBinding|undefined)=>!!value&&typeof value.limit==="function";
const serviceEmail=(value:unknown)=>typeof value==="string"&&value.length<=256&&
  /^[a-z0-9._-]+@[a-z0-9.-]+\.gserviceaccount\.com$/i.test(value);
function privateKeyShape(value:unknown):boolean{
  if(typeof value!=="string"||value.length>10000)return false;
  const pem=value.replaceAll("\\n","\n");
  return /^-----BEGIN PRIVATE KEY-----\r?\n[A-Za-z0-9+/=\r\n]{32,9900}\r?\n-----END PRIVATE KEY-----(?:\r?\n)?$/.test(pem);
}
const identityFlags:Flag[]=["CONTACT_BLOCKS_ENABLED","CALL_HISTORY_ENABLED","CALL_DEVICES_ENABLED",
  "CALL_SIGNALING_ENABLED","CALL_MEDIA_VERIFICATION_ENABLED","CALL_USAGE_ENABLED",
  "PLAY_CATALOG_ENABLED","PLAY_ACCOUNT_VIEW_ENABLED","PLAY_VERIFICATION_ENABLED","PLAY_SETTLEMENT_ENABLED"];

/** Only schema/configuration is assessed here. No Google/Agora calls, JWT
 * signing, quota probes or secret values leave the Worker. A well-shaped key
 * is not evidence that the provider accepts it or that a phone received push. */
export function runtimeConfigurationReadiness(env:Env){
  const errors=new Set<string>(),enabled=(name:Flag)=>env[name]==="1";
  const check=(valid:boolean,code:string)=>{if(!valid)errors.add(code);return valid;};
  for(const name of flags)if(env[name]!==undefined&&env[name]!=="0"&&env[name]!=="1")errors.add(name+"_INVALID");
  const database=check(!!env.DB&&typeof env.DB.prepare==="function","DB_MISSING_OR_INVALID");
  const depend=(flag:Flag,dependencies:Flag[])=>{
    if(enabled(flag))for(const other of dependencies)check(enabled(other),flag+"_REQUIRES_"+other);
  };
  depend("CALL_SIGNALING_ENABLED",["CALL_DEVICES_ENABLED"]);
  depend("CALL_MEDIA_VERIFICATION_ENABLED",["CALL_SIGNALING_ENABLED"]);
  depend("CALL_USAGE_ENABLED",["CALL_SIGNALING_ENABLED","CALL_MEDIA_VERIFICATION_ENABLED"]);
  depend("PLAY_ACCOUNT_VIEW_ENABLED",["PLAY_CATALOG_ENABLED"]);
  depend("PLAY_VERIFICATION_ENABLED",["PLAY_CATALOG_ENABLED"]);
  depend("PLAY_SETTLEMENT_ENABLED",["PLAY_CATALOG_ENABLED","PLAY_ACCOUNT_VIEW_ENABLED","PLAY_VERIFICATION_ENABLED",
    "PLAY_RTDN_ENABLED","PLAY_REFUND_HOLDS_ENABLED"]);
  depend("PLAY_LICENSE_TEST_ENABLED",["PLAY_SETTLEMENT_ENABLED"]);

  const needsIdentity=identityFlags.some(enabled)||env.GOOGLE_CLIENT_ID!==undefined||env.GOOGLE_ANDROID_CLIENT_ID!==undefined;
  const google=validGoogleClientId(env.GOOGLE_CLIENT_ID);
  const android=env.GOOGLE_ANDROID_CLIENT_ID===undefined||validGoogleClientId(env.GOOGLE_ANDROID_CLIENT_ID);
  if(needsIdentity){
    check(google,"GOOGLE_CLIENT_ID_MISSING_OR_INVALID");
    check(android,"GOOGLE_ANDROID_CLIENT_ID_INVALID");
    check(limiter(env.LOGIN_BURST_LIMITER),"LOGIN_BURST_LIMITER_MISSING_OR_INVALID");
    check(limiter(env.ACCOUNT_LOGIN_LIMITER),"ACCOUNT_LOGIN_LIMITER_MISSING_OR_INVALID");
  }else{
    if(env.LOGIN_BURST_LIMITER!==undefined)check(limiter(env.LOGIN_BURST_LIMITER),"LOGIN_BURST_LIMITER_MISSING_OR_INVALID");
    if(env.ACCOUNT_LOGIN_LIMITER!==undefined)check(limiter(env.ACCOUNT_LOGIN_LIMITER),"ACCOUNT_LOGIN_LIMITER_MISSING_OR_INVALID");
  }
  const identity=database&&google&&android&&limiter(env.LOGIN_BURST_LIMITER)&&limiter(env.ACCOUNT_LOGIN_LIMITER);
  for(const name of ["SERVICE_MODERATION_KEY","ACCOUNT_ERASURE_RELEASE_KEY"] as const)
    if(env[name]!==undefined)check(validSecret(env[name]),name+"_INVALID");
  if(env.BUILD_COMMIT_SHA!==undefined||enabled("OPERATIONS_ENABLED"))
    check(typeof env.BUILD_COMMIT_SHA==="string"&&/^[a-f0-9]{40}$/.test(env.BUILD_COMMIT_SHA)&&env.BUILD_COMMIT_SHA!=="0".repeat(40),"BUILD_COMMIT_SHA_MISSING_OR_INVALID");
  if(enabled("OPERATIONS_ENABLED")){
    check(validSecret(env.OPERATIONS_KEY),"OPERATIONS_KEY_MISSING_OR_INVALID");
    check(limiter(env.OPERATIONS_LIMITER),"OPERATIONS_LIMITER_MISSING_OR_INVALID");
  }else if(env.OPERATIONS_KEY!==undefined)check(validSecret(env.OPERATIONS_KEY),"OPERATIONS_KEY_MISSING_OR_INVALID");

  const fcm=typeof env.FCM_PROJECT_ID==="string"&&/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(env.FCM_PROJECT_ID)&&
    serviceEmail(env.FCM_SERVICE_ACCOUNT_EMAIL)&&privateKeyShape(env.FCM_SERVICE_ACCOUNT_PRIVATE_KEY);
  if(enabled("CALL_SIGNALING_ENABLED")){
    check(typeof env.FCM_PROJECT_ID==="string"&&/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(env.FCM_PROJECT_ID),"FCM_PROJECT_ID_MISSING_OR_INVALID");
    check(serviceEmail(env.FCM_SERVICE_ACCOUNT_EMAIL),"FCM_SERVICE_ACCOUNT_EMAIL_MISSING_OR_INVALID");
    check(privateKeyShape(env.FCM_SERVICE_ACCOUNT_PRIVATE_KEY),"FCM_SERVICE_ACCOUNT_PRIVATE_KEY_MISSING_OR_INVALID");
  }
  const agora=typeof env.AGORA_APP_CERTIFICATE==="string"&&/^[a-f0-9]{32}$/i.test(env.AGORA_APP_CERTIFICATE)&&!/^0+$/.test(env.AGORA_APP_CERTIFICATE);
  if(enabled("CALL_MEDIA_VERIFICATION_ENABLED"))check(agora,"AGORA_APP_CERTIFICATE_MISSING_OR_INVALID");
  const calling=identity&&enabled("CALL_SIGNALING_ENABLED")&&enabled("CALL_DEVICES_ENABLED")&&
    enabled("CALL_MEDIA_VERIFICATION_ENABLED")&&fcm&&agora;
  const usage=callUsageConfigured(env)&&typeof env.AGORA_NOTIFICATIONS_SECRET==="string"&&
    /^[!-~]{16,256}$/.test(env.AGORA_NOTIFICATIONS_SECRET)&&limiter(env.CALL_USAGE_LIMITER);
  if(enabled("CALL_USAGE_ENABLED"))check(usage,"CALL_USAGE_CONFIGURATION_INVALID");

  const publisher=serviceEmail(env.PLAY_SERVICE_ACCOUNT_EMAIL)&&privateKeyShape(env.PLAY_SERVICE_ACCOUNT_PRIVATE_KEY);
  if(enabled("PLAY_VERIFICATION_ENABLED")||enabled("PLAY_RTDN_ENABLED")||enabled("PLAY_SETTLEMENT_ENABLED")){
    check(serviceEmail(env.PLAY_SERVICE_ACCOUNT_EMAIL),"PLAY_SERVICE_ACCOUNT_EMAIL_MISSING_OR_INVALID");
    check(privateKeyShape(env.PLAY_SERVICE_ACCOUNT_PRIVATE_KEY),"PLAY_SERVICE_ACCOUNT_PRIVATE_KEY_MISSING_OR_INVALID");
  }
  const pubsub=env.PLAY_RTDN_AUDIENCE==="https://api.jodlo.rekixo.com/api/v1/play/rtdn"&&validJodloPubSubPolicy({
    audience:env.PLAY_RTDN_AUDIENCE,email:env.PLAY_RTDN_PUSH_EMAIL,subscription:env.PLAY_RTDN_SUBSCRIPTION});
  if(enabled("PLAY_RTDN_ENABLED")){
    check(pubsub,"PLAY_RTDN_IDENTITY_CONFIGURATION_INVALID");
    check(limiter(env.PLAY_RTDN_LIMITER),"PLAY_RTDN_LIMITER_MISSING_OR_INVALID");
  }
  if(enabled("PLAY_VERIFICATION_ENABLED"))check(limiter(env.PLAY_VERIFICATION_LIMITER),"PLAY_VERIFICATION_LIMITER_MISSING_OR_INVALID");
  const refundHolds=!!configuredPlayRefundPolicy(env);
  if(enabled("PLAY_REFUND_HOLDS_ENABLED"))check(refundHolds,"PLAY_REFUND_POLICY_CONFIGURATION_INVALID");
  const licenseTest=enabled("PLAY_LICENSE_TEST_ENABLED"),bindings=configuredPlayLicenseTestBindings(env);
  if(licenseTest)check(bindings!==null,"PLAY_LICENSE_TEST_ACCOUNT_BINDINGS_MISSING_OR_INVALID");
  const settlement=playSettlementConfigured(env)&&identity&&publisher&&pubsub&&
    limiter(env.PLAY_SETTLEMENT_LIMITER)&&limiter(env.PLAY_VERIFICATION_LIMITER)&&limiter(env.PLAY_RTDN_LIMITER);
  if(enabled("PLAY_SETTLEMENT_ENABLED"))check(settlement,"PLAY_SETTLEMENT_CONFIGURATION_INVALID");
  return {configurationErrors:[...errors].sort(),licenseTest,
    configured:{identity,calling,callUsage:calling&&usage,refundHolds,playSettlement:settlement}};
}

const requiredTables=["accounts","worker_profiles","google_identities","auth_sessions","categories","worker_listings",
  "notification_delivery_receipts","notification_delivery_dead_letters","worker_agora_call_preferences",
  "worker_agora_availability_preferences","agora_account_blocks","agora_abuse_window_counters",
  "catalog_groups","catalog_families","catalog_family_categories","worker_service_details","worker_service_photos",
  "service_report_cases","call_history","call_attempt_windows","private_call_invitations","private_call_dispatch_slots",
  "private_call_devices","call_credit_balances","call_credit_events","play_consume_outbox","play_revocation_fences",
  "call_usage_sessions","call_usage_intervals","catalog_import_batches","catalog_import_entries","catalog_services",
  "play_refund_policy","play_refund_reviews","play_pending_refund_reviews"];
const requiredTriggers=["apply_call_credit_event","grant_play_outbox_credit","reject_revoked_play_outbox",
  "freeze_outbox_after_play_revocation","deny_void_hold_resurrection","preserve_play_settlement_authority",
  "close_usage_after_call_terminal","close_usage_before_session_revocation","close_usage_after_account_disable",
  "cap_ended_call_usage","protect_reserved_call_seconds","settle_verified_call_usage","immutable_verified_call_usage",
  "immutable_play_refund_policy","hold_reviewed_play_refund","immutable_play_refund_review",
  "preserve_play_purchase_environment","require_play_license_test_authority",
  "end_call_after_consent_change","end_call_before_consent_delete","end_call_after_availability_change",
  "end_call_before_availability_delete","end_call_after_relationship_block","end_call_after_block_target_change",
  "end_call_after_listing_withdrawal","end_call_before_listing_delete","end_call_before_worker_profile_delete",
  "end_call_after_category_withdrawal","end_call_before_original_session_delete","end_call_after_participant_disable",
  "immutable_pending_play_refund_review","bind_pending_play_refund_review"];
// Forward migrations can change an existing table without adding a table.
// Prepare real read-only projections so a missing column cannot appear ready.
const requiredProjections=[
  "SELECT revision,service_city,report_hold FROM worker_listings LIMIT 0",
  "SELECT management_id FROM agora_account_blocks LIMIT 0",
  "SELECT phase,received_at_ms,accepted_session_hash,availability_revision,terminal_at_ms,history_outcome FROM private_call_invitations LIMIT 0",
  "SELECT caller_session_hash FROM private_call_dispatch_slots LIMIT 0",
  "SELECT settlement_policy_version,settlement_approval_hash,verified_purchased_at_ms,purchase_environment FROM play_consume_outbox LIMIT 0",
  "SELECT response_deadline_ms,purchase_environment,provider_message_id,resolution_evidence_hash,refund_preference,sample_content_provided,decision_evidence_hash,decision_at_ms,submission_started_at_ms,submission_finished_at_ms FROM play_pending_refund_reviews LIMIT 0",
];

/** Presence/projection checks are read-only migration readiness, not a full
 * backup integrity scan or proof that a same-named trigger was not modified. */
export async function runtimeSchemaReady(db:D1Database):Promise<boolean>{
  const placeholders=(values:string[])=>values.map(()=>"?").join(",");
  try{
    const {results}=await db.prepare(`SELECT type,name FROM sqlite_master WHERE
      (type='table' AND name IN (${placeholders(requiredTables)})) OR
      (type='trigger' AND name IN (${placeholders(requiredTriggers)}))`)
      .bind(...requiredTables,...requiredTriggers).all<{type:string;name:string}>();
    const found=new Set(results.map(row=>row.type+":"+row.name));
    if(requiredTables.some(name=>!found.has("table:"+name))||requiredTriggers.some(name=>!found.has("trigger:"+name)))return false;
    for(const query of requiredProjections)await db.prepare(query).all();
    return true;
  }catch{return false;}
}
