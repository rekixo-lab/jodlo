हम JODLO इसलिए बना रहे हैं ताकि यह Finworkar ऐप से बेहतर हो।

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
