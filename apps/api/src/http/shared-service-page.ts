import type { PublicApprovedServiceDetail } from "../modules/workers/listings.ts";

function escapeText(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function sharedServicePage(lang: "hi" | "en", detail: PublicApprovedServiceDetail | null, status: number): Response {
  const hi = lang === "hi";
  let title: string;
  let body = "";
  if (detail) {
    title = detail.category.name;
    if (detail.city) {
      const cities = hi ? {bilaspur: "बिलासपुर", raipur: "रायपुर"} : {bilaspur: "Bilaspur", raipur: "Raipur"};
      body += '<p>' + (hi ? "सेवा का शहर" : "Service city") + ' · ' + cities[detail.city] + '</p>';
    }
    if (detail.profile) {
      body += '<h2>' + escapeText(detail.profile.displayName) + '</h2><p>' + escapeText(detail.profile.description) + '</p>';
    }
    body += '<p>' + (hi ? "समय और उपलब्धता पूछने के लिए उस बातचीत में जवाब दें जहाँ आपको यह लिंक मिला था।" : "Reply in the conversation where you received this link to ask about timing and availability.") + '</p>';
  } else if (status === 503) {
    title = hi ? "सेवा की जानकारी अभी लोड नहीं हुई। कुछ देर बाद फिर खोलें।" : "Service details could not load. Try again shortly.";
  } else {
    title = hi ? "इस लिंक पर सेवा उपलब्ध नहीं है।" : "This service is unavailable at this link.";
  }
  const heading = escapeText(title);
  const html = `<!doctype html><html lang="${lang}"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${heading} · JODLO</title><style>body{margin:0;background:#101318;color:#fafafa;font:1.125rem/1.55 system-ui,sans-serif}main{max-width:38rem;margin:auto;padding:2rem 1.25rem;overflow-wrap:anywhere}header{color:#b4c4da;font-weight:700}h1{line-height:1.25}</style><main><header>जोड़ लो · JODLO</header><h1>${heading}</h1>${body}</main></html>`;
  return new Response(html, {status, headers: {
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  }});
}
