// [Define404] munche-meo 웹 버전: 글을 붙여 넣으면 기본 규칙으로 검사한다.
// 메일 가입(수집 동의 필수, 광고 수신 동의 선택)을 하면 내 규칙 저장과 가이드 문서 등록이 열린다.
import { Hono, type Context, type Next } from "hono";
import { checkRules } from "../core/check.ts";
import { checkWithGuide, chunkGuide, cosine, localEmbed, mockComplete, type Complete, type GuideHit } from "../core/guide.ts";
import { consentNotice, marketingActive, marketingExpiresAt, MARKETING_TTL_DAYS, type ConsentAction } from "../core/consent.ts";
import { CHECK_TEXT_SCHEMA, handleRpc, type Tool } from "../core/mcp.ts";
import { BUILTIN_RULES, PACKS } from "../core/rules.ts";
import type { CheckOptions, Violation } from "../core/types.ts";
import { compileSpec, parseRuleYaml } from "../core/user-rules.ts";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  AI?: Ai;
  LIMITER?: RateLimit;
  EMBED_MODEL: string;
  LLM_MODEL: string;
  CONTACT_URL: string;
  MAIL_FROM: string;
  MOCK?: string;
  RESEND_API_KEY?: string;
  OWNER_EMAIL?: string;
}

type Vars = { leadId: number };
type C = Context<{ Bindings: Env; Variables: Vars }>;

const VERSION = "0.1.0";
const CONSENT_VERSION = "2026-10-09";
const MCP_BATCH_MAX = 20;
const LIMITS = { text: 20000, guideText: 50000, guides: 10, chunks: 300, rulesYaml: 20000, rules: 50 };

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

