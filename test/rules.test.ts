// [Define404] munche-meo 시험: node --test test/
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkRules } from "../src/core/check.ts";
import { classify } from "../src/core/ending.ts";
import { consentNotice, marketingActive, marketingExpiresAt } from "../src/core/consent.ts";
import { chunkGuide } from "../src/core/guide.ts";
import { handleRpc } from "../src/core/mcp.ts";
import { compileSpec, parseRuleYaml } from "../src/core/user-rules.ts";

// 엠대시 문자는 저장소에 남기지 않으려고 코드로 만든다
const EM = String.fromCharCode(0x2014);
const ids = (vs: { rule: string }[]) => vs.map((v) => v.rule);

test("어미 판별", () => {
  assert.equal(classify("배포를 마쳤습니다.")?.level, "formal");
  assert.equal(classify("내일 다시 봬요")?.level, "formal");
  assert.equal(classify("결제 화면은 다음 주에 붙인다.")?.level, "plain");
  assert.equal(classify("그거 했어?")?.level, "plain");
  assert.equal(classify("경로 정리함")?.level, "nominal");
  assert.equal(classify("세금 포함"), null);
  assert.equal(classify("확인 필요"), null);
  assert.equal(classify("사이트맵 반영 완료"), null);
  assert.equal(classify("배포했습니다 (10월 8일).")?.level, "formal");
});

test("존댓말 글에 섞인 반말·명사형 종결을 짚는다", () => {
  const t = "이번 주 배포를 마쳤습니다. 서버 주소를 옮겼습니다.\n오류는 내일 고친다.\n\n- 메일 경로 정리함\n- 고객 문의에 답했습니다";
  const vs = checkRules(t).filter((v) => v.rule === "speech-level");
  assert.deepEqual(vs.map((v) => v.line), [2, 4]);
  assert.match(vs[0].message, /반말 어미/);
  assert.match(vs[1].message, /명사형 종결/);
});

test("한 가지 높임만 쓴 글은 통과한다", () => {
  assert.deepEqual(checkRules("오늘 배포했습니다. 내일 확인하겠습니다.").filter((v) => v.rule === "speech-level"), []);
  assert.deepEqual(checkRules("오늘 배포했다. 내일 확인한다.").filter((v) => v.rule === "speech-level"), []);
});

test("prefer: formal 이면 해라체 한 문장도 짚는다", () => {
  const vs = checkRules("오늘 배포했다.", { prefer: "formal" });
  assert.ok(ids(vs).includes("speech-level"));
});

test("엠대시를 오류로 짚는다", () => {
  const vs = checkRules(`회의를 마쳤습니다 ${EM} 다음 주에 봅니다.`);
  const v = vs.find((x) => x.rule === "em-dash");
  assert.ok(v);
  assert.equal(v.severity, "error");
  assert.equal(v.match, EM);
});

test("섹션 기호를 짚는다", () => {
  assert.ok(ids(checkRules(`약관 ${String.fromCharCode(0xa7)}3을 봐 주세요.`)).includes("section-sign"));
});

test("20어절 넘는 문장을 짚고, 기준을 바꿀 수 있다", () => {
  const long = Array.from({ length: 22 }, (_, i) => `낱말${i}`).join(" ") + "입니다.";
  assert.ok(ids(checkRules(long)).includes("long-sentence"));
  assert.ok(!ids(checkRules(long, { maxEojeol: 30 })).includes("long-sentence"));
  assert.ok(!ids(checkRules("짧은 문장입니다.")).includes("long-sentence"));
});

test("external-message 묶음은 마크다운 기호를 짚고, 기본 묶음은 짚지 않는다", () => {
  const t = "# 안내\n\n**중요**: 내일 오전에 배포합니다.\n자세한 내용은 [여기](https://example.com)를 봐 주세요.\n> 인용\n| 표 | 칸 |\n`코드`";
  assert.ok(!ids(checkRules(t)).includes("markdown-symbols"));
  const labels = checkRules(t, { packs: ["external-message"] }).filter((v) => v.rule === "markdown-symbols").map((v) => v.message);
  for (const l of ["#", "**", "[]()", ">", "|", "`"]) assert.ok(labels.some((m) => m.includes(l)), `${l} 누락`);
});

test("bullets 묶음은 두 문장 넘는 줄글 문단을 짚는다", () => {
  const t = "첫 문장입니다. 둘째 문장입니다.\n\n- 목록은 괜찮습니다";
  const vs = checkRules(t, { packs: ["bullets"] });
  assert.deepEqual(vs.filter((v) => v.rule === "prose-paragraph").map((v) => v.line), [1]);
});

test("AI 상투어·번역투 예시를 참고 단계로 짚는다", () => {
  const vs = checkRules("이 기능은 사용자 경험에 있어서 핵심적인 역할을 한다고 할 수 있습니다.");
  assert.ok(ids(vs).includes("ai-cliche"));
  assert.ok(ids(vs).includes("translationese"));
  assert.ok(vs.filter((v) => v.rule === "ai-cliche").every((v) => v.severity === "info"));
});

test("코드 블록 안은 검사하지 않는다", () => {
  const t = "설정은 아래와 같습니다.\n\n```\n이건 반말이다\n```\n";
  assert.deepEqual(checkRules(t).filter((v) => v.rule === "speech-level"), []);
});

