// [Define404] munche-meo: 사용자 규칙 파일(YAML)을 읽어 규칙으로 만든다
//
// rules:
//   - id: no-gogaek
//     description: 고객님 대신 손님이라고 쓴다
//     severity: warn            # error | warn | info (기본 warn)
//     banned: [고객님]           # 금지어
//   - id: brand
//     replace: { 여우비: Yeowubie }   # 바꿀 말 제안
//   - id: no-double-bang
//     regex: "!{2,}"             # 정규식
//   - id: formal-only
//     ending: { level: formal }  # 어미 조건: level(formal|plain) / forbid: [~함] / require: [니다, 요]
import { parse as parseYaml } from "yaml";
import { classify, lastWord } from "./ending.ts";
import { maskInlineCode } from "./split.ts";
import type { Hit, Rule, Severity } from "./types.ts";

export interface RuleSpec {
  id: string;
  description?: string;
  severity?: Severity;
  banned?: string[];
  replace?: Record<string, string>;
  regex?: string;
  flags?: string;
  ending?: { level?: "formal" | "plain"; forbid?: string[]; require?: string[] };
}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SEVERITIES = ["error", "warn", "info"];

export function validateSpec(raw: unknown): RuleSpec {
  if (!raw || typeof raw !== "object") throw new Error("규칙은 객체여야 합니다");
  const r = raw as Record<string, unknown>;
  const id = String(r.id ?? "");
  if (!ID_RE.test(id)) throw new Error(`id는 영문 소문자·숫자·하이픈 64자 이내여야 합니다: "${id}"`);
  const kinds = ["banned", "replace", "regex", "ending"].filter((k) => r[k] !== undefined);
  if (kinds.length !== 1) throw new Error(`${id}: banned, replace, regex, ending 중 하나만 적어야 합니다`);
  const spec: RuleSpec = { id, description: r.description ? String(r.description) : undefined };
  if (r.severity !== undefined) {
    if (!SEVERITIES.includes(String(r.severity))) throw new Error(`${id}: severity는 error, warn, info 중 하나입니다`);
    spec.severity = r.severity as Severity;
  }
  if (r.banned !== undefined) {
    if (!Array.isArray(r.banned) || !r.banned.length) throw new Error(`${id}: banned는 낱말 목록입니다`);
    spec.banned = r.banned.map(String).filter(Boolean);
  }
  if (r.replace !== undefined) {
    if (typeof r.replace !== "object" || Array.isArray(r.replace)) throw new Error(`${id}: replace는 {바꿀 말: 바른 말} 형식입니다`);
    spec.replace = Object.fromEntries(Object.entries(r.replace as object).map(([k, v]) => [k, String(v)]));
  }
  if (r.regex !== undefined) {
    const src = String(r.regex);
    if (src.length > 300) throw new Error(`${id}: 정규식은 300자 이내로 적어 주세요`);
    const flags = String(r.flags ?? "").replace(/[^imsu]/g, "");
    new RegExp(src, flags); // 문법 오류면 여기서 던진다
    spec.regex = src;
    spec.flags = flags;
  }
  if (r.ending !== undefined) {
    const e = r.ending as Record<string, unknown>;
    if (!e || typeof e !== "object") throw new Error(`${id}: ending은 {level|forbid|require} 형식입니다`);
    spec.ending = {};
    if (e.level !== undefined) {
      if (e.level !== "formal" && e.level !== "plain") throw new Error(`${id}: ending.level은 formal 또는 plain입니다`);
      spec.ending.level = e.level;
    }
    if (e.forbid !== undefined) spec.ending.forbid = (e.forbid as unknown[]).map(String);
    if (e.require !== undefined) spec.ending.require = (e.require as unknown[]).map(String);
    if (!spec.ending.level && !spec.ending.forbid && !spec.ending.require) throw new Error(`${id}: ending에 조건이 없습니다`);
  }
  return spec;
}

export function parseRuleYaml(text: string): RuleSpec[] {
  const data = parseYaml(text) as unknown;
  const list = Array.isArray(data) ? data : (data as { rules?: unknown[] })?.rules;
  if (!Array.isArray(list)) throw new Error("YAML 맨 위에 rules: 목록이 있어야 합니다");
  return list.map(validateSpec);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function compileSpec(spec: RuleSpec): Rule {
  const severity = spec.severity ?? "warn";
  const base = { id: spec.id, pack: "user", description: spec.description ?? spec.id, severity };

  if (spec.banned || spec.replace || spec.regex) {
    const pairs: { rx: RegExp; fix?: string; label: string }[] = [];
    for (const w of spec.banned ?? []) pairs.push({ rx: new RegExp(escapeRe(w), "g"), label: `금지어 "${w}"` });
    for (const [from, to] of Object.entries(spec.replace ?? {})) pairs.push({ rx: new RegExp(escapeRe(from), "g"), fix: `"${to}"(으)로 바꾸세요`, label: `"${from}"` });
    if (spec.regex) pairs.push({ rx: new RegExp(spec.regex, (spec.flags ?? "").replace("g", "") + "g"), label: "패턴" });
    return {
      ...base,
      check(doc) {
        const hits: Hit[] = [];
        for (const s of doc.sentences) {
          const body = maskInlineCode(s.text);
          for (const p of pairs) {
            for (const m of body.matchAll(p.rx)) {
              if (!m[0]) break;
              hits.push({ line: s.line, text: s.text, match: m[0], message: `${spec.description ?? spec.id}: ${p.label}`, suggestion: p.fix });
            }
          }
        }
        return hits;
      },
    };
  }

  const e = spec.ending!;
  return {
    ...base,
    check(doc) {
      const hits: Hit[] = [];
      for (const s of doc.sentences) {
        if (s.kind === "heading") continue;
        const body = maskInlineCode(s.text);
        const lw = lastWord(body);
        if (!lw) continue;
        const cls = classify(body);
        const msg = spec.description ?? spec.id;
        if (e.level && cls) {
          const ok = e.level === "formal" ? cls.level === "formal" : cls.level !== "formal";
          if (!ok) hits.push({ line: s.line, text: s.text, match: cls.tail, message: `${msg}: 어미 ~${cls.tail}` });
        }
        const bad = e.forbid?.find((t) => lw.word.endsWith(t.replace(/^~/, "")));
        if (bad) hits.push({ line: s.line, text: s.text, match: bad, message: `${msg}: 금지 어미 ${bad}` });
        if (e.require && cls && !e.require.some((t) => lw.word.endsWith(t.replace(/^~/, "")))) {
          hits.push({ line: s.line, text: s.text, match: cls.tail, message: `${msg}: 허용 어미(${e.require.join(", ")})가 아닙니다` });
        }
      }
      return hits;
    },
  };
}
