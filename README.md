हम JODLO इसलिए बना रहे हैं ताकि यह Finworkar ऐप से बेहतर हो।

## वर्तमान implementation और अंतिम launch handoff — 25 नवंबर 2026

यह section मौजूदा source का सार है। नीचे के तारीख वाले पुराने sections उस समय की स्थिति बताते हैं; checkout, settlement, usage और export के बारे में उनके पुराने “बाकी” वाक्य अब इस section से पढ़ें। हमारा लक्ष्य वही पूरा Customer → Worker → Call → Minutes → Support/Privacy सफर है। किसी feature का code/build पूरा होना और उसका वास्तविक provider/device acceptance अलग प्रमाण हैं।

### अब जुड़े हुए app flows

| भाग | मौजूदा implementation |
| --- | --- |
| Minute packs और checkout | Account में उसी एक BillingClient से Google का ताज़ा localized offer, user द्वारा pack selection, signed-in owner binding, Play purchase callback, pending/cancel/retry और private backend settlement। Default build में खरीद बंद; configured candidate में explicit policy के साथ उपलब्ध। |
| Purchase settlement और recovery | `GET/POST /api/v1/me/play-settle` पर current session, approved SKU/policy, live ProductPurchaseV2 तथा void scan। D1 में एक credit/outbox, फिर Google consume; खोए response के बाद receipt recovery और GET reconciliation। Client balance या client-supplied minutes स्वीकार नहीं। |
| Verified call minutes | Call accept/media grant पर balance reserve और signed Agora evidence का वास्तविक overlap। Hangup, original-session logout/expiry, account disable, consent/availability withdrawal, block और service/category removal call तथा billing को रोकते हैं। |
| Refund review | Confirmed revocation पर reviewed balance hold; अलग pending chargeback inbox में original deadline, owner/provider verification और operator की explicit recommendation। किसी भी case को स्वतः bank refund नहीं माना जाता। |
| Worker service names | Reviewed Hindi/English service labels Category search और Worker details suggestions में। Worker अपने वास्तविक काम की description चुनकर संपादित करता है; catalog नाम से कोई Worker या availability उत्पन्न नहीं होती। |
| Account export | Version 5 में financial records के साथ अपनी call history और purchase का production/license_test environment। Versions 1–4 के पुराने contracts बने रहते हैं; provider secrets और दूसरे account का data बाहर नहीं आता। |
| Operations और release | Schema/trigger/column/configuration readiness, private operator queues, reviewed refund evidence, production configuration, catalog reversal और combined Agora+FCM+Play unsigned release CI। Provider/device acceptance अलग प्रमाण है। |

### विस्तृत code review में सुधरे हुए रास्ते

Android के HTTP request budgets अब route और method के API contract से मिलते हैं: लंबी Play/Google receipts, FCM registration, account deletion, 42 KiB JPEG और Hindi description generic 256/512-byte limit में नहीं अटकते। Local backup और HTTP readers UTF-8, size, total deadline और no-progress bounds लागू करते हैं। Worker login/logout notifications को Account के समान संभालता है; stale preview/search completion loading state नहीं फँसाती। Search/listing continuation, hierarchy Back navigation और bilingual Help वर्तमान flows से मेल खाते हैं।

Worker/listing mutations केवल शुरुआत की पहचान पर निर्भर नहीं हैं: उसी session का owner और database-time expiry atomic SQL write में फिर जाँचा जाता है। Private GET के बाद भी वही active owner होना जरूरी है। Session के स्वाभाविक रूप से expire होने, queued D1 work, logout, account disable/rebind और दूसरे device के बदलावों के regressions हैं। Mutation success सीधे `RETURNING` rows से आता है जहाँ revision/history/call triggers अतिरिक्त rows बदलते हैं; सफल logout/pause को गलत conflict नहीं बताया जाता।

Reviewed catalog के remapped `jodlo_c_*` IDs पर Hindi/English phrase aliases और ambiguity choices काम करते हैं। Cursor search current eligibility, literal conflicts, city availability और continuation को एक SQL snapshot में देखता है। Import → stage → publish → search → reverse का वास्तविक generated-SQL regression है।

`npm test` सभी `scripts/*.test.mjs` और API tests चलाता है। Deleted documents पर निर्भर दो orphan historical guards हटे हैं; current documentation/founder/release checks बने हैं। Release readiness अब founder audit errors सही पढ़ती है। Operator HTTP response streaming bounded है, policy publication symlinked source को reject करती है, और combined Agora+FCM+Play release build नियमित CI का हिस्सा है।

### Billing और call accounting के लागू नियम

Canonical packs `play-minute-packs.ts` में 5, 20, 50, 100, 300 और 500 minutes हैं। **वास्तविक कीमतें मालिक अंतिम Play Console upload/configuration पर भरेंगे।** Android कीमत Google ProductDetails से पढ़ता है। App स्वयं रुपये, entitlement या minute balance नहीं बनाता। Purchase token केवल सीमित request memory में रहता है; D1 में one-way source hash और owner-bound journal होता है। `/me/play-verify` पुराना read-only diagnostic है; `/me/play-settle` अलग configured mutating flow है।

Checkout के लिए `PLAY_SETTLEMENT_ENABLED=1`, `jodlo-play-minutes-v1` की owner approval digest, catalog/account/verification/RTDN/refund prerequisites, dedicated limiter और Google credentials जरूरी हैं। Android candidate को matching `jodloPlayPolicyVersion` चाहिए। Provider timeout के बाद blind repeated consume नहीं होता; purchase recovery फिर provider status पढ़ती है। Settlement के बाद app authoritative account overview refresh करता है। Async Google response के बीच logout/account change हो जाए तो पुराने owner का checkout/result आगे नहीं जाता।

Play license-test cards अलग, **default OFF** `PLAY_LICENSE_TEST_ENABLED=1` mode में केवल dedicated QA accounts के लिए स्वीकार होते हैं। `PLAY_LICENSE_TEST_ACCOUNT_BINDINGS` server secret में 1–32 unique, comma-separated, nonzero, 64-character lowercase hexadecimal JODLO account bindings रखें; whitespace/duplicates स्वीकार नहीं। यह public config, Android, email या raw Google subject की सूची नहीं है। Google का actual test marker और server allowlist दोनों जरूरी हैं; journal में environment immutable रहता है। Flag बंद करने पर नया test grant/consume बंद रहता है, पहले granted receipt का read/reconciliation फिर भी अपने recorded environment से होता है। Play Console license testers और वास्तविक closed-track card tests मालिक configure करेगा। Signed Console test notifications और PURCHASED hints बिना credit/consume बनाए acknowledge होते हैं।

Usage की policy `agora-overlap-v1` और refund hold की policy `jodlo-play-refund-hold-v1` हैं। इनकी approval digests actual reviewed evidence से लें। Usage reservations available minutes को घटाती हैं; ledger debit बाद में verified overlap पर केवल एक बार होता है। Call जल्दी समाप्त होने पर unused reserved seconds तुरंत लौटते हैं और अगली call के लिए उपलब्ध होते हैं; संभावित इस्तेमाल का हिस्सा evidence आने तक reserved रहता है। `* * * * *` cron पहली terminal सीमा या authorized end के बाद दो मिनट की provider-evidence grace पर settle करता है। Normal intervals का union/intersection, server time bounds, semantic duplicates और contradictory evidence का guard लागू है। Missing/abnormal/conflicting evidence पर zero charge और reservation release इस conservative policy का भाग है; इसे provider QA तथा business review में स्वीकार करना बाकी है। Detailed call-usage evidence 30 दिनों बाद bounded cleanup में हटती है, journal/account export की retention अलग घोषित करनी होगी।