test("사용자 YAML 규칙: 금지어, 바꿀 말, 정규식, 어미 조건", () => {
  const specs = parseRuleYaml(`
rules:
  - id: no-gogaek
    description: 고객님 대신 손님
    banned: [고객님]
  - id: brand
    severity: error
    replace: { 디파인404: Define404 }
  - id: bang
    regex: "!{2,}"
  - id: no-ham
    ending: { forbid: [함] }
  - id: formal-only
    ending: { level: formal }
`);
  const rules = specs.map(compileSpec);
  const t = "고객님 감사합니다!! 디파인404가 만들었습니다.\n- 정리함\n- 내일 한다";
  const vs = checkRules(t, { disable: ["speech-level"] }, rules);
  const got = ids(vs);
  for (const id of ["no-gogaek", "brand", "bang", "no-ham", "formal-only"]) assert.ok(got.includes(id), `${id} 누락`);
  assert.equal(vs.find((v) => v.rule === "brand")?.severity, "error");
  assert.match(vs.find((v) => v.rule === "brand")?.suggestion ?? "", /Define404/);
  assert.equal(vs.filter((v) => v.rule === "formal-only").length, 2);
});

test("잘못된 사용자 규칙은 이유와 함께 거절한다", () => {
  assert.throws(() => parseRuleYaml("rules:\n  - id: Bad Id\n    banned: [x]"), /id는/);
  assert.throws(() => parseRuleYaml("rules:\n  - id: two\n    banned: [x]\n    regex: y"), /하나만/);
  assert.throws(() => parseRuleYaml("rules:\n  - id: bad-re\n    regex: '('"), /./);
  assert.throws(() => parseRuleYaml("foo: 1"), /rules/);
});

test("가이드 문서를 제목 붙은 조각으로 자른다", () => {
  const chunks = chunkGuide("# 가이드\n\n## 호칭\n\n\"고객님\"은 쓰지 않는다.\n\n## 가격\n\n부가세 포함으로 적는다.");
  assert.equal(chunks.length, 2);
  assert.match(chunks[0].text, /^\[호칭\]/);
});

test("문서 층: 로컬 임베딩 + 시험용 판정기로 근거 조각과 함께 짚는다", async () => {
  process.env.MUNCHE_MEO_EMBED = "local";
  process.env.MUNCHE_MEO_LLM = "mock";
  const { Service } = await import("../src/node/service.ts");
  const svc = new Service(":memory:");
  const guide = "# 가이드\n\n## 호칭\n\n손님을 부를 때 \"고객님\"이라는 말은 쓰지 않는다.\n\n## 가격\n\n\"저렴한\"이라는 말은 피한다.";
  const r = await svc.addGuide("guide.md", guide);
  assert.equal(r.chunks, 2);
  const hits = await svc.searchGuide("고객님 호칭", 1);
  assert.match(hits[0].text, /호칭/);
  const out = await svc.check("고객님, 예약을 확인했습니다.\n\n가격은 아주 저렴한 편입니다.", {}, [], true);
  const g = out.violations.filter((v) => v.source === "guide");
  assert.equal(g.length, 2);
  assert.ok(g.every((v) => v.cite && v.cite.doc === "guide.md"));
  assert.match(out.guide, /켜짐/);
  const off = await svc.check("고객님, 예약을 확인했습니다.", {}, [], false);
  assert.equal(off.violations.filter((v) => v.source === "guide").length, 0);
});

test("MCP: initialize, tools/list, tools/call", async () => {
  process.env.MUNCHE_MEO_LLM = "none";
  const { Service, mcpTools } = await import("../src/node/service.ts");
  const tools = mcpTools(new Service(":memory:"));
  const init = (await handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, tools, "munche-meo", "0.1.0")) as any;
  assert.equal(init.result.protocolVersion, "2025-06-18");
  assert.equal(await handleRpc({ jsonrpc: "2.0", method: "notifications/initialized" }, tools, "x", "0"), null);
  const list = (await handleRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, tools, "x", "0")) as any;
  assert.deepEqual(list.result.tools.map((t: any) => t.name), ["check_text", "add_rule", "list_rules", "add_guide_document", "search_guide"]);
  const call = (await handleRpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "check_text", arguments: { text: `좋습니다 ${EM} 내일 한다.` } } }, tools, "x", "0")) as any;
  const body = JSON.parse(call.result.content[0].text);
  assert.ok(body.violations.some((v: any) => v.rule === "em-dash"));
  const bad = (await handleRpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "add_rule", arguments: { id: "X" } } }, tools, "x", "0")) as any;
  assert.equal(bad.result.isError, true);
});

test("광고 수신 동의: 2년이 지나면 끝나고, 처리 결과 안내에 보낸 곳·연락처·철회 링크가 있다", () => {
  const at = "2026-10-09T01:00:00.000Z";
  assert.equal(marketingExpiresAt(at).slice(0, 10), "2028-10-08");
  const row = { consent_marketing: 1, consent_marketing_at: at };
  assert.equal(marketingActive(row, new Date("2028-10-07T00:00:00Z")), true);
  assert.equal(marketingActive(row, new Date("2028-10-09T00:00:00Z")), false);
  assert.equal(marketingActive({ consent_marketing: 0, consent_marketing_at: null }), false);

  const n = consentNotice({ action: "consent", at, contactUrl: "https://contact.define404.com", unsubscribeUrl: "https://x.test/api/unsubscribe?t=abc" });
  assert.doesNotMatch(n.subject, /광고\)/);
  assert.match(n.text, /보낸 곳: Define404/);
  assert.match(n.text, /연락처: https:\/\/contact\.define404\.com/);
  assert.match(n.text, /수신 거부.*unsubscribe\?t=abc/);
  assert.match(n.text, /2028-10-08까지/);
  const w = consentNotice({ action: "withdraw", at, contactUrl: "https://contact.define404.com" });
  assert.match(w.text, /철회/);
  assert.doesNotMatch(w.text, /unsubscribe/);
  for (const t of [n.subject, n.text, w.text]) assert.equal(t.includes(EM), false);
});
