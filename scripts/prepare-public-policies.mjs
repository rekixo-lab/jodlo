/** Offline bilingual public-policy preparation from actual JODLO data flows.
 * Keeps the existing web shell, navigation, CSS, JS and security headers.
 * No default operator identity, contact, legal approval, price or publication.
 * References checked for this design:
 * https://support.google.com/googleplay/android-developer/answer/13327111
 * https://support.google.com/googleplay/android-developer/answer/10787469
 * Owner/legal review and public endpoint acceptance remain manual evidence.
 */
import {createHash,randomUUID} from "node:crypto";
import {readFile,writeFile,mkdir,lstat,rename,rm,readdir} from "node:fs/promises";
import {resolve,dirname,join} from "node:path";
import {fileURLToPath} from "node:url";
import {execFileSync} from "node:child_process";
import {validJodloReviewUrl} from "./review-evidence-url.mjs";
import {canonical} from "./approved-catalog-import.mjs";

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const exact=(v,keys)=>v&&typeof v==="object"&&!Array.isArray(v)&&Object.keys(v).sort().join("|")===keys.slice().sort().join("|");
const sha=v=>createHash("sha256").update(typeof v==="string"||Buffer.isBuffer(v)?v:canonical(v)).digest("hex");
const textEscape=v=>String(v).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
const placeholder=/\b(?:tbd|todo|placeholder|example company|your company|replace me|fill in|lorem ipsum)\b|[\[<](?:insert|your|name|email|company)|(?:example|invalid|test)\.(?:com|org|net)\b/i;
const retentionKeys=["accountRecords","backups","providerRecords","cloudflareLogs","paymentFraudHashes","moderationRecords"];
const bilingual=()=>({en:"",hi:""});
export function publicPolicyTemplate(sourceCommit=""){
  return {kind:"JODLO_PUBLIC_POLICY_V1",sourceCommit,effectiveDate:"",websiteOrigin:"https://jodlo.rekixo.com",
    operator:{name:bilingual(),address:bilingual(),jurisdiction:bilingual()},
    contact:{supportEmail:"",privacyEmail:"",deletionEmail:"",supportHours:bilingual(),complaintProcess:bilingual(),responseDays:null},
    minimumAge:null,features:{calls:false,billing:false,accountDeletion:false},
    retention:{callHistoryDays:90,...Object.fromEntries(retentionKeys.map(k=>[k,bilingual()]))},
    deletion:{completionDays:null,identityVerification:bilingual(),retainedExceptions:bilingual()},
    refundPolicy:bilingual(),termsAdditional:bilingual(),
    approvals:Object.fromEntries(["owner","legal","bilingual"].map(role=>[role,{reviewer:role==="owner"?"rekixo-lab":"",decision:"",scopeSha256:"",reviewedAt:"",evidenceUrl:""}]))};
}
function plain(v,min,max,label){
  if(typeof v!=="string"||v!==v.trim()||[...v].length<min||[...v].length>max||/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(v)||placeholder.test(v))throw Error("Complete actual "+label+" required");
}
function localized(v,label,min=10,max=2000){
  if(!exact(v,["en","hi"]))throw Error("Both reviewed languages required");
  for(const lang of ["en","hi"]){plain(v[lang],min,max,label);if(!(lang==="hi"?/[\u0900-\u097f]/u:/[A-Za-z]/u).test(v[lang]))throw Error("Review language/script mismatch");}
}
function email(v){
  plain(v,6,160,"working contact email");
  if(!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}@[A-Za-z0-9](?:[A-Za-z0-9.-]{0,189})\.[A-Za-z]{2,24}$/.test(v)||
    /(?:^|[.@])(?:example|test|invalid|localhost)(?:[.@]|$)/i.test(v)||v.includes(".."))throw Error("Verified operator email required; placeholders are forbidden");
}
function basePolicy(m){
  if(!exact(m,["kind","sourceCommit","effectiveDate","websiteOrigin","operator","contact","minimumAge","features","retention","deletion","refundPolicy","termsAdditional","approvals"])||m.kind!=="JODLO_PUBLIC_POLICY_V1"||
      !/^[a-f0-9]{40}$/.test(m.sourceCommit)||/^0+$/.test(m.sourceCommit)||m.websiteOrigin!=="https://jodlo.rekixo.com")throw Error("Invalid public policy scope");
  if(typeof m.effectiveDate!=="string"||!/^20\d\d-\d\d-\d\d$/.test(m.effectiveDate)||
     !Number.isFinite(Date.parse(m.effectiveDate+"T00:00:00.000Z"))||new Date(m.effectiveDate+"T00:00:00.000Z").toISOString().slice(0,10)!==m.effectiveDate)throw Error("Valid effective date required");
  if(!exact(m.operator,["name","address","jurisdiction"]))throw Error("Actual operator details required");
  for(const k of ["name","address","jurisdiction"])localized(m.operator[k],"operator "+k,k==="name"?3:5,400);
  if(!exact(m.contact,["supportEmail","privacyEmail","deletionEmail","supportHours","complaintProcess","responseDays"]))throw Error("Complete support/privacy/deletion contacts required");
  for(const k of ["supportEmail","privacyEmail","deletionEmail"])email(m.contact[k]);
  localized(m.contact.supportHours,"staffed support hours");localized(m.contact.complaintProcess,"complaint handling");
  if(!Number.isInteger(m.contact.responseDays)||m.contact.responseDays<1||m.contact.responseDays>30)throw Error("Owner-reviewed response deadline required");
  if(!Number.isInteger(m.minimumAge)||m.minimumAge<18||m.minimumAge>99)throw Error("Owner-reviewed adult minimum age required");
  if(!exact(m.features,["calls","billing","accountDeletion"])||Object.values(m.features).some(v=>typeof v!=="boolean"))throw Error("Explicit release feature scope required");
  if(!exact(m.retention,["callHistoryDays",...retentionKeys])||m.retention.callHistoryDays!==90)throw Error("Retention must match the existing 90-day call-history implementation");
  for(const k of retentionKeys)localized(m.retention[k],k+" retention");
  if(!exact(m.deletion,["completionDays","identityVerification","retainedExceptions"])||!Number.isInteger(m.deletion.completionDays)||m.deletion.completionDays<1||m.deletion.completionDays>90)throw Error("Real deletion procedure/deadline required");
  localized(m.deletion.identityVerification,"deletion identity verification");localized(m.deletion.retainedExceptions,"justified deletion exceptions");
  localized(m.refundPolicy,"refund policy");localized(m.termsAdditional,"operator terms");
  const {approvals,...scope}=m;return scope;
}
export function publicPolicyScopeHash(m){return sha(basePolicy(m));}
export function validatePublicPolicy(m,{sourceCommit,now=Date.now()}={}){
  const scopeSha256=publicPolicyScopeHash(m);
  if(m.sourceCommit!==sourceCommit)throw Error("Policy review belongs to a different source commit");
  if(Date.parse(m.effectiveDate+"T00:00:00.000Z")>now)throw Error("Policy is not effective yet");
  if(!exact(m.approvals,["owner","legal","bilingual"]))throw Error("Owner, legal and bilingual review evidence required");
  for(const role of ["owner","legal","bilingual"]){
    const a=m.approvals[role];
    if(!exact(a,["reviewer","decision","scopeSha256","reviewedAt","evidenceUrl"])||a.decision!=="approve_publication"||a.scopeSha256!==scopeSha256||!validJodloReviewUrl(a.evidenceUrl))throw Error("Missing scope-bound "+role+" review");
    plain(a.reviewer,2,120,"reviewer");
    if(role==="owner"&&a.reviewer!=="rekixo-lab")throw Error("Actual repository owner decision required");
    if(!/^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(a.reviewedAt)||!Number.isFinite(Date.parse(a.reviewedAt))||
       new Date(a.reviewedAt).toISOString()!==a.reviewedAt||Date.parse(a.reviewedAt)>now)throw Error("Valid review date required");
  }
  return {scopeSha256,sourceCommit:m.sourceCommit,ownerApprovalSupplied:true,evidenceAuthentication:"MANUAL_REVIEW_REQUIRED",publicationAuthorized:false};
}
const p=text=>"<p>"+textEscape(text)+"</p>";
const card=(title,...paragraphs)=>"<article class=\"tile\"><h2>"+textEscape(title)+"</h2>"+paragraphs.map(p).join("")+"</article>";
const emailLink=(address,label,subject="")=>'<a href="mailto:'+textEscape(address)+(subject?'?subject='+encodeURIComponent(subject):"")+'">'+textEscape(label)+"</a>";
function policySections(m,lang){
  const hi=lang==="hi",L=(en,hiText)=>hi?hiText:en;
  const name=m.operator.name[lang],date=m.effectiveDate;
  const contact='<article class="tile"><h2>'+L("Contact the operator","संचालक से संपर्क")+'</h2>'+p(name)+p(m.operator.address[lang])+
    '<p>'+emailLink(m.contact.supportEmail,L("Support: ","सहायता: ")+m.contact.supportEmail)+"<br>"+
    emailLink(m.contact.privacyEmail,L("Privacy: ","गोपनीयता: ")+m.contact.privacyEmail)+"</p>"+p(m.contact.supportHours[lang])+"</article>";
  const privacy='<h1>'+L("Privacy notice","गोपनीयता सूचना")+'</h1>'+p(L("Effective date: ","प्रभावी तारीख: ")+date)+contact+
    card(L("Account and public listings","खाता और सार्वजनिक सेवाएँ"),
      L("JODLO uses Google's sign-in identifier and JODLO session records to protect your account. Workers may submit a Category, optional service city, work description and a photograph. Only published, allowed information is shown publicly; a listing is not proof of identity, qualifications or current availability.",
        "JODLO खाते की सुरक्षा के लिए Google से मिली साइन-इन पहचान और JODLO session रिकॉर्ड का उपयोग करता है। Worker श्रेणी, वैकल्पिक सेवा शहर, काम का विवरण और तस्वीर दे सकते हैं। केवल प्रकाशित और स्वीकृत जानकारी सार्वजनिक दिखती है; सूची में होना पहचान, योग्यता या वर्तमान उपलब्धता का प्रमाण नहीं है।"),
      L("Service photos are limited, re-encoded JPEG images without original filenames or embedded photo metadata. They require review before public display. A declared city is not precise GPS location.",
        "सेवा की तस्वीरें सीमित आकार की दोबारा तैयार JPEG होती हैं; मूल फ़ाइल नाम और तस्वीर का अतिरिक्त metadata नहीं रखा जाता। सार्वजनिक दिखाने से पहले समीक्षा आवश्यक है। बताया गया शहर सटीक GPS स्थान नहीं है।"))+
    card(L("Data on your phone and exports","फोन का डेटा और एक्सपोर्ट"),
      L("Saved and Hidden service references stay on your phone. You can clear them independently. A Backup or account export is written only to the document destination you choose; choosing a cloud provider may upload that file through that provider. Exporting, hiding, clearing bookmarks or signing out does not erase your account.",
        "Saved और Hidden सेवा संदर्भ आपके फोन पर रहते हैं और अलग से साफ किए जा सकते हैं। Backup या खाते का एक्सपोर्ट आपकी चुनी हुई फ़ाइल जगह पर ही लिखा जाता है; क्लाउड जगह चुनने पर संबंधित प्रदाता फ़ाइल अपलोड कर सकता है। एक्सपोर्ट, सेवा छिपाना, बुकमार्क साफ करना या साइन-आउट खाता नहीं मिटाता।"))+
    card(L("Calls and notifications","कॉल और सूचनाएँ"),m.features.calls?
      L("With your permission, Agora carries Internet-call audio and Google Firebase Cloud Messaging delivers call notifications using a private device token. JODLO keeps call summaries and verified connection intervals for call history, safety and minute accounting. This release does not implement call-audio recording. Microphone and notification access can be changed in Android settings.",
        "आपकी अनुमति से Agora इंटरनेट कॉल की आवाज़ पहुँचाता है और Google Firebase Cloud Messaging निजी device token से कॉल की सूचना देता है। JODLO कॉल इतिहास, सुरक्षा और मिनटों की गणना के लिए कॉल का सार और सत्यापित जुड़ाव अंतराल रखता है। इस रिलीज में कॉल की आवाज़ रिकॉर्ड करने की सुविधा नहीं है। Android settings में microphone और notification अनुमति बदली जा सकती है।"):
      L("Internet calling and call notifications are not enabled in this release.","इस रिलीज में इंटरनेट कॉल और कॉल की सूचना चालू नहीं हैं।"),
      L("Visible call-history summaries have a 90-day retention window and can be cleared from Account. This does not delete another participant's records, separate usage/accounting evidence, provider records or backups.",
        "दिखने वाले कॉल इतिहास के सार की अवधि 90 दिन है और Account से इन्हें साफ किया जा सकता है। इससे दूसरे प्रतिभागी के रिकॉर्ड, उपयोग/लेखा प्रमाण, प्रदाता के रिकॉर्ड या बैकअप नहीं मिटते।"))+
    card(L("Payments and minute records","भुगतान और मिनट रिकॉर्ड"),m.features.billing?
      L("Google Play handles digital minute purchases and the payment methods it offers. JODLO does not collect your card or bank credentials. A purchase token is sent securely for server verification; JODLO stores hashed purchase references, minute activity and necessary settlement/review records. Raw purchase tokens are not stored in JODLO's database. Google processes its own payment and refund records.",
        "डिजिटल मिनट की खरीद और उपलब्ध भुगतान तरीके Google Play संभालता है। JODLO आपके कार्ड या बैंक के गुप्त विवरण नहीं लेता। सर्वर सत्यापन के लिए purchase token सुरक्षित भेजा जाता है; JODLO hashed खरीद संदर्भ, मिनट गतिविधि और आवश्यक निपटान/समीक्षा रिकॉर्ड रखता है। मूल purchase token JODLO डेटाबेस में नहीं रखा जाता। Google अपने भुगतान और refund रिकॉर्ड संभालता है।"):
      L("Digital minute purchases are not enabled in this release. JODLO does not accept an off-platform transfer as proof of an app-minute purchase.","इस रिलीज में डिजिटल मिनट की खरीद चालू नहीं है। ऐप के मिनट खरीदने के प्रमाण के रूप में JODLO बाहर किए गए पैसे के ट्रांसफ़र को स्वीकार नहीं करता।"))+
    card(L("Hosting and providers","होस्टिंग और प्रदाता"),
      L("Cloudflare Workers and D1 process JODLO API requests and account, listing, moderation and accounting records. Google sign-in, Google Play, Firebase messaging and Agora perform their respective enabled functions. Their processing and retention also apply. This policy website uses no analytics, storage or support-submission form; the hosting provider may process requests and approved operational logs.",
        "Cloudflare Workers और D1, JODLO API अनुरोध तथा खाते, सेवा, moderation और लेखा रिकॉर्ड संभालते हैं। Google साइन-इन, Google Play, Firebase messaging और Agora अपनी संबंधित चालू सुविधाएँ प्रदान करते हैं। उनके डेटा प्रसंस्करण और रखने की अवधि भी लागू होती है। इस नीति वेबसाइट में analytics, storage या सहायता अनुरोध जमा करने का फ़ॉर्म नहीं है; होस्टिंग प्रदाता अनुरोध और स्वीकृत संचालन logs संभाल सकता है।"),m.retention.providerRecords[lang],m.retention.cloudflareLogs[lang])+
    card(L("Retention and deletion","डेटा रखने और मिटाने की अवधि"),m.retention.accountRecords[lang],m.retention.backups[lang],m.retention.paymentFraudHashes[lang],m.retention.moderationRecords[lang],m.deletion.retainedExceptions[lang])+
    '<p><a class="action" href="./deletion.html">'+L("Request account deletion","खाता मिटाने का अनुरोध")+'</a></p>';
  const deletion='<h1>'+L("Delete your JODLO account","अपना JODLO खाता मिटाएँ")+'</h1>'+p(L("Operator: ","संचालक: ")+name)+
    card(L("Request without reinstalling the app","ऐप दोबारा लगाए बिना अनुरोध करें"),
      L("Use the deletion email below even if you cannot open the app. Ask to delete your JODLO account and associated data. Do not send passwords, Google sign-in tokens, payment tokens or full card/bank details.",
        "ऐप न खुलने पर भी नीचे दिए deletion ईमेल से अनुरोध करें। अपना JODLO खाता और उससे जुड़ा डेटा मिटाने की माँग लिखें। पासवर्ड, Google साइन-इन token, payment token या पूरे कार्ड/बैंक विवरण न भेजें।"))+
    '<p class="status">'+emailLink(m.contact.deletionEmail,L("Email an account deletion request","खाता मिटाने का ईमेल भेजें"),"JODLO account deletion request")+'</p>'+p(m.contact.deletionEmail)+
    card(L("Identity and completion","पहचान और अनुरोध पूरा होना"),m.deletion.identityVerification[lang],
      L(`We aim to acknowledge requests within ${m.contact.responseDays} days and complete a verified deletion request within ${m.deletion.completionDays} days, subject to the disclosed retained exceptions. The operator will explain any delay or required identity check.`,
        `अनुरोध की प्राप्ति की सूचना ${m.contact.responseDays} दिनों में और सत्यापित मिटाने का अनुरोध ${m.deletion.completionDays} दिनों में पूरा करने का लक्ष्य है; नीचे बताए गए रिकॉर्ड रखने के अपवाद लागू होते हैं। देरी या पहचान जाँच की आवश्यकता संचालक बताएगा।`))+
    card(L("In-app controls","ऐप के नियंत्रण"),m.features.accountDeletion?
      L("Open Account → Account and data → Delete account and confirm with Google. The in-app action deletes account-linked JODLO database records and revokes sessions. Use the contact above for provider/backup follow-up and any retained records. A success message does not claim that an external provider or backup was immediately erased.",
        "Account → खाता और डेटा → खाता हटाएँ खोलकर Google से पुष्टि करें। ऐप का यह काम खाते से जुड़े JODLO डेटाबेस रिकॉर्ड मिटाता और sessions बंद करता है। प्रदाता/बैकअप या बचे हुए रिकॉर्ड के लिए ऊपर दिए संपर्क से पूछें। सफल संदेश का अर्थ बाहरी प्रदाता या बैकअप का तत्काल मिट जाना नहीं है।"):
      L("Use the email request route above; in-app account deletion is not enabled in this release. You do not need to reinstall the app to request deletion.","ऊपर दिए ईमेल मार्ग से अनुरोध करें; इस रिलीज में ऐप से खाता मिटाना चालू नहीं है। अनुरोध करने के लिए ऐप दोबारा लगाना आवश्यक नहीं है।"),
      L("Export and sign-out do not erase account data. Local Saved/Hidden references and copies you exported must be cleared separately on your own device/storage.","एक्सपोर्ट या साइन-आउट से खाते का डेटा नहीं मिटता। फोन के Saved/Hidden संदर्भ और आपके एक्सपोर्ट की हुई प्रतियाँ अपने डिवाइस/स्टोरेज से अलग साफ करनी होंगी।"))+
    card(L("What may remain","कौन से रिकॉर्ड रह सकते हैं"),m.deletion.retainedExceptions[lang],m.retention.backups[lang],m.retention.providerRecords[lang],m.retention.paymentFraudHashes[lang])+contact;
  const terms='<h1>'+L("Terms of service","सेवा की शर्तें")+'</h1>'+p(L("Effective date: ","प्रभावी तारीख: ")+date)+contact+
    card(L("Scope and eligibility","सेवा का दायरा और पात्रता"),
      L(`JODLO is operated by ${name}. You must be at least ${m.minimumAge} years old and permitted to enter the relevant service agreement. These terms apply to the app and its enabled features.`,
        `JODLO का संचालन ${name} करता है। आपकी उम्र कम से कम ${m.minimumAge} वर्ष होनी चाहिए और संबंधित सेवा समझौता करने की पात्रता होनी चाहिए। ये शर्तें ऐप और उसकी चालू सुविधाओं पर लागू हैं।`),
      L("Workers are responsible for truthful descriptions, necessary qualifications and lawful work. Customers and Workers agree separately on the actual physical service, price and terms. A published listing is not identity/licence verification or a guarantee of work, availability or results.",
        "Worker सही विवरण, आवश्यक योग्यता और वैध काम के लिए जिम्मेदार हैं। वास्तविक भौतिक सेवा, कीमत और शर्तें ग्राहक और Worker अलग से तय करते हैं। प्रकाशित सेवा पहचान/लाइसेंस की पुष्टि या काम, उपलब्धता और परिणाम की गारंटी नहीं है।"))+
    card(L("Digital minutes and payment disputes","डिजिटल मिनट और भुगतान विवाद"),
      L("When enabled, digital minutes are sold through Google Play with the localized price shown by Play before purchase. They are not cash or a payment to a Worker for physical work. Pending or canceled purchases must not be treated as available minutes. Your Account balance and purchase status show the confirmed server result.",
        "सुविधा चालू होने पर डिजिटल मिनट Google Play से खरीदे जाते हैं और खरीद से पहले Play स्थानीय कीमत दिखाता है। ये नकद या Worker को भौतिक काम का भुगतान नहीं हैं। अधूरी या रद्द खरीद को उपलब्ध मिनट न समझें। Account का balance और खरीद स्थिति सर्वर का पुष्ट परिणाम दिखाते हैं।"),m.refundPolicy[lang],
      L("A canceled or disputed purchase may place unused minutes on hold while the operator reviews it. A hold is not a promise that a refund has completed. Contact support for the applicable outcome and review process.",
        "रद्द या विवादित खरीद के बचे मिनट संचालक की समीक्षा तक रोके जा सकते हैं। रोक लगने का अर्थ refund पूरा होने का वादा नहीं है। लागू परिणाम और समीक्षा प्रक्रिया के लिए सहायता से संपर्क करें।"))+
    card(L("Reports, appeals and restrictions","शिकायत, अपील और प्रतिबंध"),
      L("Use the app's service report and appeal controls for inaccurate, unsafe or disputed listings. Contact blocks and hiding a listing serve different purposes; hiding is only a local display preference. Do not post unlawful content, impersonate others, evade moderation or misuse another person's account.",
        "गलत, असुरक्षित या विवादित सेवा के लिए ऐप के report और appeal नियंत्रण का उपयोग करें। संपर्क रोकना और सूची छिपाना अलग काम हैं; छिपाना सिर्फ फोन पर दिखने की पसंद है। अवैध सामग्री, किसी और की पहचान का उपयोग, moderation से बचना या दूसरे का खाता इस्तेमाल करना मना है।"),m.contact.complaintProcess[lang])+
    card(L("Additional operator terms","संचालक की अतिरिक्त शर्तें"),m.termsAdditional[lang],m.operator.jurisdiction[lang]);
  const help='<div class="hero"><h1>'+L("JODLO help","JODLO सहायता")+'</h1>'+p(L("Find services, manage your listings and control your account.","सेवाएँ खोजें, अपनी सेवाएँ संभालें और खाते के नियंत्रण इस्तेमाल करें।"))+'</div><div class="content">'+
    card(L("Browse and save","खोजें और सहेजें"),L("Choose a city and Category to browse currently published services. Approved service names can also help your search. Saved and Hidden references stay on this phone; export/merge them from Backup if you choose. City availability does not prove GPS proximity.","शहर और श्रेणी चुनकर वर्तमान प्रकाशित सेवाएँ देखें। स्वीकृत सेवा नाम खोज में भी सहायता करते हैं। Saved और Hidden संदर्भ फोन पर रहते हैं; चाहें तो Backup से एक्सपोर्ट/मर्ज करें। शहर की उपलब्धता GPS से आसपास होने का प्रमाण नहीं है।"))+
    card(L("Worker details and photos","Worker विवरण और तस्वीर"),L("From Worker, choose an approved Category, optionally select service-name suggestions, edit your description and city, and submit a photo. Suggestions fill only your editable draft. Review status controls public details; you can pause a listing without deleting the whole account.","Worker में स्वीकृत श्रेणी चुनें, चाहें तो सेवा नाम के सुझाव लें, विवरण और शहर बदलें और तस्वीर दें। सुझाव सिर्फ संपादन योग्य मसौदे में जुड़ते हैं। सार्वजनिक विवरण समीक्षा की स्थिति पर निर्भर हैं; पूरा खाता मिटाए बिना सेवा रोक सकते हैं।"))+
    card(L("Account and purchase support","खाते और खरीद की सहायता"),L("Account provides available data export, sign-out, contact controls, call-history controls and the enabled purchase status screen. Export and sign-out do not erase account data. For a disputed purchase, use the displayed status and contact support without sending passwords or payment tokens.","Account में उपलब्ध डेटा एक्सपोर्ट, साइन-आउट, संपर्क, कॉल इतिहास और चालू खरीद स्थिति के नियंत्रण मिलते हैं। एक्सपोर्ट और साइन-आउट खाता नहीं मिटाते। विवादित खरीद में दिखाई गई स्थिति के आधार पर सहायता लें; पासवर्ड या payment token न भेजें।"))+contact+
    card(L("Support response and complaints","सहायता का जवाब और शिकायत"),m.contact.supportHours[lang],m.contact.complaintProcess[lang],
      L(`The operator aims to acknowledge your request within ${m.contact.responseDays} days.`, `संचालक ${m.contact.responseDays} दिनों में अनुरोध की प्राप्ति की सूचना देने का लक्ष्य रखता है।`))+'</div><p><a class="action" href="./deletion.html">'+L("Request account deletion","खाता मिटाने का अनुरोध")+'</a></p>';
  return {privacy,terms,deletion,help};
}
export function renderPublicPolicies(m,baseHtml,options){
  const proof=validatePublicPolicy(m,options);let html=baseHtml;
  for(const lang of ["hi","en"])for(const [page,content] of Object.entries(policySections(m,lang))){
    const token="JODLO_POLICY_"+lang.toUpperCase()+"_"+page.toUpperCase();
    const start="<!-- "+token+"_BEGIN -->",end="<!-- "+token+"_END -->";
    if(html.split(start).length!==2||html.split(end).length!==2)throw Error("Website policy template markers changed");
    const a=html.indexOf(start)+start.length,b=html.indexOf(end);if(b<a)throw Error("Invalid policy template order");
    html=html.slice(0,a)+"\n"+content+"\n        "+html.slice(b);
  }
  html=html.replace('content="JODLO development-stage help for service discovery, Saved services, account export and data rights. Not a final legal policy."',
      'content="JODLO help, privacy notice, terms and account deletion contact."')
    .replace("© JODLO · विकास के दौरान सहायता की जानकारी","© "+textEscape(m.operator.name.hi)+" · JODLO")
    .replace("© JODLO · Development-stage help","© "+textEscape(m.operator.name.en)+" · JODLO");
  if(/<form\b|<iframe\b|<script[^>]+https?:\/\//i.test(html))throw Error("Policy shell acquired an unreviewed data channel");
  const documents={};
  for(const page of ["index","privacy","terms","deletion","help"]){
    const defaultPage=page==="index"?"home":page;
    documents[page+".html"]=html.replace("<body>",'<body data-default-page="'+defaultPage+'">')
      .replace(/<section data-page-panel="(home|privacy|terms|deletion|help)"(?: hidden)?>/g,
        (_,route)=>'<section data-page-panel="'+route+'"'+(route===defaultPage?"":" hidden")+'>');
  }
  return {documents,proof};
}
const staticFiles=["styles.css","app.js","_headers","public/jodlo-mark.png","public/favicon.png"];
async function readPolicySources(root){
  // A clean Git commit records a symlink's target, not the bytes outside the
  // repository that it points to. Never copy those mutable/private bytes into
  // a supposedly source-bound public policy candidate.
  for(const directory of ["apps","apps/web","apps/web/public"]){
    const stat=await lstat(join(root,directory));
    if(!stat.isDirectory()||stat.isSymbolicLink())throw Error("Unsafe policy source directory");
  }
  const files={};
  for(const name of ["index.html",...staticFiles]){
    const path=join(root,"apps/web",name),stat=await lstat(path);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>5*1024*1024)throw Error("Unsafe or oversized policy source file");
    files[name]=await readFile(path);
  }
  return files;
}
async function readManifest(path){const raw=await readFile(path);if(raw.length>131072)throw Error("Policy manifest too large");return JSON.parse(raw.toString("utf8"));}
function commitAt(root){return execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8",stdio:["ignore","pipe","ignore"]}).trim();}
export async function writePublicPolicyCandidate(m,{root=ROOT,now=Date.now()}={}){
  const sourceCommit=commitAt(root);
  const changes=execFileSync("git",["status","--porcelain"],{cwd:root,encoding:"utf8",stdio:["ignore","pipe","ignore"]});
  if(changes.trim())throw Error("Commit the exact reviewed source before preparing a publication candidate");
  const sourceFiles=await readPolicySources(root);
  const rendered=renderPublicPolicies(m,sourceFiles["index.html"].toString("utf8"),{sourceCommit,now});
  const privateRoot=join(root,".local-release");await mkdir(privateRoot,{recursive:true});
  const stat=await lstat(privateRoot);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error("Unsafe private release directory");
  const directory=".local-release/website-"+rendered.proof.scopeSha256.slice(0,16),out=join(root,directory);
  const temporary=join(privateRoot,"website-next-"+randomUUID());
  await mkdir(temporary);let installed=false;
  try{
    const files={};
    for(const [name,content] of Object.entries(rendered.documents)){await writeFile(join(temporary,name),content,{flag:"wx",mode:0o644});files[name]=sha(content);}
    await mkdir(join(temporary,"public"));
    for(const name of staticFiles){const bytes=sourceFiles[name];await writeFile(join(temporary,name),bytes,{flag:"wx",mode:0o644});files[name]=sha(bytes);}
    try{await lstat(out);throw Error("This policy candidate already exists; inspect it before preparing another version");}catch(error){if(error?.code!=="ENOENT")throw error;}
    await rename(temporary,out);installed=true;
    const evidence={kind:"JODLO_PUBLIC_POLICY_CANDIDATE_V1",sourceCommit,scopeSha256:rendered.proof.scopeSha256,directory,files,
      generatedAt:new Date(now).toISOString(),ownerApprovalSupplied:true,evidenceAuthentication:"MANUAL_REVIEW_REQUIRED",publicationAuthorized:false};
    const next=join(privateRoot,"policy-evidence-"+randomUUID()+".json");
    await writeFile(next,JSON.stringify(evidence,null,2)+"\n",{flag:"wx",mode:0o600});await rename(next,join(privateRoot,"policy-publication-evidence.json"));
    return {directory,sourceCommit,scopeSha256:rendered.proof.scopeSha256,urls:["privacy","terms","deletion","help"].map(x=>m.websiteOrigin+"/"+x+".html"),
      ownerApprovalSupplied:true,evidenceAuthentication:"MANUAL_REVIEW_REQUIRED",publicationAuthorized:false,providerRequests:0};
  }finally{if(!installed)await rm(temporary,{recursive:true,force:true});}
}
/** Readiness checks integrity only. No signature/authorship/legal assertion. */
export async function verifyPublicPolicyCandidate(root,sourceCommit){
  try{
    const privateRoot=join(root,".local-release"),stat=await lstat(privateRoot);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error("Unsafe output root");
    const evidencePath=join(privateRoot,"policy-publication-evidence.json"),evidenceStat=await lstat(evidencePath);
    if(!evidenceStat.isFile()||evidenceStat.isSymbolicLink()||evidenceStat.size>65536)throw Error("Invalid policy evidence");
    const e=JSON.parse(await readFile(evidencePath,"utf8"));
    if(!exact(e,["kind","sourceCommit","scopeSha256","directory","files","generatedAt","ownerApprovalSupplied","evidenceAuthentication","publicationAuthorized"])||
       e.kind!=="JODLO_PUBLIC_POLICY_CANDIDATE_V1"||e.sourceCommit!==sourceCommit||!/^[a-f0-9]{64}$/.test(e.scopeSha256)||
       e.directory!==".local-release/website-"+e.scopeSha256.slice(0,16)||e.ownerApprovalSupplied!==true||e.publicationAuthorized!==false||e.evidenceAuthentication!=="MANUAL_REVIEW_REQUIRED")throw Error("Stale/untrusted policy candidate");
    const expected=["index.html","privacy.html","terms.html","deletion.html","help.html",...staticFiles];
    if(!exact(e.files,expected))throw Error("Missing public policy output");
    const dirStat=await lstat(join(root,e.directory));if(!dirStat.isDirectory()||dirStat.isSymbolicLink())throw Error("Unsafe policy directory");
    const publicStat=await lstat(join(root,e.directory,"public"));if(!publicStat.isDirectory()||publicStat.isSymbolicLink())throw Error("Unsafe assets directory");
    const actual=(await readdir(join(root,e.directory))).filter(name=>name!=="public")
      .concat((await readdir(join(root,e.directory,"public"))).map(name=>"public/"+name));
    if(actual.sort().join("|")!==expected.sort().join("|"))throw Error("Unreviewed files were added to the publication directory");
    for(const [name,hash] of Object.entries(e.files)){
      const file=join(root,e.directory,name),s=await lstat(file);
      if(!s.isFile()||s.isSymbolicLink()||s.size>5*1024*1024||sha(await readFile(file))!==hash)throw Error("Policy file integrity failed");
    }
    return {id:"public_policy_candidate",status:"passed",detail:"Exact-commit generated policy files match their recorded hashes; legal review, contact delivery and actual public hosting still require manual acceptance."};
  }catch(error){return {id:"public_policy_candidate",status:error?.code==="ENOENT"?"missing":"invalid",detail:"Prepare an owner/legal/bilingual-reviewed policy candidate; never use the development help page as a final policy."};}
}
async function main(args){
  if(args.length===1&&args[0]==="--template")return console.log(JSON.stringify(publicPolicyTemplate(commitAt(ROOT)),null,2));
  if(args.length!==2||!["--scope-hash","--check","--write"].includes(args[0]))throw Error("Use --template, --scope-hash FILE, --check FILE or --write FILE");
  const m=await readManifest(args[1]);
  if(args[0]==="--scope-hash")return console.log(publicPolicyScopeHash(m));
  if(args[0]==="--check")return console.log(JSON.stringify(validatePublicPolicy(m,{sourceCommit:commitAt(ROOT)}),null,2));
  console.log(JSON.stringify(await writePublicPolicyCandidate(m),null,2));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(()=>{
  process.stderr.write("Public policy preparation refused incomplete, placeholder, stale or unapproved input. Review local data and evidence; no identity/contact was invented and nothing was published.\n");process.exitCode=1;
});