वर्तमान call invitation की lifetime creation से अधिकतम पाँच मिनट है; 90-second ringing window इसी सीमा के भीतर है। उपलब्ध balance और original session expiry इसे और कम कर सकते हैं। इसे असीमित call duration न मानें; वास्तविक device/provider acceptance में इस सीमा की जाँच शामिल है।

Refund hold कोई bank refund या debt नहीं है। Available seconds, already reserved call seconds और uncovered review amount अलग हैं। Operator केवल documented case review के बाद existing hold release कर सकता है; revoked purchase का fence या पुराना journal नहीं मिटा सकता। Account erasure owner-linked financial/export rows और media को cascade से हटाती है; unlinked revocation digest, provider-side records और backups की अंतिम retention privacy notice में घोषित करें।

### Reviewed catalog को जोड़ना

पुराने 889 Categories / 7,267 Services review reference हैं। नया importer human-reviewed, content-hash-bound manifest, remapped JODLO IDs और owner/Hindi-English/occupational evidence पढ़ता है। Reference archive को स्वतः public नहीं बनाता। पहले inactive stage, फिर explicit publish; reverse import-owned rows को deactivate करता है और shared parent/dependent batches की रक्षा करता है।

```bash
npm run catalog:import -- --template
npm run catalog:import -- --scope-hash PATH_TO_REVIEWED_MANIFEST.json
npm run catalog:import -- --dry-run PATH_TO_REVIEWED_MANIFEST.json --database PATH_TO_LOCAL_BACKUP.sqlite
npm run catalog:import -- --sql stage PATH_TO_REVIEWED_MANIFEST.json
npm run catalog:import -- --sql publish PATH_TO_REVIEWED_MANIFEST.json
npm run catalog:import -- --sql reverse PATH_TO_REVIEWED_MANIFEST.json
```

ये commands template/hash/local rehearsal/SQL देते हैं। Operator actual review links सत्यापित करके D1 backup पर rehearsal और उसके बाद approved production SQL लागू करेगा। Public `/api/v1/catalog/services` bounded category/language pagination देता है; approval, active hierarchy और current cursor हर read पर जाँचते हैं।

### Production configuration और owner operations

Existing `production:config:write` से actual Cloudflare account/D1 और distinct login limiter IDs की private generated config बनाएँ। Operations template में अपने feature flags, public provider IDs, policy hashes, अलग rate-limit namespaces और retention/usage schedules भरें। Secret values template/GitHub/Android में न रखें; Cloudflare secret storage में install करें।

```bash
npm run production:operations:template
npm run production:operations:configure -- PATH_TO_OWNER_SETTINGS.json
npm run production:config:check
npm run production:domain:write
npm run production:domain:check
npm run release:source-check
npm run release:readiness -- --evidence-template
```

पहली setup में `production:domain:write` चलाएँ। बाद की settings बदलने पर `production:domain:refresh` उसी verified account/D1 की settings को `api.jodlo.rekixo.com` config में रखता है। Generated files gitignored हैं। Config validator feature dependencies, one-minute usage cron, history retention cron और invocation URL logging बंद होने को जाँचता है। यह command वास्तविक deploy नहीं करता।

Operations endpoint के लिए अलग `OPERATIONS_KEY` server secret और dedicated limiter है। Workstation में उसी key को `JODLO_OPERATIONS_KEY` environment variable में सुरक्षित उपलब्ध कराएँ। Readiness exact deployed `BUILD_COMMIT_SHA`, tables/triggers/forward columns, enabled-feature dependencies, credential shapes और pending/overdue queues जाँचता है। `--check` incomplete schema या invalid enabled configuration पर nonzero exit देता है; OFF feature के secrets नहीं माँगता। Configuration/schema ready वास्तविक provider या phone QA का प्रमाण नहीं है। Actual Google/Agora acceptance का प्रमाण external test से आएगा।

```bash
npm run operations -- readiness --expected-sha EXACT_DEPLOYED_COMMIT --check
npm run operations -- refund-list
npm run operations -- refund-resolve --case CASE_DIGEST --evidence PATH_TO_CASE_REVIEW --apply
```

Refund resolve में operator's reviewed file का digest जाता है; file का private content upload नहीं होता। Missing/invalid credential shared operator quota नहीं खर्च करती, failed limiter/schema reads generic error देते हैं, और duplicate evidence सुरक्षित replay होती है।

### Pending chargeback review का operator flow

Signed pending-refund case को Google Orders और ProductPurchaseV2 से उसी existing owner, SKU, purchase time और purchase environment पर सत्यापित किया जाता है। D1 केवल hashes, metadata, original event से 24-hour deadline और evidence रखता है; raw pending/purchase token और order ID नहीं।

Open case पर push retryable रहता है। Operator का explicit decision आने पर अगली authenticated redelivery transient token से Google `orders.reviewrefund` को एक attempt भेजती है। कोई automatic recommendation या pooled balance से invented consumption percentage नहीं बनता। Ambiguous response पर unknown state और कोई blind repeat POST नहीं; overdue unsent case expired होता है। Review submission का स्वीकार होना bank refund complete होना नहीं है।

```bash
npm run operations -- pending-refund-list
npm run operations -- pending-refund-decide --case CASE_DIGEST --preference NEUTRAL --sample-content-provided true --evidence PATH_TO_CASE_REVIEW --apply
npm run operations -- pending-refund-record --case CASE_DIGEST --evidence PATH_TO_EXTERNAL_REVIEW_RESULT --apply
```

`NEUTRAL` और `true` केवल syntax उदाहरण हैं; actual facts और reviewed decision भरें। `decide` अगली signed redelivery पर provider submission अधिकृत करता है। `record` अलग पूरा हुए external handling का evidence रखता है, Google को नहीं भेजता। Pub/Sub retry/retention और dead-letter policy कम-से-कम 24-hour review अवधि में redelivery बचाएँ; operator समय पर queue देखे। आधिकारिक contract: https://developer.android.com/google/play/billing/rtdn-reference और https://developers.google.com/android-publisher/api-ref/rest/v3/orders/reviewrefund ।

### Public privacy, terms, deletion और support pages

`policies:prepare` existing JODLO web shell, Hindi/English navigation, assets और security headers से चार final-content pages तैयार करता है। Blank template में वास्तविक operator/legal identity, address, working support/privacy/deletion email, support hours, retention/backup/provider exceptions, refund policy और enabled features भरें। Source commit तथा content hash पर owner/legal/bilingual review के बाद candidate बनता है।

```bash
npm run policies:prepare -- --template
npm run policies:prepare -- --scope-hash PATH_TO_POLICY.json
npm run policies:prepare -- --check PATH_TO_POLICY.json
npm run policies:prepare -- --write PATH_TO_POLICY.json
```

Candidate `.local-release/website-<scope>/` में `privacy.html`, `terms.html`, `deletion.html`, `help.html` और static assets रखता है। Source clean/committed होना चाहिए; placeholder contacts, stale commit, missing review या changed artifacts जाँच में रुकते हैं। Default site विकास की वर्तमान सहायता दिखाता है। Final candidate को वास्तविक domain पर publish करके contacts/deletion process की जाँच अंतिम owner काम है। Readiness उसी candidate के file hashes भी जाँचता है।

### Verification commands और CI

```bash
npm ci
npm run check
npm run db:migrate:local
npm run db:build:local
npm run test:workerd:local
npm run build:api
npm run release:source-check
```

`npm run check` सभी script/API tests, typecheck, dependency-lock, documentation, founder/design और archive-integrity gates चलाता है। इसमें settlement/consume recovery, explicit pending-refund recommendations, SQLite triggers, signed webhook/replay, database-clock expiry, 20 private feature read variants और सात account snapshots के session races, export v1–v5, catalog import/reversal और operations/config/evidence regressions शामिल हैं। `test:workerd:local` fresh disposable D1 में सभी numbered migrations और वास्तविक Workers HTTP runtime चलाता है।

