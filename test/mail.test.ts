// [Define404] munche-meo 메일 MIME 시험
import assert from "node:assert/strict";
import { test } from "node:test";
import { base64url, buildMime, encodeAddress, encodeWord, mailProvider } from "../src/core/mail.ts";
import { consentNotice } from "../src/core/consent.ts";

function decodeWords(v: string): string {
  return v
    .split(/\r\n /)
    .map((w) => {
      const m = w.match(/^=\?UTF-8\?B\?(.+)\?=$/);
      return m ? Buffer.from(m[1], "base64").toString("utf8") : w;
    })
    .join("");
}

test("한글 제목과 보낸 이 이름을 UTF-8 인코딩 단어로 바꾼다", () => {
  const subject = "[문체냥] 광고성 정보 수신 동의 처리 결과 안내";
  const enc = encodeWord(subject);
  assert.match(enc, /^=\?UTF-8\?B\?/);
  for (const line of enc.split("\r\n")) assert.ok(line.length <= 76, line);
  assert.equal(decodeWords(enc), subject);
  assert.equal(encodeWord("plain ascii"), "plain ascii");
  const from = encodeAddress("문체냥 <john@define404.com>");
  assert.match(from, /^=\?UTF-8\?B\?.+\?= <john@define404\.com>$/);
});

test("MIME 메시지에 머리글과 글자·HTML 두 부분이 다 들어간다", () => {
  const { subject, text } = consentNotice({ action: "consent", at: "2026-10-09T00:00:00.000Z", contactUrl: "https://contact.define404.com", privacyUrl: "https://contact.define404.com/privacy.html", unsubscribeUrl: "https://munche.define404.com/api/unsubscribe?t=x" });
  const raw = buildMime({
    from: "문체냥 <john@define404.com>",
    to: "john@define404.com",
    subject,
    text,
    replyTo: "hello@define404.com",
    headers: { "List-Unsubscribe": "<https://munche.define404.com/api/unsubscribe?t=x>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click", "X-Bad": "a\r\nBcc: x@y.z" },
  });
  const [head, body] = raw.split("\r\n\r\n", 2);
  assert.match(head, /^From: =\?UTF-8\?B\?/m);
  assert.match(head, /^To: john@define404\.com$/m);
  assert.match(head, /^Subject: =\?UTF-8\?B\?/m);
  assert.match(head, /^Date: .+\+0000$/m);
  assert.match(head, /^Message-ID: <[a-f0-9]+@define404\.com>$/m);
  assert.match(head, /^MIME-Version: 1\.0$/m);
  assert.match(head, /^Reply-To: hello@define404\.com$/m);
  assert.match(head, /^List-Unsubscribe-Post: List-Unsubscribe=One-Click$/m);
  assert.doesNotMatch(head, /Bcc/);
  const boundary = head.match(/boundary="([^"]+)"/)![1];
  assert.match(head, /Content-Type: multipart\/alternative/);
  const parts = raw.split(`--${boundary}`).slice(1, -1);
  assert.equal(parts.length, 2);
  const decode = (p: string) => Buffer.from(p.split("\r\n\r\n")[1].replace(/\r\n/g, ""), "base64").toString("utf8");
  assert.match(parts[0], /Content-Type: text\/plain; charset=UTF-8/);
  assert.match(parts[1], /Content-Type: text\/html; charset=UTF-8/);
  assert.equal(decode(parts[0]), text);
  assert.match(decode(parts[1]), /<a href="https:\/\/contact\.define404\.com\/privacy\.html">/);
  assert.ok(body.length > 0);
  assert.ok(raw.split("\r\n").every((l) => l.length <= 998));
});

test("base64url 과 메일 경로 고르기", () => {
  assert.doesNotMatch(base64url("한글 ??>>"), /[+/=]/);
  assert.equal(mailProvider({ MAIL_FROM: "x" }), "log");
  assert.equal(mailProvider({ MAIL_FROM: "x", RESEND_API_KEY: "k" }), "resend");
  assert.equal(mailProvider({ MAIL_FROM: "x", RESEND_API_KEY: "k", GMAIL_CLIENT_ID: "a", GMAIL_CLIENT_SECRET: "b", GMAIL_REFRESH_TOKEN: "c" }), "gmail");
});
