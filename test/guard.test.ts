// [Define404] 다른 사이트 쓰기 요청 차단 시험 (src/web/guard.ts, src/web/worker.ts)
import assert from "node:assert/strict";
import { test } from "node:test";
import { originBlock } from "../src/web/guard.ts";
import worker from "../src/web/worker.ts";

const SITE = "https://munche.define404.com";

// 쓰기 호출을 기록하는 가짜 D1. 수신 거부 토큰 한 건만 들고 있다
function fakeDb(unsub: string) {
  const writes: string[] = [];
  const db = {
    writes,
    prepare(sql: string) {
      const stmt = {
        bind: () => stmt,
        async first() {
          if (/FROM leads WHERE unsub_token/.test(sql)) return { email: "john@define404.com", consent_marketing: 1, consent_marketing_at: "2026-10-09T00:00:00.000Z", unsub_token: unsub };
          return null;
        },
        async run() {
          writes.push(sql);
          return { success: true };
        },
        async all() {
          return { results: [] };
        },
      };
      return stmt;
    },
    async batch() {
      writes.push("batch");
      return [];
    },
  };
  return db;
}

function setup(mock = "0") {
  const unsub = "a".repeat(64);
  const db = fakeDb(unsub);
  const env = {
    DB: db,
    ASSETS: { fetch: async () => new Response("asset") },
    EMBED_MODEL: "x",
    LLM_MODEL: "x",
    CONTACT_URL: "https://contact.define404.com",
    MAIL_FROM: "x <john@define404.com>",
    MOCK: mock,
    PUBLIC_URL: SITE,
  };
  const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} };
  const call = (path: string, init: RequestInit = {}) => worker.fetch(new Request(SITE + path, init) as never, env as never, ctx as never) as Promise<Response>;
  return { call, db, unsub };
}

const json = (body: unknown, headers: Record<string, string> = {}) => ({ method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

test("판정 함수: 같은 사이트·허용 목록·서버 요청은 통과, 다른 사이트는 거절", () => {
  const h = (o: Record<string, string>) => new Headers(o);
  const env = { PUBLIC_URL: SITE };
  assert.equal(originBlock("POST", h({ Origin: SITE }), SITE + "/api/check", env), null);
  assert.equal(originBlock("POST", h({ Origin: SITE }), "https://munche-meo.example.workers.dev/api/check", env), null);
  assert.ok(originBlock("POST", h({ Origin: "https://evil.example" }), SITE + "/api/check", env));
  assert.equal(originBlock("POST", h({ Origin: "null", "Sec-Fetch-Site": "same-origin" }), SITE + "/x", env), null);
  assert.ok(originBlock("POST", h({ Origin: "null", "Sec-Fetch-Site": "cross-site" }), SITE + "/x", env));
  assert.ok(originBlock("POST", h({ Origin: "null" }), SITE + "/x", env));
  assert.equal(originBlock("POST", h({}), SITE + "/x", env), null);
  assert.ok(originBlock("POST", h({ "Sec-Fetch-Site": "cross-site" }), SITE + "/x", env));
  assert.equal(originBlock("GET", h({ Origin: "https://evil.example" }), SITE + "/x", env), null);
  assert.ok(originBlock("POST", h({ Origin: "http://localhost:8787" }), SITE + "/x", env));
  assert.equal(originBlock("POST", h({ Origin: "http://localhost:8787" }), SITE + "/x", { ...env, MOCK: "1" }), null);
});

test("같은 사이트 JSON 검사 요청은 통과한다", async () => {
  const { call } = setup();
  const r = await call("/api/check", json({ text: "글을 검사합니다." }, { Origin: SITE, "Sec-Fetch-Site": "same-origin" }));
  assert.equal(r.status, 200);
  assert.equal(typeof ((await r.json()) as { count: unknown }).count, "number");
});

test("다른 사이트 Origin 의 가입 요청은 403 이고 아무것도 쓰지 않는다", async () => {
  const { call, db } = setup();
  const r = await call("/api/signup", json({ email: "john@define404.com", consent_privacy: true }, { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" }));
  assert.equal(r.status, 403);
  assert.equal(db.writes.length, 0);
});

test("다른 사이트에서 text/plain 으로 보낸 단순 요청도 403", async () => {
  const { call, db } = setup();
  for (const path of ["/api/signup", "/api/check", "/mcp"]) {
    const r = await call(path, { method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "text/plain" }, body: '{"email":"john@define404.com","consent_privacy":true}' });
    assert.equal(r.status, 403, path);
  }
  assert.equal(db.writes.length, 0);
});

test("Origin: null 은 Sec-Fetch-Site: same-origin 일 때만 통과", async () => {
  const { call } = setup();
  const ok = await call("/api/check", json({ text: "글입니다." }, { Origin: "null", "Sec-Fetch-Site": "same-origin" }));
  assert.equal(ok.status, 200);
  const bad = await call("/api/check", json({ text: "글입니다." }, { Origin: "null", "Sec-Fetch-Site": "cross-site" }));
  assert.equal(bad.status, 403);
});

test("Origin 이 없는 서버 요청(원격 MCP 등)은 통과한다", async () => {
  const { call } = setup();
  const r = await call("/mcp", json({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
  assert.equal(r.status, 200);
  const body = (await r.json()) as { result: { tools: unknown } };
  assert.ok(Array.isArray(body.result.tools));
  const chk = await call("/api/check", json({ text: "글입니다." }));
  assert.equal(chk.status, 200);
  const cross = await call("/api/check", json({ text: "글입니다." }, { "Sec-Fetch-Site": "cross-site" }));
  assert.equal(cross.status, 403);
});

test("JSON API 쓰기 경로는 application/json 이 아니면 415", async () => {
  const { call } = setup();
  const r = await call("/api/check", { method: "POST", headers: { Origin: SITE, "Content-Type": "text/plain" }, body: '{"text":"글입니다."}' });
  assert.equal(r.status, 415);
  const ok = await call("/api/check", { method: "POST", headers: { Origin: SITE, "Content-Type": "application/json; charset=utf-8" }, body: '{"text":"글입니다."}' });
  assert.equal(ok.status, 200);
});

test("원클릭 수신 거부(RFC 8058)는 Origin 없이 폼 전송으로 그대로 된다", async () => {
  const { call, db, unsub } = setup();
  const r = await call(`/api/unsubscribe?t=${unsub}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" });
  assert.equal(r.status, 200);
  assert.ok(db.writes.some((s) => /UPDATE leads SET consent_marketing = 0/.test(s)));
});