Android native workflow JDK 17/21 पर Kotlin core तथा default/configured APK compile, API36/min26 manifest checks, optional Agora/FCM/Billing, policy-gated recovery और unsigned candidate AAB जाँचता है। Repeated release payloads को `scripts/android-release-evidence.py` compare करता है; signing और Play validation का प्रमाण अलग है। Local toolchain setup repository में commit नहीं होता।

### मालिक के लिए अंतिम manual work — एक जगह

1. **Catalog और product decisions:** वास्तविक services का scoped qualified review; checkout, conservative call usage तथा refund/appeal policies की approval; business/legal identity, staffed support, retention और privacy/terms के final values। तैयार templates/tools इन inputs से काम पूरा करते हैं।
2. **Cloudflare और providers:** अपने account/D1 IDs, Google OAuth, FCM, Agora notification secret, Android Publisher, Pub/Sub identities, distinct limiter bindings और actual secret installation; fresh backup/restore rehearsal; verified config के साथ deploy और exact source version/domain check।
3. **असली device/payment acceptance:** दो authorized physical phones पर Customer/Worker calling, notification/background/denied permission/reconnect; closed Play track पर purchase, pending/cancel, app restart/restore, refund और ledger; Hindi/English accessibility तथा supported OEMs की जाँच।
4. **Store/signing:** owner-controlled signing/upload key, final version, six real Play product IDs/prices, store description/screenshots, Data Safety/content rating/app access/deletion declarations और final upload।
5. **Final launch:** deployed monitoring/queue/abuse/cost alerts, rollback rehearsal और exact tested commit पर owner acceptance। `release:readiness -- --evidence FILE --check` सभी 19 evidence groups और local config/source checks को एक साथ जाँचता है; recorded evidence के reviewer/provider claims की स्वतंत्र पुष्टि आवश्यक है।

इन inputs के बिना real provider acceptance या public launch को complete दर्ज नहीं करेंगे। सारे implementation changes JODLO में हैं; Finworkar केवल read-only reference रहता है।

## JODLO के नए स्थायी निर्देश — 21 नवंबर 2026

- **मुख्य लक्ष्य:** Finworkar का काम और कॉन्सेप्ट आधार है। JODLO को उससे अधिक आसान, भरोसेमंद, तेज और उपयोगी Customer/Worker ऐप बनाना है, केवल एक नया नाम नहीं।
- **Cloudflare:** JODLO का अपना API, डेटाबेस, मीडिया और संभव backend सिस्टम Cloudflare Workers, D1 और जरूरत पर R2 में बनाएँ। Google Play, Android, Google Sign-In, FCM और RTC जैसी बाहरी प्रदाताओं की सेवाएँ अलग रहेंगी; उन्हें Cloudflare होने का गलत दावा न करें।
- **पेमेंट:** ऐप के डिजिटल समय/क्रेडिट, फीचर और सदस्यता के लिए **Google Play Billing** प्राथमिक है। **Google Pay** यदि Play checkout में उपलब्ध हो तभी भुगतान विकल्प होगा; यह Play Billing से अलग तकनीक है। वास्तविक ऑफलाइन/भौतिक सेवा के ग्राहक-Worker भुगतान की अलग नीति है। सुरक्षित Cloudflare backend से Google purchase सत्यापन और D1 में सुरक्षित, एक-बार credit के बिना पैसों का फीचर चालू न करें। Finworkar का Razorpay या उसका wallet/data कॉपी न करें।
- **Reuse, कोई बेकार duplication नहीं:** Existing JODLO components और Finworkar के काम के पीछे की सही reusable logic/idea को देख कर पुनः इस्तेमाल करें। Validation, SQL, DTO, API contract, UI, text, assets और tests में एक जैसे काम के लिए साझा implementation रखें; duplicated code हटाएँ। अलग सुरक्षा शर्तों को गलती से एक न करें। पुराने Finworkar के लाइव सिस्टम और ग्राहक डेटा को न छुएँ।
- **मुख्य Product Journey:** ग्राहक आसानी से सेवा/Worker खोजे, सच और उपयोगी जानकारी देखे, सुरक्षित संपर्क/कॉल करे; Worker अपनी सेवाएँ और उपलब्धता सँभाले। नकली Worker/सेवा, गलत verified badge, फर्जी भुगतान या गलत live-claim नहीं।
- **गुणवत्ता:** पूरा काम पहले, छोटे दिखावटी परीक्षण नहीं। Source tests, Android APK compile, release protections, privacy और rollback की जाँच करें। Production deploy, real payment, ईमेल या Finworkar में बदलाव बिना अलग सत्यापन न करें।

## मेरी इंजीनियरिंग सलाह और अगला क्रम

1. पूरे **Customer-to-Worker** सफर को एक साथ काम करने योग्य बनाना सबसे पहले; मुख्य फीचर पुराने Finworkar से बेहतर करें।
2. हर फीचर से पहले मौजूदा code search और reuse review; साझा functions/queries और UI components निकालें, behavior regression tests जोड़ें।
3. Google Play digital purchase: Play Console products, Android Billing, सुरक्षित backend verification, D1 ledger, duplicate purchase रोकना, consume/acknowledge, refund/void और restore को पूरा किए बिना पैसे चालू न करें।
4. GitHub green और Cloudflare live version को अलग जाँचें; सिर्फ API health से पूरा deploy प्रमाणित नहीं होता।
5. अंतिम QA में दो असली फोन, कमजोर नेटवर्क, call-answer/reject, notification, खरीद और data-deletion का पूरा परीक्षण; कोई झूठी release-ready घोषणा नहीं।

## दो फोन पर वास्तविक कॉलिंग जाँच — पहले मालिक की अनुमति

सामान्य GitHub debug APK में जानबूझकर Google Login, Cloudflare API और Agora/FCM बंद रहते हैं, इसलिए उससे वास्तविक कॉल का परीक्षण संभव नहीं। दो अलग, USB-debugging के लिए अधिकृत Android फोन, JODLO का वास्तविक सार्वजनिक **Google Web OAuth client ID** और JODLO की अपनी gitignored `apps/android/app/google-services.json` फ़ाइल चाहिए। इन्हें GitHub या चैट में न डालें।

अपने Android development कंप्यूटर पर `JODLO_GOOGLE_WEB_CLIENT_ID=<अपना-पब्लिक-Web-client-ID> npm run android:call-qa -- --customer <Customer-ADB-serial> --worker <Worker-ADB-serial>` चलाएँ। स्क्रिप्ट पहले दोनों फोन और कॉन्फ़िगरेशन जाँचेगी, **एक** debug APK Cloudflare API + Google Login + Agora + FCM के साथ बनाएगी और **सिर्फ निर्दिष्ट दो फोन** पर बिना uninstall/data wipe install करके ऐप खोलेगी। कोई real call, Google Play payment, email या Cloudflare deployment स्वयं नहीं करेगी। FCM config की स्थानीय बनावट जाँचना Google/provider का वास्तविक सत्यापन नहीं है।

**सावधानी:** QA APK वास्तविक JODLO Cloudflare API से जुड़ता है। असली Login, FCM registration या Call पर production में रिकॉर्ड/क्रेडिट बदल सकते हैं। इसलिए केवल अलग अनुमति और नियंत्रित test accounts के साथ ये मैनुअल परीक्षण करें।

फिर दोनों फोन पर अलग Customer और Worker login → Worker की incoming call अनुमति और push readiness → public Service खोजकर ग्राहक द्वारा कॉल शुरू करना → Worker द्वारा Answer/Decline → Mute/Hangup → Network off/on और background/foreground → वास्तविक call history और credit की server से पुष्टि। **दो असली फोन पर यह परीक्षण कोई इंसान ही करेगा; CI में synthetic Firebase compile सिर्फ कोड जाँचता है।**

