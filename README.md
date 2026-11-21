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
