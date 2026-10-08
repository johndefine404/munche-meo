// [Define404] munche-meo: 규칙 층 진입점. 결과는 매번 같고 외부 호출이 없다
import { BUILTIN_RULES } from "./rules.ts";
import { parse } from "./split.ts";
import type { CheckOptions, Rule, Violation } from "./types.ts";

const ORDER = { error: 0, warn: 1, info: 2 } as const;

export function resolveOptions(o: CheckOptions = {}): Required<CheckOptions> {
  return {
    packs: o.packs?.length ? o.packs : ["default"],
    disable: o.disable ?? [],
    maxEojeol: o.maxEojeol ?? 20,
    prefer: o.prefer ?? "auto",
  };
}

export function activeRules(opts: Required<CheckOptions>, userRules: Rule[] = []): Rule[] {
  const all = opts.packs.includes("all");
  const builtins = BUILTIN_RULES.filter((r) => all || opts.packs.includes(r.pack));
  return [...builtins, ...userRules].filter((r) => !opts.disable.includes(r.id));
}

export function checkRules(text: string, options: CheckOptions = {}, userRules: Rule[] = []): Violation[] {
  const opts = resolveOptions(options);
  const doc = parse(text);
  const out: Violation[] = [];
  for (const rule of activeRules(opts, userRules)) {
    for (const h of rule.check(doc, opts)) {
      out.push({ ...h, rule: rule.id, severity: h.severity ?? rule.severity, source: "rule" });
    }
  }
  return out.sort((a, b) => a.line - b.line || ORDER[a.severity] - ORDER[b.severity]);
}

export function failing(vs: Violation[], failOn: "error" | "warn" | "info" = "warn"): Violation[] {
  return vs.filter((v) => ORDER[v.severity] <= ORDER[failOn]);
}

// 사람이 읽는 한 줄 형식: 파일:줄 [단계] 규칙: 메시지
export function formatViolation(v: Violation, file?: string): string {
  const where = file ? `${file}:${v.line}` : `${v.line}행`;
  const label = { error: "오류", warn: "경고", info: "참고" }[v.severity];
  let s = `${where} [${label}] ${v.rule}: ${v.message}`;
  if (v.suggestion) s += ` → ${v.suggestion}`;
  s += `\n    ${v.text.length > 120 ? v.text.slice(0, 120) + "..." : v.text}`;
  if (v.cite) s += `\n    근거(${v.cite.doc} #${v.cite.chunk}): ${v.cite.text.slice(0, 120)}`;
  return s;
}