## Google Play Billing — पूरा offline life-cycle और मालिक का अगला काम

**मौजूदा स्थिति (22 नवंबर 2026):** JODLO के Google Play Billing का `offline synthetic` खरीद-पुष्टि → refund scan → निजी D1 में एक-बार credit/outbox → Google consume → अनिश्चित response recovery → refund/cancellation रोकथाम का संयुक्त परीक्षण तैयार है। यह **असली भुगतान, checkout या live entitlement नहीं** है। इसकी पूरी जाँच `apps/api/tests/play-billing-lifecycle-integration.test.mjs` में है, जो केवल isolated, in-memory SQL, नकली purchase tokens और नकली Google responses इस्तेमाल करता है।

- **जो offline जाँचा गया:** सही JODLO account/SKU से बँधी खरीदी, एक पूर्ण refundable unit, PURCHASED/अभी unconsumed receipt, recent voided-purchase list, बिना automatic credit के candidate, अलग test-only trusted approval पर atomic one-time credit, दूसरे account से reuse पर रोक, अधिकतम एक consume POST, late refund/cancellation पर D1 fence, ambiguous consume पर केवल Google GET से reconciliation, और असली public खरीद/credit API का बंद रहना।
- **जो अभी चालू नहीं है:** Android Billing 9 अभी केवल read-only opt-in adapter है। खरीद शुरू करने का `launchBillingFlow`, असली token का signed-in Cloudflare API तक सुरक्षित handoff, production entitlement coordinator, refund/debt policy, Play Console SKUs/prices, restore, purchase support/alerts, verified release और Google Play के साथ वास्तविक परीक्षण बाकी हैं। Play की 29-दिन refund scan पूरी historical proof नहीं होती; उसकी candidate को सीधे paid credit में नहीं बदलेंगे।
- **मालिक का काम 1 — Play Console:** पुष्टि करें कि `com.rekixo.jodlo` ऐप का मालिकाना, भुगतान/कर प्रोफ़ाइल और परीक्षण/प्रकाशन पात्रता तैयार हैं। JODLO के प्रत्येक digital time/credit pack का असली **product ID, कितने मिनट, INR मूल्य** और उपलब्धता मंजूर करें। Synthetic `jodlo.synthetic5` जैसे test IDs को असली SKU न मानें। अगर subscriptions चाहिएँ तो उनका अलग lifecycle तय करना पड़ेगा।
- **मालिक का काम 2 — Refund policy:** unspent/partly spent minutes, full/partial refund, chargeback, unknown consume, delayed purchases, ग्राहक support, privacy/deletion और appeal के स्पष्ट नियम मंजूर करें। **अभी refund पर token block होता है, पुराना credit अपने-आप नहीं काटा जाता**; नीति के बिना debt या clawback नहीं बनाएँगे।
- **मालिक का काम 3 — Google/Cloudflare setup:** Play Android Publisher API पर सीमित-अधिकार वाली अलग service account, Google Pub/Sub RTDN का सही subscription/push identity, और Cloudflare की secret management में सुरक्षित credentials configure करें। **Private key, Google services JSON, payment account विवरण या कोई secret चैट/GitHub/README में न भेजें।**
- **मालिक का काम 4 — असली QA की मंजूरी:** Closed Play test track, test accounts, वास्तविक Google-signed Android build, खरीद/restore/refund/timeout/offline/background और दो फोन पर जाँच तथा launch decision मालिक की मंजूरी से होगा। CI में fake Google का pass होना असली provider proof नहीं है।
- **Release gate:** Owner-approved product, refund/retention/privacy, native checkout, backend idempotent verification+settlement, refund recovery, actual Play test, monitoring, Cloudflare remote configuration और rollback सभी पूरे होने तक Google Play Billing को **production-ready** नहीं कहेंगे। Finworkar/उसका payment या customer data नहीं छुएँगे।

यह एक ही README JODLO के स्थायी नोट्स का स्रोत है—अलग duplicate handoff document नहीं। Google Play Billing डिजिटल चीजों का payment provider है; Google Pay केवल Play checkout में दिया जा सकने वाला तरीका है।

## कीमत आखिर में: Finworkar से केवल उपयोगी मिनट-पैक, JODLO का अपना Google Play contract

मालिक ने स्पष्ट किया है कि **Play Console में वास्तविक कीमतें अंतिम Android upload/configuration के समय खुद भरेंगे**। तब तक पैक या भुगतान की कीमत पूछकर विकास नहीं रोकना। Finworkar के `functions/src/paymentCatalog.js` को **केवल read-only reference** देखकर 5, 20, 50, 100, 300, 500 मिनट का विचार रखा गया है। Finworkar के पुराने रुपये, Razorpay order, wallet, promo tags या customer records **कॉपी नहीं होंगे**, Finworkar repo बदलना नहीं है।

JODLO के नए प्रस्तावित, कीमत-रहित Play SKU IDs `jodlo.minutes5`, `jodlo.minutes20`, `jodlo.minutes50`, `jodlo.minutes100`, `jodlo.minutes300`, `jodlo.minutes500` हैं। सभी IDs और मिनटों का **एक canonical server स्रोत** `apps/api/src/modules/interactions/play-minute-packs.ts` है; Android इसे स्वयं hardcode नहीं करता। Closed-by-default Cloudflare `GET /api/v1/me/play-packs` route केवल `PLAY_CATALOG_ENABLED=1` और सक्रिय JODLO sign-in होने पर एक **read-only preview** लौटाता है: `{packs,priceSource:"google_play",purchasable:false}`। इसमें कोई कीमत, order, purchase token, credit या payment action नहीं है; सामान्य build/deployment में यह route 404 रहता है। Flag ON होने से भी checkout/credit API नहीं खुलते।

Android के वैकल्पिक Play Billing 9 adapter में दोनों product-ID read और localized price read **एक ही** bounded `queryProductDetailsAsync` helper इस्तेमाल करते हैं। मूल्य केवल Google के `ProductDetails.oneTimePurchaseOfferDetailsList[].formattedPrice` से पढ़ा जाता है; unavailable/ambiguous offers से कोई शून्य या अंदाज़ा कीमत नहीं बनती। Android की strict Kotlin response decoder unknown fields, fabricated prices, duplicate IDs, bad SKU/minutes और `purchasable=true` के preview को अस्वीकार करती है। इसका JVM, Node और opt-in native APK compile CI में परीक्षण है।

**यह price-free catalog और price-source integration है, active billing नहीं।** अगला बड़ा काम actual sign-in-bound checkout, Play token handoff, provider settlement, refund/restore और real-device end-to-end जाँच है। Play Console में owner के अंतिम SKU/INR prices आने और स्पष्ट refund policy/Cloudflare secrets/release approval के बिना असली भुगतान चालू नहीं करना। पहले से लिखी यह दिशा यहीं एकमात्र README में रहेगी; अलग duplicate notes नहीं।

## Android → Cloudflare Google Play receipt handoff (pre-release read-only)

अगला पूरा milestone: `apps/api/src/modules/interactions/google-play-verification-handler.ts` में **एक ही private `/api/v1/me/play-verify` route** है। यह **default OFF** `PLAY_VERIFICATION_ENABLED=1`, अलग `PLAY_VERIFICATION_LIMITER`, `PLAY_CATALOG_ENABLED=1`, असली active JODLO D1 session और Android Publisher service-account credentials **साथ में** होने पर ही उपलब्ध है। अभी production में इन्हें चालू नहीं करना। `GET` पर backend वर्तमान account से 64-character hashed `accountBinding` देता है, व्यक्तिगत Google subject/account ID नहीं। `POST` पर एक bounded/strict JSON `purchaseToken` को memory में Google ProductPurchaseV2 **और** हाल की पूरी void/refund scan से पढ़ता है; दूसरे account की खरीद, pending, acknowledged, test या refunded token को अस्वीकार करता है। Result केवल `not_eligible` या `screened_pending_settlement` है—**कभी entitlement/credit/paid/consumed नहीं**। Rate-limit raw token/account ID के बजाय server session-hash पर है। D1 में खरीद का token, order, पैसा या credit-event नहीं लिखा जाता; कोई Play POST, acknowledge या consume नहीं होता।

