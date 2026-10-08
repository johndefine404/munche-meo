// [Define404] munche-meo: 명령줄과 MCP 서버가 같이 쓰는 검사 서비스
import { existsSync, readFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { activeRules, checkRules, resolveOptions } from "../core/check.ts";
import { checkWithGuide, chunkGuide } from "../core/guide.ts";
import { CHECK_TEXT_SCHEMA, type Tool } from "../core/mcp.ts";
import { PACKS } from "../core/rules.ts";
import type { CheckOptions, Violation } from "../core/types.ts";
import { compileSpec, parseRuleYaml, validateSpec, type RuleSpec } from "../core/user-rules.ts";
import { getCompleter, getEmbedder } from "./providers.ts";
import { defaultDbPath, Store } from "./store.ts";

export const VERSION = "0.1.0";

export interface Config extends CheckOptions {
  rules: RuleSpec[];
}

// 프로젝트 설정 파일 .munche-meo.yaml (packs, disable, max_eojeol, prefer, rules)
export function loadConfig(path?: string): Config {
  const p = resolve(path || ".munche-meo.yaml");
  if (!existsSync(p)) {
    if (path) throw new Error(`설정 파일이 없습니다: ${p}`);
    return { rules: [] };
  }
  const raw = (parseYaml(readFileSync(p, "utf8")) ?? {}) as Record<string, unknown>;
  return {
    packs: raw.packs as string[] | undefined,
    disable: raw.disable as string[] | undefined,
    maxEojeol: raw.max_eojeol as number | undefined,
    prefer: raw.prefer as CheckOptions["prefer"],
    rules: Array.isArray(raw.rules) ? raw.rules.map(validateSpec) : [],
  };
}

export function loadRuleFiles(paths: string[]): RuleSpec[] {
  return paths.flatMap((p) => parseRuleYaml(readFileSync(p, "utf8")));
}

export class Service {
  private _store?: Store;
  private dbPath: string;
  constructor(dbPath?: string) {
    this.dbPath = dbPath || defaultDbPath();
  }

  get store(): Store {
    if (!this._store) this._store = new Store(this.dbPath);
    return this._store;
  }

  // 검사만 할 때는 저장소 파일을 새로 만들지 않는다 (CI에서 홈 폴더를 건드리지 않게)
  private existing(): Store | null {
    if (this._store) return this._store;
    if (this.dbPath !== ":memory:" && existsSync(this.dbPath)) return this.store;
    return null;
  }

  // 규칙 층 + (AI가 연결돼 있고 가이드 문서가 있으면) 문서 층
  async check(text: string, options: CheckOptions, extraRules: RuleSpec[] = [], useGuide = true): Promise<{ violations: Violation[]; guide: string }> {
    const db = this.existing();
    const specs = [...extraRules, ...(db?.rules() ?? [])];
    const violations = checkRules(text, options, specs.map(compileSpec));
    let guide = "꺼짐 (--no-llm)";
    if (useGuide) {
      const llm = getCompleter();
      const docs = db?.docs() ?? [];
      if (!llm) guide = "꺼짐 (판정 AI 키 없음)";
      else if (!docs.length) guide = "꺼짐 (등록한 가이드 문서 없음)";
      else {
        const emb = getEmbedder();
        const retrieve = async (q: string, k: number) => db!.search((await emb.embed([q]))[0], emb.model, k);
        violations.push(...(await checkWithGuide(text, retrieve, llm.complete)));
        guide = `켜짐 (${llm.name}, ${emb.model}, 문서 ${docs.length}개)`;
      }
    }
    violations.sort((a, b) => a.line - b.line);
    return { violations, guide };
  }

  async addGuide(name: string, text: string): Promise<{ name: string; chunks: number; model: string }> {
    const chunks = chunkGuide(text);
    if (!chunks.length) throw new Error("문서가 비어 있습니다");
    const emb = getEmbedder();
    const vecs: Float32Array[] = [];
    for (let i = 0; i < chunks.length; i += 64) vecs.push(...(await emb.embed(chunks.slice(i, i + 64).map((c) => c.text))));
    this.store.saveDoc(name, emb.model, chunks.map((c, i) => ({ ...c, embedding: vecs[i] })));
    return { name, chunks: chunks.length, model: emb.model };
  }

  async searchGuide(query: string, k = 4) {
    const emb = getEmbedder();
    return this.store.search((await emb.embed([query]))[0], emb.model, k);
  }

  listRules(extra: RuleSpec[] = []) {
    const opts = resolveOptions({ packs: ["all"] });
    const builtins = activeRules(opts).map((r) => ({ id: r.id, pack: r.pack, severity: r.severity, description: r.description }));
    const mine = [...extra, ...(this.existing()?.rules() ?? [])].map((s) => ({ id: s.id, pack: "user", severity: s.severity ?? "warn", description: s.description ?? "", spec: s }));
    return { packs: PACKS, rules: [...builtins, ...mine] };
  }
}

export function readGuideFile(path: string): { name: string; text: string } {
  const ext = extname(path).toLowerCase();
  if (![".md", ".markdown", ".txt"].includes(ext)) throw new Error("가이드 문서는 .md, .txt만 받습니다 (PDF는 텍스트로 바꿔서 넣어 주세요)");
  return { name: basename(path), text: readFileSync(path, "utf8") };
}

export function mcpTools(svc: Service): Tool[] {
  return [
    {
      name: "check_text",
      description: "한국어 글을 문장 단위로 검사해 규칙 위반을 돌려줍니다. 고쳐 쓰지 않습니다. 기본 규칙: 엠대시, 섹션 기호, 존댓말·반말 섞임, 20어절 넘는 문장, AI 상투어, 번역투. 등록한 내 규칙과 가이드 문서도 같이 봅니다.",
      inputSchema: {
        ...CHECK_TEXT_SCHEMA,
        properties: { ...CHECK_TEXT_SCHEMA.properties, use_guide: { type: "boolean", description: "가이드 문서 판정(AI 호출)을 할지. 기본 true" } },
      },
      async run(a) {
        const r = await svc.check(
          String(a.text ?? ""),
          { packs: a.packs as string[] | undefined, maxEojeol: a.max_eojeol as number | undefined, prefer: a.prefer as CheckOptions["prefer"] },
          [],
          a.use_guide !== false,
        );
        return { count: r.violations.length, guide_layer: r.guide, violations: r.violations };
      },
    },
    {
      name: "add_rule",
      description: "내 규칙을 하나 추가하거나 같은 id를 바꿉니다. banned(금지어 목록), replace({바꿀 말: 바른 말}), regex(정규식), ending({level|forbid|require}) 중 하나를 적습니다.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "영문 소문자·숫자·하이픈" },
          description: { type: "string" },
          severity: { type: "string", enum: ["error", "warn", "info"] },
          banned: { type: "array", items: { type: "string" } },
          replace: { type: "object", additionalProperties: { type: "string" } },
          regex: { type: "string" },
          flags: { type: "string" },
          ending: {
            type: "object",
            properties: { level: { type: "string", enum: ["formal", "plain"] }, forbid: { type: "array", items: { type: "string" } }, require: { type: "array", items: { type: "string" } } },
          },
        },
        required: ["id"],
      },
      async run(a) {
        const spec = validateSpec(a);
        compileSpec(spec);
        svc.store.saveRule(spec);
        return { saved: spec };
      },
    },
    {
      name: "list_rules",
      description: "기본 규칙 묶음과 내가 추가한 규칙 목록을 보여 줍니다.",
      inputSchema: { type: "object", properties: {} },
      async run() {
        return svc.listRules();
      },
    },
    {
      name: "add_guide_document",
      description: "문체 가이드, 브랜드 보이스, 용어집 문서(.md, .txt)를 등록합니다. 조각으로 나눠 색인하고, 검사할 때 관련 조각을 근거로 AI가 판정합니다. path 또는 name+text 중 하나를 줍니다.",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string", description: "문서 파일 절대경로" }, name: { type: "string" }, text: { type: "string" } },
      },
      async run(a) {
        const doc = a.path ? readGuideFile(String(a.path)) : { name: String(a.name ?? ""), text: String(a.text ?? "") };
        if (!doc.name || !doc.text) throw new Error("path 또는 name과 text를 주세요");
        return svc.addGuide(doc.name, doc.text);
      },
    },
    {
      name: "search_guide",
      description: "등록한 가이드 문서에서 질문과 가까운 조각을 찾습니다.",
      inputSchema: { type: "object", properties: { query: { type: "string" }, k: { type: "number" } }, required: ["query"] },
      async run(a) {
        return svc.searchGuide(String(a.query ?? ""), Number(a.k ?? 4));
      },
    },
  ];
}