// 접속자별 요청 제한
app.use("/api/*", limit);
app.use("/mcp", limit);
async function limit(c: C, next: Next) {
  if (c.env.LIMITER) {
    const { success } = await c.env.LIMITER.limit({ key: c.req.header("CF-Connecting-IP") || "local" });
    if (!success) return c.json({ error: "요청이 많습니다. 잠시 후 다시 시도해 주세요" }, 429);
  }
  await next();
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// 가입 때 받은 열쇠(Bearer)로 본인 자료만 다룬다
async function auth(c: C, next: Next) {
  const token = (c.req.header("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!/^[a-f0-9]{64}$/.test(token)) return c.json({ error: "메일 가입 후 받은 열쇠가 필요합니다" }, 401);
  const row = await c.env.DB.prepare("SELECT id FROM leads WHERE token_hash = ?").bind(await sha256(token)).first<{ id: number }>();
  if (!row) return c.json({ error: "열쇠가 맞지 않습니다" }, 401);
  c.set("leadId", row.id);
  await next();
}

function readOptions(b: Record<string, unknown>): CheckOptions {
  const packs = Array.isArray(b.packs) ? b.packs.map(String).filter((p) => p in PACKS || p === "all") : undefined;
  const max = Number(b.max_eojeol);
  const prefer = ["auto", "formal", "plain"].includes(String(b.prefer)) ? (b.prefer as CheckOptions["prefer"]) : undefined;
  return { packs: packs?.length ? [...new Set(["default", ...packs])] : undefined, maxEojeol: max >= 5 && max <= 200 ? max : undefined, prefer };
}

// ---------- AI (MOCK=1 이면 로컬 임베딩·시험용 판정기) ----------

function mock(env: Env) {
  return env.MOCK === "1" || !env.AI;
}

async function embed(env: Env, texts: string[]): Promise<{ model: string; vecs: number[][] }> {
  if (mock(env)) return { model: "local-hash-512", vecs: texts.map((t) => Array.from(localEmbed(t))) };
  const out = (await env.AI!.run(env.EMBED_MODEL as never, { text: texts } as never)) as unknown as { data: number[][] };
  return { model: env.EMBED_MODEL, vecs: out.data };
}

function completer(env: Env): Complete {
  if (mock(env)) return mockComplete;
  return async (system, user) => {
    const out = (await env.AI!.run(env.LLM_MODEL as never, { messages: [{ role: "system", content: system }, { role: "user", content: user }], max_tokens: 800 } as never)) as { response?: unknown };
    return typeof out.response === "string" ? out.response : JSON.stringify(out.response ?? "");
  };
}

async function retrieveFor(env: Env, leadId: number, model: string) {
  const rows = await env.DB.prepare("SELECT g.name, c.idx, c.text, c.embedding FROM guide_chunks c JOIN guides g ON g.id = c.guide_id WHERE c.lead_id = ? AND g.model = ?")
    .bind(leadId, model)
    .all<{ name: string; idx: number; text: string; embedding: string }>();
  const items = rows.results.map((r) => ({ doc: r.name, chunk: r.idx, text: r.text, vec: JSON.parse(r.embedding) as number[] }));
  return async (q: string, k: number): Promise<GuideHit[]> => {
    const [qv] = (await embed(env, [q])).vecs;
    return items
      .map((i) => ({ doc: i.doc, chunk: i.chunk, text: i.text, score: cosine(qv, i.vec) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  };
}

async function userRuleSpecs(env: Env, leadId: number) {
  const row = await env.DB.prepare("SELECT yaml FROM user_rules WHERE lead_id = ?").bind(leadId).first<{ yaml: string }>();
  return row ? parseRuleYaml(row.yaml) : [];
}

async function leadFromHeader(c: C): Promise<number | null> {
  const token = (c.req.header("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const row = await c.env.DB.prepare("SELECT id FROM leads WHERE token_hash = ?").bind(await sha256(token)).first<{ id: number }>();
  return row?.id ?? null;
}

// ---------- 검사 ----------

app.get("/api/health", (c) => c.json({ ok: true, version: VERSION, mock: mock(c.env) }));

app.get("/api/meta", (c) =>
  c.json({ packs: PACKS, rules: BUILTIN_RULES.map((r) => ({ id: r.id, pack: r.pack, severity: r.severity, description: r.description })), contact: c.env.CONTACT_URL }),
);

// 열쇠 없이도 기본 규칙으로 검사한다. 열쇠가 있으면 내 규칙과 (guide: true 일 때) 가이드 판정을 더한다
app.post("/api/check", async (c) => {
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const text = String(b.text ?? "");
  if (!text.trim()) return c.json({ error: "검사할 글을 넣어 주세요" }, 400);
  if (text.length > LIMITS.text) return c.json({ error: `글은 ${LIMITS.text}자까지 검사합니다` }, 413);
  const opts = readOptions(b);
  const leadId = await leadFromHeader(c);
  const specs = leadId ? await userRuleSpecs(c.env, leadId) : [];
  const violations: Violation[] = checkRules(text, opts, specs.map(compileSpec));
  let guide = "꺼짐";
  if (leadId && b.guide === true) {
    const model = mock(c.env) ? "local-hash-512" : c.env.EMBED_MODEL;
    const retrieve = await retrieveFor(c.env, leadId, model);
    violations.push(...(await checkWithGuide(text, retrieve, completer(c.env))));
    violations.sort((a, z) => a.line - z.line);
    guide = mock(c.env) ? "켜짐 (시험용 판정기)" : "켜짐";
  }
  return c.json({ count: violations.length, violations, user_rules: specs.length, guide_layer: guide });
});

// ---------- 메일 가입 ----------

app.post("/api/signup", async (c) => {
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const email = String(b.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/.test(email)) return c.json({ error: "메일 주소를 확인해 주세요" }, 400);
  if (b.consent_privacy !== true) return c.json({ error: "개인정보 수집·이용에 동의해야 가입할 수 있습니다" }, 400);
  const marketing = b.consent_marketing === true;
  const exists = await c.env.DB.prepare("SELECT id FROM leads WHERE email = ?").bind(email).first();
  // 메일 확인 기능이 없는 v0.1 에서는 같은 메일로 새 열쇠를 내주지 않는다 (남의 메일로 열쇠를 가로채지 못하게)
  if (exists) return c.json({ error: "이미 가입한 메일입니다. 처음 받은 열쇠를 써 주세요" }, 409);

  const token = randomHex();
  const unsub = randomHex();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    "INSERT INTO leads (email, token_hash, consent_privacy_at, consent_marketing, consent_marketing_at, consent_version, created_at, unsub_token) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(email, await sha256(token), now, marketing ? 1 : 0, marketing ? now : null, CONSENT_VERSION, now, unsub)
    .run();
  c.executionCtx.waitUntil(notifyOwner(c.env, email, marketing));
  // 광고 수신 동의·거부 결과를 본인에게 알린다 (정보통신망법 제50조 제7항)
  c.executionCtx.waitUntil(notifyConsent(c.env, email, marketing ? "consent" : "refuse", now, marketing ? unsubUrl(c, unsub) : undefined));
  return c.json({ token, email, consent_marketing: marketing });
});

function randomHex(): string {
  return [...crypto.getRandomValues(new Uint8Array(32))].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function unsubUrl(c: C, unsub: string): string {
  return `${new URL(c.req.url).origin}/api/unsubscribe?t=${unsub}`;
}

// 처리 결과 안내 메일. 메일 설정(RESEND_API_KEY)이 없으면 메일 주소 없이 처리 종류만 로그에 남긴다
async function notifyConsent(env: Env, email: string, action: ConsentAction, at: string, unsubscribeUrl?: string) {
  const { subject, text } = consentNotice({ action, at, contactUrl: env.CONTACT_URL, unsubscribeUrl });
  if (!env.RESEND_API_KEY) {
    console.log(`동의 처리 결과 안내 (메일 미설정): ${action} ${at}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [email], subject, text }),
  });
  if (!res.ok) console.error("동의 처리 결과 안내 메일 실패", res.status);
}

async function notifyOwner(env: Env, email: string, marketing: boolean) {
  const body = `munche-meo 새 가입\n메일: ${email}\n광고성 정보 수신: ${marketing ? "동의" : "미동의"}\n시각: ${new Date().toISOString()}`;
  if (!env.RESEND_API_KEY || !env.OWNER_EMAIL) {
    console.log(body);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [env.OWNER_EMAIL], subject: "[munche-meo] 새 가입", text: body }),
  });
  if (!res.ok) console.error("가입 알림 메일 실패", res.status);
}

type LeadRow = { email: string; consent_marketing: number; consent_marketing_at: string | null; unsub_token: string | null };

// 내 가입 정보와 광고 수신 동의 상태. 2년이 지난 동의는 끝난 것으로 보여 준다
app.get("/api/me", auth, async (c) => {
  const row = (await c.env.DB.prepare("SELECT email, consent_marketing, consent_marketing_at, unsub_token FROM leads WHERE id = ?").bind(c.get("leadId")).first<LeadRow>())!;
  const active = marketingActive(row);
  return c.json({ email: row.email, consent_marketing: active, consent_marketing_at: active ? row.consent_marketing_at : null, consent_marketing_expires_at: active ? marketingExpiresAt(row.consent_marketing_at!) : null });
});

// 가입 뒤에 광고 수신 동의를 하거나 철회한다. 어느 쪽이든 다른 기능에는 영향이 없다
app.put("/api/me/marketing", auth, async (c) => {
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  if (typeof b.consent !== "boolean") return c.json({ error: "consent 값(true, false)이 필요합니다" }, 400);
  const id = c.get("leadId");
  const row = (await c.env.DB.prepare("SELECT email, consent_marketing, consent_marketing_at, unsub_token FROM leads WHERE id = ?").bind(id).first<LeadRow>())!;
  const now = new Date().toISOString();
  if (b.consent) {
    const unsub = row.unsub_token || randomHex();
    await c.env.DB.prepare("UPDATE leads SET consent_marketing = 1, consent_marketing_at = ?, unsub_token = ? WHERE id = ?").bind(now, unsub, id).run();
    c.executionCtx.waitUntil(notifyConsent(c.env, row.email, "consent", now, unsubUrl(c, unsub)));
  } else {
    await c.env.DB.prepare("UPDATE leads SET consent_marketing = 0, consent_marketing_at = NULL WHERE id = ?").bind(id).run();
    c.executionCtx.waitUntil(notifyConsent(c.env, row.email, "withdraw", now));
  }
  return c.json({ consent_marketing: b.consent, at: now, notice: c.env.RESEND_API_KEY ? "mail" : "log" });
});

// 메일 속 수신 거부 링크. 열쇠 없이 한 번 누르면 철회되고 비용이 들지 않는다 (제50조 제4항·제6항)
app.on(["GET", "POST"], "/api/unsubscribe", async (c) => {
  const t = c.req.query("t") || "";
  const page = (msg: string, status: 200 | 404) =>
    c.html(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>문체냥 수신 거부</title></head><body style="font-family:sans-serif;max-width:560px;margin:40px auto;padding:0 16px;word-break:keep-all"><p>${msg}</p><p>보낸 곳: Define404 · 연락처: <a href="${c.env.CONTACT_URL}">${c.env.CONTACT_URL}</a></p></body></html>`, status);
  if (!/^[a-f0-9]{64}$/.test(t)) return page("수신 거부 링크가 맞지 않습니다. 연락처로 알려 주시면 바로 철회해 드립니다.", 404);
  const row = await c.env.DB.prepare("SELECT email, consent_marketing, consent_marketing_at, unsub_token FROM leads WHERE unsub_token = ?").bind(t).first<LeadRow>();
  if (!row) return page("이미 탈퇴했거나 없는 링크입니다. 광고성 메일은 보내지 않습니다.", 404);
  if (row.consent_marketing) {
    const now = new Date().toISOString();
    await c.env.DB.prepare("UPDATE leads SET consent_marketing = 0, consent_marketing_at = NULL WHERE unsub_token = ?").bind(t).run();
    c.executionCtx.waitUntil(notifyConsent(c.env, row.email, "withdraw", now));
  }
  return page(`광고성 정보 수신 동의를 철회했습니다. 이후 광고성 메일은 보내지 않습니다.${c.env.RESEND_API_KEY ? " 처리 결과는 메일로도 알려 드립니다." : ""}`, 200);
});

// 탈퇴: 메일, 동의 기록, 규칙, 가이드를 모두 지운다
app.delete("/api/me", auth, async (c) => {
  const id = c.get("leadId");
  const row = await c.env.DB.prepare("SELECT email FROM leads WHERE id = ?").bind(id).first<{ email: string }>();
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM guide_chunks WHERE lead_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM guides WHERE lead_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM user_rules WHERE lead_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM leads WHERE id = ?").bind(id),
  ]);
  if (row) c.executionCtx.waitUntil(notifyConsent(c.env, row.email, "leave", new Date().toISOString()));
  return c.json({ deleted: true });
});

// ---------- 내 규칙 ----------

app.get("/api/rules", auth, async (c) => {
  const row = await c.env.DB.prepare("SELECT yaml, updated_at FROM user_rules WHERE lead_id = ?").bind(c.get("leadId")).first();
  return c.json(row ?? { yaml: "", updated_at: null });
});

app.put("/api/rules", auth, async (c) => {
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const yaml = String(b.yaml ?? "");
  if (yaml.length > LIMITS.rulesYaml) return c.json({ error: "규칙 파일이 너무 깁니다" }, 413);
  let count = 0;
  try {
    const specs = parseRuleYaml(yaml);
    if (specs.length > LIMITS.rules) throw new Error(`규칙은 ${LIMITS.rules}개까지 저장합니다`);
    specs.forEach(compileSpec);
    count = specs.length;
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
  await c.env.DB.prepare("INSERT OR REPLACE INTO user_rules (lead_id, yaml, updated_at) VALUES (?, ?, ?)").bind(c.get("leadId"), yaml, new Date().toISOString()).run();
  return c.json({ saved: count });
});

// ---------- 가이드 문서 ----------

app.get("/api/guides", auth, async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT g.id, g.name, g.model, g.created_at, COUNT(c.id) AS chunks FROM guides g LEFT JOIN guide_chunks c ON c.guide_id = g.id WHERE g.lead_id = ? GROUP BY g.id ORDER BY g.id",
  )
    .bind(c.get("leadId"))
    .all();
  return c.json({ guides: rows.results });
});

app.post("/api/guides", auth, async (c) => {
  const id = c.get("leadId");
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const name = String(b.name ?? "").trim().slice(0, 100);
  const text = String(b.text ?? "");
  if (!name || !text.trim()) return c.json({ error: "문서 이름과 내용을 넣어 주세요" }, 400);
  if (text.length > LIMITS.guideText) return c.json({ error: `문서는 ${LIMITS.guideText}자까지 받습니다` }, 413);
  const chunks = chunkGuide(text);
  const used = await c.env.DB.prepare("SELECT (SELECT COUNT(*) FROM guides WHERE lead_id = ?1) AS g, (SELECT COUNT(*) FROM guide_chunks WHERE lead_id = ?1) AS k")
    .bind(id)
    .first<{ g: number; k: number }>();
  if ((used?.g ?? 0) >= LIMITS.guides) return c.json({ error: `가이드 문서는 ${LIMITS.guides}개까지 등록합니다` }, 409);
  if ((used?.k ?? 0) + chunks.length > LIMITS.chunks) return c.json({ error: `조각은 모두 ${LIMITS.chunks}개까지 저장합니다` }, 409);

  const vecs: number[][] = [];
  let model = "";
  for (let i = 0; i < chunks.length; i += 50) {
    const r = await embed(c.env, chunks.slice(i, i + 50).map((x) => x.text));
    model = r.model;
    vecs.push(...r.vecs);
  }
  const g = await c.env.DB.prepare("INSERT INTO guides (lead_id, name, model, created_at) VALUES (?, ?, ?, ?) RETURNING id")
    .bind(id, name, model, new Date().toISOString())
    .first<{ id: number }>();
  await c.env.DB.batch(
    chunks.map((ch, i) => c.env.DB.prepare("INSERT INTO guide_chunks (guide_id, lead_id, idx, text, embedding) VALUES (?, ?, ?, ?, ?)").bind(g!.id, id, ch.idx, ch.text, JSON.stringify(vecs[i]))),
  );
  return c.json({ id: g!.id, name, chunks: chunks.length, model });
});

app.delete("/api/guides/:id", auth, async (c) => {
  const gid = Number(c.req.param("id"));
  if (!Number.isInteger(gid)) return c.json({ error: "not found" }, 404);
  // 본인 문서만 지운다. 남의 문서 번호면 없는 것과 같게 404
  const own = await c.env.DB.prepare("SELECT id FROM guides WHERE id = ? AND lead_id = ?").bind(gid, c.get("leadId")).first();
  if (!own) return c.json({ error: "not found" }, 404);
  await c.env.DB.batch([c.env.DB.prepare("DELETE FROM guide_chunks WHERE guide_id = ?").bind(gid), c.env.DB.prepare("DELETE FROM guides WHERE id = ?").bind(gid)]);
  return c.json({ deleted: gid });
});

app.post("/api/guides/search", auth, async (c) => {
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const q = String(b.query ?? "").slice(0, 1000);
  if (!q.trim()) return c.json({ error: "찾을 말을 넣어 주세요" }, 400);
  const model = mock(c.env) ? "local-hash-512" : c.env.EMBED_MODEL;
  const retrieve = await retrieveFor(c.env, c.get("leadId"), model);
  return c.json({ hits: await retrieve(q, 4) });
});

// ---------- 원격 MCP (상태 없는 HTTP, 기본 규칙만) ----------

const remoteTools: Tool[] = [
  {
    name: "check_text",
    description: "한국어 글을 문장 단위로 검사해 규칙 위반을 돌려줍니다. 고쳐 쓰지 않습니다. 원격 버전은 기본 규칙만 씁니다.",
    inputSchema: CHECK_TEXT_SCHEMA,
    async run(a) {
      const text = String(a.text ?? "").slice(0, LIMITS.text);
      const violations = checkRules(text, readOptions(a));
      return { count: violations.length, violations };
    },
  },
  {
    name: "list_rules",
    description: "기본 규칙 묶음과 규칙 목록을 보여 줍니다.",
    inputSchema: { type: "object", properties: {} },
    async run() {
      return { packs: PACKS, rules: BUILTIN_RULES.map((r) => ({ id: r.id, pack: r.pack, severity: r.severity, description: r.description })) };
    },
  },
];

app.post("/mcp", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, 400);
  const msgs: unknown[] = Array.isArray(body) ? body : [body];
  // 한 요청에 묶을 수 있는 메시지 수를 제한한다 (요청 제한을 묶음으로 우회하지 못하게)
  if (msgs.length > MCP_BATCH_MAX) return c.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: `batch up to ${MCP_BATCH_MAX}` } }, 400);
  const invalid = { jsonrpc: "2.0", id: null, error: { code: -32600, message: "invalid request" } };
  const out = (
    await Promise.all(msgs.map((m) => (m && typeof m === "object" && !Array.isArray(m) ? handleRpc(m as Record<string, unknown>, remoteTools, "munche-meo", VERSION) : invalid)))
  ).filter(Boolean);
  if (!out.length) return c.body(null, 202);
  return c.json(Array.isArray(body) ? out : out[0]);
});
app.get("/mcp", (c) => c.json({ error: "POST JSON-RPC only" }, 405));

app.notFound((c) => (c.req.path.startsWith("/api") || c.req.path === "/mcp" ? c.json({ error: "not found" }, 404) : c.env.ASSETS.fetch(c.req.raw)));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "잠시 후 다시 시도해 주세요" }, 500);
});

// 매일 한국 시각 오전 10시(wrangler.toml cron): 동의한 지 2년이 지난 광고 수신 동의를 끝내고 본인에게 알린다 (제50조 제8항)
async function expireMarketing(env: Env) {
  const cutoff = new Date(Date.now() - MARKETING_TTL_DAYS * 86400000).toISOString();
  const rows = await env.DB.prepare("SELECT id, email FROM leads WHERE consent_marketing = 1 AND consent_marketing_at <= ?").bind(cutoff).all<{ id: number; email: string }>();
  const now = new Date().toISOString();
  for (const r of rows.results) {
    await env.DB.prepare("UPDATE leads SET consent_marketing = 0, consent_marketing_at = NULL WHERE id = ?").bind(r.id).run();
    await notifyConsent(env, r.email, "expire", now);
  }
}

export default {
  fetch: app.fetch,
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(expireMarketing(env));
  },
} satisfies ExportedHandler<Env>;