Android के **opt-in** `JodloPlayBillingReadOnlyClient` में मौजूदा `queryPurchasesAsync` को साझा कर दिया गया है; नया `queryOwnerBoundUnverifiedProofs(accountBinding)` केवल exact Google-obfuscated-account binding, single approved SKU, `PURCHASED`, not-acknowledged और valid token वाले receipts को ephemeral **one-shot** backend submission के लिए देता है। Proof का `toString` हमेशा redacted है; submission के पहले object से token reference मिटता है। Kotlin का `RemotePlayVerificationRepository` पुरानी HTTPS/JSON/request sender को पुनः इस्तेमाल करता है, bounded body के साथ एक ही POST करता है; timeout पर **automatic retry/credit नहीं** और false-positive/extra price fields को reject करता है। Main JODLO APK में यह Billing source अभी **off/unwired** है, इसलिए test/development build में कोई खरीद शुरू नहीं होती।

**मालिक का काम अभी नहीं:** Finworkar से केवल संदर्भ, उसकी कीमतें/भुगतान/customer data नहीं। Play Console में असली Product IDs/prices अंतिम app-upload समय owner भरेंगे। इससे पहले और एक अलग go-live approval के बाद ही UI के `launchBillingFlow`, server-side owner-approved grant/consume policy, RTDN/refund & restore/chargeback, वास्तविक Google Play closed testing, production Cloudflare credentials और monitoring सक्रिय होंगे। यह milestone **सुरक्षित purchase handoff का tested code है, लाइव भुगतान नहीं**।

## Google Play 9.1 checkout engine — debug-only, user prices added LAST

यह एक बड़ा **Google Play checkout engineering** चरण है, पैसे लेने की मंजूरी नहीं। Android Play Billing 9.1 के आधिकारिक single-offer `ProductDetails` / `offerToken` / `BillingFlowParams.setObfuscatedAccountId` flow के हिसाब से **वास्तविक Google Play checkout invoke करने का opt-in native code** `apps/android/app/src/playBilling/kotlin/com/rekixo/jodlo/JodloPlayCheckoutController.kt` में तैयार है। यह उसी पुराने `JodloPlayBillingReadOnlyClient` का **एक BillingClient**, वही Google ProductDetails query और वही same-account ephemeral purchase-proof verifier reuse करता है—अलग duplicate SDK connection नहीं।

**मूल सुरक्षा अनुबंध:** (1) मौजूदा JODLO Cloudflare session से मिला server-hashed Play account binding; (2) server catalog में शामिल exact SKU और केवल Play से मिला प्रदर्शित `formattedPrice`; (3) खरीद के ठीक पहले Google से **फिर** product/offer query, single eligible one-time offer, उस offer का token, और पहले दिखी कीमत से exact match; बदली कीमत पर खरीद नहीं खुलेगी; (4) user tap / active Android screen, एक समय में केवल एक attempt; duplicated async callbacks से भी अधिकतम एक `launchBillingFlow`; (5) canceled/pending/network error में **कोई मिनट नहीं**; खरीदी हुई और exact account से जुड़ी receipt को सिर्फ Cloudflare verification के लिए ephemeral one-time proof; (6) logout/account switch/close पर पुरानी pending attempt invalid तथा उस adapter पर नया checkout बंद—नई session के लिए नया adapter जरूरी। Kotlin Core का `PlayCheckoutOfferReview.kt` shared price/account/SKU validator व JVM tests और Android native source tests इसे जाँचते हैं।

**दो स्वतंत्र default-OFF build gates:** `-PjodloEnablePlayBilling=true` मूल Billing SDK को ही opt-in compile करता है; उसके बावजूद `BuildConfig.PLAY_CHECKOUT_ENABLED` false रहता है। दूसरी explicit **debug-only** Gradle property `-PjodloEnablePlayCheckout=true` केवल Play SDK + valid HTTPS JODLO API origin + configured public Google Web OAuth client ID वाले non-release build के लिए स्वीकार्य है; `jodloReleaseCandidate=true` के साथ **सख्त fail**। Default APK/CI में **न payment UI trigger है न किसी real user screen से कोई wiring**; इसे केवल अंतिम owner-controlled Play Console prices, QA और go-live से पहले developer testing के लिए बनाया गया है। Google का price, currency, sale status या ProductDetails कभी local fake amount से नहीं बनाया जाएगा।

**अब भी production से पहले बाकी:** Android का user-visible pack/checkout UI और provider callbacks को actual signed-in session से bind करना; मालिक द्वारा Play Console में final SKU/INR price setup; वास्तविक Google-signed closed-test purchase, pending → purchased, refund, partial refund, restore और disconnect QA; Google Play service account+Cloudflare secrets, RTDN, production entitlement grant/consume/ack, refund-policy approved settlement and monitoring, independent release owner approval. केवल Google की `PURCHASED` callback से credit/consume नहीं मिलेगा। Finworkar read-only reference रहा; पुराने payment keys, prices और code नहीं लिए गए। मालिक से **अभी कोई कीमत नहीं पूछनी**, वह अंतिम upload के समय ही तय करेंगे।

## Android Account → Call minute packs: private read-only dashboard milestone

**एक पूरा Account UI + Cloudflare + Kotlin milestone**, वास्तविक भुगतान नहीं। मौजूदा `AccountDashboard → Billing → Purchase status` स्क्रीन अब `PrivatePlayMinuteAccountSection` इस्तेमाल करती है, बिना नया duplicate navigation या अलग BillingClient बनाए। Hindi और English में explicit **Check current minute balance** tap (ना background polling, ना auto-retry), वर्तमान D1 credit ledger के **सटीक** उपलब्ध seconds/min/sec तथा JODLO के मौजूदा canonical 5/20/50/100/300/500 मिनट वाले SKU पैक दिखते हैं। पैक में **₹ price नहीं** और खरीदने का बटन नहीं; कीमत मालिक अंतिम Play Console upload पर भरेंगे, उसके बाद केवल Google Play ProductDetails से actual localized prices ली जाएँगी। यह preview paid transaction का प्रमाण नहीं है।

Cloudflare **`GET /api/v1/me/play-overview`** सिर्फ `PLAY_ACCOUNT_VIEW_ENABLED=1` **और** `PLAY_CATALOG_ENABLED=1` की अलग gates, सही D1 database और active signed-in JODLO session पर एक noncacheable response देता है: `{balance:{availableSeconds,revision},catalog:{packs,priceSource:"google_play",purchasable:false}}`। यह पहले से मौजूद `readOwnCallCreditBalance` और `priceIndependentPlayCatalog` reuse करता है; **कोई D1 write, user-provided owner ID, Play token, order, GST/INR price, verification POST या credit/consume/ack** नहीं। OFF पर 404; config अधूरा तो 503; invalid/expired session 401। सभी errors fail closed.

