// [Define404] munche-meo 메일 보내기
// 고르는 순서: Gmail API(GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN) > Resend(RESEND_API_KEY) > 로그만
// Gmail은 gmail.send 권한만 있는 갱신 토큰으로 접근 토큰을 받아 RFC 5322 메시지를 그대로 보낸다

export interface MailEnv {
  MAIL_FROM: string;
  GMAIL_CLIENT_ID?: string;
  GMAIL_CLIENT_SECRET?: string;
  GMAIL_REFRESH_TOKEN?: string;
  RESEND_API_KEY?: string;
}

export interface Mail {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  // List-Unsubscribe, List-Unsubscribe-Post 같은 머리글을 그대로 붙인다
  headers?: Record<string, string>;
}

export type MailProvider = "gmail" | "resend" | "log";

export function mailProvider(env: MailEnv): MailProvider {
  if (env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN) return "gmail";
  if (env.RESEND_API_KEY) return "resend";
  return "log";
}

// ---------- MIME ----------

function utf8Base64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function base64url(s: string): string {
  return utf8Base64(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// 머리글 값에 ASCII 밖 글자가 있으면 =?UTF-8?B?...?= 로 바꾼다. 길면 75자를 넘지 않게 나눈다
export function encodeWord(s: string): string {
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  const words: string[] = [];
  let cur = "";
  for (const ch of s) {
    // base64 한 덩어리의 원문을 45바이트 안으로 묶는다 (인코딩 후 60자, 앞뒤 표시 포함 72자)
    if (new TextEncoder().encode(cur + ch).length > 45) {
      words.push(cur);
      cur = "";
    }
    cur += ch;
  }
  if (cur) words.push(cur);
  return words.map((w) => `=?UTF-8?B?${utf8Base64(w)}?=`).join("\r\n ");
}

// "이름 <주소>" 또는 "주소" 를 받아 이름 부분만 인코딩한다
export function encodeAddress(addr: string): string {
  const m = addr.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (!m) return addr.trim();
  const name = m[1].trim();
  if (!name) return `<${m[2]}>`;
  const enc = encodeWord(name);
  return enc === name && /[(),.:;<>@[\]\\"]/.test(name) ? `"${name.replace(/["\\]/g, "\\$&")}" <${m[2]}>` : `${enc} <${m[2]}>`;
}

function addrOnly(addr: string): string {
  const m = addr.match(/<([^>]+)>/);
  return (m ? m[1] : addr).trim();
}

function wrap76(b64: string): string {
  return b64.replace(/.{1,76}/g, "$&\r\n").replace(/\r\n$/, "");
}

function randomId(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function buildMime(mail: Mail, now = new Date()): string {
  const fromAddr = addrOnly(mail.from);
  const domain = fromAddr.split("@")[1] || "localhost";
  const boundary = `=_munche_${randomId()}`;
  const html = mail.html ?? textToHtml(mail.text);
  const head: string[] = [
    `From: ${encodeAddress(mail.from)}`,
    `To: ${encodeAddress(mail.to)}`,
    `Subject: ${encodeWord(mail.subject)}`,
    `Date: ${now.toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${randomId()}@${domain}>`,
    "MIME-Version: 1.0",
  ];
  if (mail.replyTo) head.push(`Reply-To: ${encodeAddress(mail.replyTo)}`);
  for (const [k, v] of Object.entries(mail.headers ?? {})) {
    if (/^[A-Za-z0-9-]+$/.test(k) && !/[\r\n]/.test(v)) head.push(`${k}: ${v}`);
  }
  head.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
  const part = (type: string, body: string) =>
    [`--${boundary}`, `Content-Type: ${type}; charset=UTF-8`, "Content-Transfer-Encoding: base64", "", wrap76(utf8Base64(body))].join("\r\n");
  return [head.join("\r\n"), "", part("text/plain", mail.text), part("text/html", html), `--${boundary}--`, ""].join("\r\n");
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// 안내 메일은 글자만 쓰므로 같은 내용을 HTML로 옮긴다. 주소는 누를 수 있게 링크로 바꾼다
export function textToHtml(text: string): string {
  const body = esc(text)
    .replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}">${u}</a>`)
    .replace(/\n/g, "<br>\n");
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo',sans-serif;font-size:15px;line-height:1.7;color:#141414;word-break:keep-all">${body}</body></html>`;
}

// ---------- 보내기 ----------

let cachedToken: { value: string; exp: number; key: string } | null = null;

async function gmailAccessToken(env: MailEnv): Promise<string> {
  const key = `${env.GMAIL_CLIENT_ID}:${env.GMAIL_REFRESH_TOKEN?.slice(-8)}`;
  if (cachedToken && cachedToken.key === key && cachedToken.exp > Date.now() + 60_000) return cachedToken.value;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: env.GMAIL_CLIENT_ID!,
      client_secret: env.GMAIL_CLIENT_SECRET!,
      refresh_token: env.GMAIL_REFRESH_TOKEN!,
    }),
  });
  if (!res.ok) throw new Error(`Gmail 접근 토큰 발급 실패 ${res.status}`);
  const j = (await res.json()) as { access_token: string; expires_in?: number };
  cachedToken = { value: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000, key };
  return j.access_token;
}

export async function sendMail(env: MailEnv, mail: Mail): Promise<MailProvider> {
  const provider = mailProvider(env);
  if (provider === "gmail") {
    const token = await gmailAccessToken(env);
    const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ raw: base64url(buildMime(mail)) }),
    });
    if (!res.ok) throw new Error(`Gmail 발송 실패 ${res.status}`);
    return provider;
  }
  if (provider === "resend") {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: mail.from,
        to: [mail.to],
        subject: mail.subject,
        text: mail.text,
        html: mail.html ?? textToHtml(mail.text),
        ...(mail.replyTo ? { reply_to: mail.replyTo } : {}),
        ...(mail.headers ? { headers: mail.headers } : {}),
      }),
    });
    if (!res.ok) throw new Error(`Resend 발송 실패 ${res.status}`);
    return provider;
  }
  return provider;
}