Android का `InMemorySessionCoordinator.playAccountOverview(owner)` वही existing owner-generation/write-revision `withSession` और offline error gate reuse करता है। `JodloReplyDecoder.playAccountOverview` और `playMinutePacks` **एक ही** strict catalog parser reuse करते हैं: duplicate JSON keys, unknown price/user/entitlement fields, negative balance, bad SKU और `purchasable=true` reject। UI का `PrivatePlayMinuteAccountSnapshot` केवल उसी generation/revision के लिए render होता है; refresh पर पुरानी snapshot तुरंत गायब, session switch/logout और concurrent write पर पुराना account data नहीं दिखता। Tests: स्थानीय D1 दो-अकाउंट isolation/credit-test-fixture, no-write checks, flag/session/auth/HTTP restrictions, Kotlin malformed payloads, Android source/a11y string safeguards और native APK CI.

**Owner के लिए अभी कोई action नहीं।** सामान्य production Cloudflare में preview और checkout दोनों default OFF; app सामान्य signed-in flow में unavailable संदेश दिखाएगा, कोई paid entitlement नहीं। अभी user-visible app में real purchase / provider settlement / approved refund and restore / real-device closed-track QA / owner-set prices बाकी हैं। Finworkar केवल read-only idea reference, code या payment keys नहीं लिये गए।

## Google Play manual restore: owner-fenced, verification-only (not live)

**Google Play में पहले से मौजूद खरीद की जाँच का पूरा opt-in engineering flow:** `InMemorySessionCoordinator.playVerificationBinding(owner)` और `screenOwnedPlayPurchase(owner, token)` अब *मौजूदा* `RemotePlayVerificationRepository`, strict HTTPS/JSON, और generation/write-revision वाले `withSession` को ही reuse करते हैं। Browser/client को कोई raw bearer, account ID, order ID, पैसा या grant control नहीं मिलता। दोनों network calls पर **उसी** `AccountPrivateReadMarker` की अनिवार्य जाँच, logout/दूसरे Google sign-in/worker write/expired session पर पुराने परिणाम discard। इसमें अलग duplicate authentication/verification stack नहीं है।

Optional Android Billing 9.1 `JodloPlayManualRestore` **केवल स्पष्ट user tap** पर एक चुने SKU के लिए: (1) Cloudflare से नए login का 64-character hashed account binding; (2) उसी **एक BillingClient** के `queryPurchasesAsync` से Google Play owned receipts; (3) `PURCHASED`, not-acknowledged, approved SKU, exact obfuscated JODLO account वाले receipts; (4) exact एक matching proof मिलने पर उसका raw token **memory से one-shot consume करके** पुराने `/api/v1/me/play-verify` पर भेजता है। कोई matching purchase नहीं, दो same-SKU receipts, foreign account, wrong SKU, offline/429, interrupted session या incomplete refund scan — **no credit**, safe unavailable/manual review। एक SDK callback बार-बार आए तो भी एक user request से अधिकतम एक जांच; lost result पर automatic retry नहीं। केवल `NotEligible` या **`ScreenedPendingSettlement`** जैसी *non-entitlement* diagnosis; इसे कभी `Paid/Restored/Credited` नहीं कहा जाएगा। कोई local timer, raw token storage, background polling, acknowledgment, consume, purchase initiation या D1 credit write नहीं।

**तीसरी स्वतंत्र default-OFF Android gate** `-PjodloEnablePlayRestore=true` केवल `-PjodloEnablePlayBilling=true`, configured HTTPS API + Google OAuth public client और **debug-only non-release candidate** के साथ मान्य है। Normal/release APK में `PLAY_RESTORE_ENABLED=false`; Account UI इसे अभी invoke नहीं करता। Owner की final Play Console prices, signed closed-track purchase/restore QA, backend settlement/refund/ack policies और production activation बाकी हैं। **कोई असली charged purchase/restore आज नहीं, Play Console price अभी नहीं चाहिए।** सारे बदलाव JODLO में; Finworkar को नहीं छुआ, email नहीं भेजा।

## Manual Play restore QA screen inside Account → Purchase Status (default OFF)

यह milestone पहले से तैयार `JodloPlayManualRestore` engine को **सिर्फ opt-in debug QA build** में मौजूदा Account → Call minute packs → Purchase Status स्क्रीन से जोड़ता है। डुप्लीकेट Dashboard, BillingClient, receipt verifier या पैसा/price system नहीं बनाया। Android `main` source में एक ही `PlayRestoreAccountDiagnostic(session,marker,catalog,busy)` call है; Gradle Play SDK OFF होने पर `src/noPlay/kotlin` की बिल्कुल **खाली**, SDK-free implementation जोड़ता है, और Play SDK opt-in होने पर `src/playBilling/kotlin` की UI implementation। किसी normal/release-candidate APK में नया purchase UI, checkout, restore, या billing dependency सक्रिय नहीं। `BuildConfig.DEBUG && PLAY_RESTORE_ENABLED`, signed-in account-private marker तथा canonical `purchasable=false`/Google Play SKU preview अनिवार्य हैं। अलग `-PjodloEnablePlayRestore=true` QA build flag **default OFF** है और पहले से मौजूद `-PjodloEnablePlayBilling=true`, HTTPS API origin, public OAuth client और non-release configuration माँगता है।

QA स्क्रीन में हिंदी/अंग्रेजी पाठ, **सिर्फ एक approved minute SKU चुनना**, explicit `Check selected purchase` tap, single-flight busy state, और अलग-अलग `not eligible`, `no matching unacknowledged purchase`, `multiple matches need review`, `account changed`, `unavailable/uncertain`, `screened pending settlement` जैसे सही non-entitlement diagnostics हैं। 20-second Play **connection** timeout पर कोई देर से query/POST शुरू नहीं होता। कोई कीमत, Play raw receipt, purchase-token, account/Google ID, order, local credit, persistent state, automatic restore या background retry नहीं। पुनः user tap पर उसी एक BillingClient का पहले से ready connection reuse होगा; screen/logout/locale/catalog बदलाव से controller close, callbacks retired और memory-only state मिटेगी। Backend Cloudflare `/api/v1/me/play-verify` अब भी default-OFF verification-only है; कोई **grant, acknowledgement, consume, paid checkout या refund settlement** यहाँ नहीं।

CI में normal Android JDK17/JDK21 APK + Play SDK Kotlin compile के साथ **सिर्फ synthetic QA origin/OAuth वाली restore-enabled Kotlin compilation** और release candidate के लिए **negative test** है। Production deployment, Play Console prices और वास्तविक tester खरीद के लिए किसी owner step को अभी नहीं किया। **कीमतें अंतिम Play Store अपलोड पर ही भरनी हैं।** Finworkar में कोई edit या email नहीं।

## Account minute activity ledger: exact owner-only credits vs usage (default OFF)

**अब JODLO Account → Billing → Purchase Status में एक ही निजी Cloudflare snapshot से वर्तमान D1 मिनट-बैलेंस + हाल की 10 ledger गतिविधियाँ दिखाई जाएँगी।** Android हिंदी/अंग्रेजी में `मिनट जुड़े` (केवल `purchase_grant` नाम का *internal trusted ledger event*) और `मिनट खर्च हुए` (केवल verified-media `verified_usage`) के समय व सटीक मिनट/सेकंड दिखाएगा। **यह Google Play payment receipt, successful purchase या refund/hold प्रमाण नहीं है।** Google Play verification/screening और “pending settlement” से कोई ledger entry या वास्तविक मिनट नहीं जुड़ते; refund hold अलग revocation fence में है, उसे मनगढ़ंत activity के रूप में UI में नहीं दिखाया जाएगा।

**एक SQL statement, कोई duplicate route या auth:** पहले से मौजूद default-OFF `GET /api/v1/me/play-overview` और `PLAY_ACCOUNT_VIEW_ENABLED=1 && PLAY_CATALOG_ENABLED=1` को reuse करके `history:{entries:[{change:"added"|"used",seconds,occurredAtMs}],hasMore}` लौटेगा; `balance` और canonical `catalog` पहले जैसे। `readOwnCallCreditSnapshot(db,bearer)` एक indexed `auth_sessions.token_hash` + nonexpired session + active D1 account `LEFT JOIN` से **बैलेंस और गतिविधियों का एक consistent D1 SELECT** करता है, `ORDER BY created_at_ms DESC,id DESC LIMIT 11`; UI को केवल 10 सबसे नए दिखाता है, 11वाँ सिर्फ `hasMore` के लिए है। Owner ID/query/offset/page नहीं भेज सकता। `readOwnCallCreditBalance` भी यही function reuse करता है—अलग login SQL और ledger logic duplicate नहीं। कोई D1 write, Play ack/consume, credit grant, checkout, refund simulation, raw purchase token, order ID, hashed source key, account ID या price API response/Compose में नहीं पहुँचता। OFF पर पुराना 404; stale session 401; missing config 503; unknown/malformed rows fail closed.

**Android वही existing session/revision fence:** `PrivatePlayMinuteAccountSnapshot`, एक user-initiated refresh, पुराने owner data को refresh/logout पर clear करना, कोई persistence, retry या background read नहीं। `JodloReplyDecoder.playAccountOverview` strict schema/duplicate JSON guards में entries की संख्या, kinds, seconds, unquoted positive timestamps, descending dates और `hasMore` पर सख्त जाँच है; unauthorized ID/payment/order/extra keys और fabricated paid flags reject। नए backend Node local D1 tests: अलग दो accounts, 14 synthetic events / 10 newest, 11th indicator, used vs added, exact seconds, revoked login, zero-account activity, disabled flags, HTTP writes blocked, no secrets or D1 mutations। Kotlin executable decoder regression, Android localized UI source guards, Cloudflare Worker, JDK17/21/native optional Play/Ago/FCM CI अनिवार्य।

**Production status:** यह UI/code मौजूद है पर Cloudflare Play overview gate **default OFF**; live refunds/credit settle/real Play purchase activate नहीं हुए। कोई owner action अभी नहीं; Google Play Console की वास्तविक कीमतें केवल **अंतिम upload** के समय तय की जाएँगी। Finworkar में बदलाव या email नहीं; JODLO का existing code reuse किया गया है।

## Account → Purchase Status: private Play cancellation/refund hold visibility (default OFF)

**बिना असली भुगतान चालू किए refund/cancellation के बारे में ईमानदार जानकारी:** मौजूदा Cloudflare `GET /api/v1/me/play-overview` के `balance`, `history`, `catalog` के साथ नया **केवल पढ़ने वाला** `holds:{entries:[{minutes,state,recordedAtMs}],hasMore}` आता है। `state` केवल `canceled`, `voided`, `review`; अधिकतम पाँच वर्तमान signed-in खाते से जुड़े hold, छठा सिर्फ `hasMore` के लिए। Hindi/English Android UI में **सिर्फ वास्तविक hold होने पर** नोटिस, pack मिनट, स्थिति और तारीख दिखते हैं। **‘refunded’, ‘refund completed’, ‘balance deducted’, ‘paid’ या ‘new minutes granted’ का दावा नहीं।** खाली holds का मतलब यह *नहीं* कि Google Play पर कभी refund नहीं हुआ—बिना खाते से जुड़े records हम नहीं दिखा सकते।

**महत्वपूर्ण owner privacy सीमा:** `play_revocation_fences` में केवल global Play purchase token का SHA-256 hash है; उसमें **account identity नहीं है**। सिर्फ इस hash से किसी Customer का refund नहीं जोड़ा जा सकता। इसलिए केवल *पहले से उस खाते के* `play_consume_outbox.account_id` वाली `status='void_hold'` row को hold preview में शामिल किया जाता है। `play_revocation_fences` से जुड़ा सत्यापित `reason` हो तो `one_time_canceled → canceled` और `voided_purchase → voided`, नहीं तो `review`—अज्ञात कारण को refund नहीं बताया जाता। `source_key_hash` सिर्फ D1 JOIN/ordering में; API/Android में **hash, token, order, receipt, account ID, provider identity, price, proof या financial amount कभी नहीं**। Verified SKU catalog `jodloPlayMinuteProductMap()` reuse; unapproved SKU/seconds, invalid reason/date, corrupted row fail closed; UI strict fields/enum/timestamp/descending-date parser reuse करता है।

**एक ही पहले से मौजूद default-OFF route, नया ledger या duplicate billing connection नहीं:** `readOwnCallCreditSnapshot` अब पहले की index-backed balance/activity read के बाद एक **अलग index-backed signed-in-owner revalidated D1 SELECT** से holds पढ़ता है। दोनों पर session token hash + non-expired active account जरूरी; owner query parameter स्वीकार नहीं। यह **दो sequential read-only queries** (नया forward-only `0027_play_owner_void_hold_index.sql` का छोटा partial index `account_id + updated_at_ms + source_key_hash` केवल `status='void_hold'` rows पर है, इसलिए बड़े D1 में निजी hold पढ़ने के लिए सभी खरीद रिकॉर्ड scan नहीं करने पड़ेंगे) हैं, कोई atomic refund/balance transaction होने का दावा नहीं। किसी account का revoked/missing session, malformed/replaced data या invalid SKU पर fail closed। Google Play RTDN/provider status API में कोई नया write/checkout/consume/ack/refund API नहीं। पुराने trusted hold/revocation triggers unchanged; **voided_hold वर्तमान balance से मिनट अपने-आप नहीं काटता**, क्योंकि spent-minute refund/partial refund policy owner approval और real-device tests के बाद ही तय होगी।

**Test/rollout:** local D1 में सात synthetic owner-linked frozen outbox rows में पाँच newest, canceled/voided/review mapping, दूसरा user isolation, वैश्विक orphan token-hash fence अलग रहना, credit balance में false deduction नहीं, anonymous logged-out reject, कोई read-side DB mutation नहीं। Kotlin strict payload regression, Android Hindi/English owner-fenced render/source guards और full Cloudflare workerd/D1/Node/TypeScript/Kotlin/Android CI आवश्यक। दोनों API feature flags `PLAY_ACCOUNT_VIEW_ENABLED` और `PLAY_CATALOG_ENABLED` **default OFF**। **कोई live payment, settled refund या production Cloudflare deploy नहीं**, और Play Console की कीमतें मालिक **अंतिम Play Store upload** पर ही भरेंगे। Finworkar read-only reference है; उसे edit नहीं किया, कोई email नहीं भेजी।

## Google Play voided-purchase safety: one shared scanner — 23 नवंबर 2026

JODLO के **owner-bound, verification-only restore screening** और **Google-authenticated RTDN cancellation/refund reconciliation** अब एक ही `apps/api/src/modules/interactions/play-voided-purchase-scan.ts` की bounded Google Voided Purchases pagination reuse करते हैं। Single canonical check में exact purchase token, safe cursor continuation, maximum 8 pages × 200 entries, invalid provider records और incomplete history का fail-closed result शामिल है। पहले इन दोनों APIs में लगभग वही pagination logic duplicate थी। संबंधित original provider deadlines, GET-only network, byte caps, 29-day receipt-screening window, 8-day RTDN window, signed-in owner restrictions और D1 revocation fences **जैसे थे वैसे हैं**। नया साझा scanner कोई D1 write, checkout, ack, consume, entitlement, refund या credit नहीं करता। सभी synthetic provider tests और नए shared-cursor regression CI में चलेंगे; passing tests को live Google/Cloudflare QA न समझें। Google Play prices अंतिम upload पर owner ही भरेंगे; Finworkar और किसी real payment को नहीं छुआ।

## Google Play verification session-race protection — 23 नवंबर 2026

Google Play के पुराने **default-OFF, read-only, owner-bound** `GET/POST /api/v1/me/play-verify` में session को request की शुरुआत में जाँचना पर्याप्त नहीं है: धीमा rate limiter, paused upload, Google ProductPurchaseV2 और recent void scan चलते समय एक दूसरे फोन से logout/logout-all, session expiry या account disable हो सकता है। उसी **एक canonical `findSessionAccount`** को reuse करके now authenticated owner को **limiter के बाद, POST body पढ़ने के बाद, और provider result लौटाने के ठीक पहले** फिर जाँचा जाता है। GET hashed account-binding देने से पहले भी recheck करता है। Session बदल/खत्म होने पर generic `401 UNAUTHORIZED` और `Cache-Control: no-store`; पुराने owner binding, Google purchase eligibility या pack detail का कोई response नहीं। Slow upload cancellation होने पर Google को OAuth/purchase GET शुरू नहीं किया जाता। यह किसी तीसरे-party purchase को claim करने, नई D1 row बनाने या नकली entitlement देने की अनुमति नहीं है।

नया `apps/api/tests/google-play-verification-session-races.test.mjs` अलग-अलग synthetic race cases: rate-limit await में logout, request-body upload के दौरान logout, सफल Google refund scan के आखिरी page में logout, V2 invalid result के दौरान account disabled, और provider GET के दौरान session expiry के साथ **कोई credit/outbox/revocation write नहीं** सिद्ध करता है। API guards, Play Console owner-last pricing, flags default OFF, actual Play/Android provider acceptance और Cloudflare production deployment का अलग gate पहले जैसा ही है। Finworkar, emails और real payment नहीं छुए।

## Android 16 / Google Play 2026 target-SDK gate — 23 नवंबर 2026

Google की वर्तमान **31 अगस्त 2026** policy के अनुसार सामान्य नए Android apps/updates के लिए **API 36 या अधिक** target जरूरी है; पुराने JODLO `compileSdk/targetSdk=35` से अंतिम Play upload रुक सकता था। आधिकारिक API/AGP compatibility के अनुसार app अब `compileSdk=36`, `targetSdk=36`, **Android Gradle Plugin 8.10.1** और **Gradle 8.11.1** इस्तेमाल करता है। पुराना `minSdk=26`, Java 17 bytecode और Android 17/21 JDK build matrix अपरिवर्तित हैं। GitHub native CI अब `platforms;android-36` और `build-tools;36.0.0` install करता है, असली `assembleDebug` APK के `aapt dump badging` से **targetSdkVersion 36** तथा **minSdk 26** चेक करता है, और Agora, optional Play Billing तथा synthetic-only FCM combined build दोबारा compile करता है। Node source regression test गलत SDK/AGP/Gradle, गायब APK manifest assertion या हटे edge-to-edge/BackHandler guards पर fail करेगा। स्थानीय `android:build/install/run/call-qa` के लिए भी API 36 SDK चाहिए; mocked device tests पुराने SDK पर Gradle या ADB चलने से रोकते हैं।

यह **source/CI migration है, release authorization नहीं**। Android 16 पर predictive back, edge-to-edge, microphone/notification, OEM battery/background, 2 real phones और Google Play signed closed-track acceptance अभी वास्तविक device QA माँगते हैं। अभी न production Android AAB sign/upload हुआ, न Cloudflare deployment/Google Play checkout/credit/refund activated हुए, न 889-Category/7,267-Service qualified human review/approval हुआ। JODLO का सारा पुराना default-OFF billing/call-gate, founder's last-step INR prices और FinWorkar read-only boundary कायम हैं। Official reference: https://support.google.com/googleplay/android-developer/answer/11926878 और https://developer.android.com/build/releases/about-agp ।

## 23 नवंबर 2026: Google Play RTDN quota सुरक्षा और synthetic release AAB CI

- **RTDN सुरक्षा का वास्तविक merge #330:** पहले default-OFF `/api/v1/play/rtdn` के *shared rate limiter* से पहले Google-signed JWT/verified email/audience/subscription/purchase hint जाँचा जाता है। नकली या foreign Pub/Sub push अब असली Google cancellation/refund notifications के लिए आरक्षित shared quota खर्च नहीं कर सकती। केवल signed traffic पर पुरानी 429 retry और वास्तविक provider GET/verified D1 refund fence rules रहते हैं। `apps/api/tests/google-play-pubsub-auth.test.mjs` में unsigned, wrong-email, wrong-subscription और signed-but-rate-limited cases, no-credit/no-foreign-write जाँचे गए। **रियल Pub/Sub delivery या refund settlement चालू नहीं है।**
- **Release candidate की एक और offline build रोकावट बंद:** JDK21 के native GitHub workflow में explicit *synthetic public settings* के साथ `:app:bundleRelease` का वास्तविक **unsigned Android 16/API36 AAB compile** और `base/manifest/AndroidManifest.xml` membership check जोड़ा है। Synthetic AAB तुरंत delete होता है, उसे sign, upload या artifact के रूप में share **नहीं** किया जाएगा। पहले से मौजूद unauthorized release refusal, debug billing/restore OFF, Agora/FCM synthetic build, Kotlin/Node और real debug APK manifest tests कायम हैं। यह **real Google-signed release AAB / Play Console owner approval नहीं** है।
- **कुछ छूटे नहीं:** सारे बाकी काम और प्रमाण एक ही consolidated live issue <https://github.com/rekixo-lab/jodlo/issues/331> में 38 unchecked acceptance items के रूप में दर्ज हैं। **889 Categories/7,267 Services का qualified review, वास्तविक Cloudflare production, दो असली फोन, real Google Play billing + minute usage/refund, privacy/terms/support, verified store signing और final upload** पूरे सिद्ध हुए बिना release approval नहीं। कीमतें owner अंतिम Play Console चरण में भरेंगे; FinWorkar read-only, कोई payment/deploy/email नहीं।

## Privacy: Account Overview, पूरा Data Export और Play Minute Overview की session-race सुरक्षा — 23 नवंबर 2026

JODLO के तीन **read-only private API flows** `GET /api/v1/me/overview`, `GET /api/v1/me/data-export?version=1|2|3` और default-OFF `GET /api/v1/me/play-overview` के लिए एक ही canonical `readWithSameActiveSession` guard जोड़ा गया है। पहले owner/session D1 से जाँची जाती है, फिर उसी owner-bound indexed SELECT/JSON export को पढ़ा जाता है, और **response लौटने से पहले उसी bearer की उसी active account से दोबारा जाँच** होती है। बीच में दूसरे फोन से logout/logout-all, account disable, token expiry, या किसी bug से token की owner-rebinding होने पर result generic noncacheable `401 UNAUTHORIZED` होता है; final D1 verification fail होने पर `503 SERVICE_UNAVAILABLE`। पुराने account की details, Google identity, report/contact data, minute balance/ledger, canceled/void holds या service information नहीं लौटती। Existing `sessions.ts` validation/hash re-use, नया duplicate authentication stack नहीं; no token storage, no write, no checkout/credit/consume/public account endpoint.

`apps/api/tests/private-account-session-read-races.test.mjs` में **5 private response types × चार synthetic state races** (revoke, disable, expire, changed owner), final D1 verification outage और दोनों अलग accounts के intact/read-only success paths जाँचे जाते हैं। यह टेस्ट केवल local SQLite/D1 पर है; signed-in real-device privacy QA और production provider acceptance अभी अलग हैं। अंतिम recheck concurrent logout के हर nanosecond के लिए transaction-level atomic promise **नहीं** है। User का JODLO-vs-FinWorkar quality, Cloudflare-only app backend, canonical reuse और owner-last Google Play prices वाला निर्देश पहले जैसा ही है; कोई FinWorkar write, real payment, email या production deployment नहीं।
