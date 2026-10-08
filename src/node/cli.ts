#!/usr/bin/env node
// [Define404] munche-meo 명령줄: 파일·폴더를 검사하고 위반이 있으면 0이 아닌 값으로 끝난다
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";
import { failing, formatViolation } from "../core/check.ts";
import type { Violation } from "../core/types.ts";
import { compileSpec, parseRuleYaml } from "../core/user-rules.ts";
import { loadConfig, loadRuleFiles, readGuideFile, Service, VERSION } from "./service.ts";

const HELP = `munche-meo (문체냥) ${VERSION}: 한국어 문체 검사기 [Define404]

사용법
  munche-meo check [파일|폴더 ...]     파일·폴더 검사 (없으면 표준 입력)
  munche-meo rules                     규칙 목록
  munche-meo rule add <규칙.yaml>      내 규칙 저장
  munche-meo guide add <문서.md ...>   가이드 문서 등록
  munche-meo guide search <질문>       가이드 조각 찾기

check 옵션
  --pack <이름>        규칙 묶음 추가: external-message, bullets, all (여러 번 가능)
  --rules <파일>       사용자 규칙 YAML (여러 번 가능)
  --config <파일>      설정 파일 (기본 ./.munche-meo.yaml)
  --disable <규칙 id>  규칙 끄기 (여러 번 가능)
  --max-eojeol <수>    긴 문장 기준 (기본 20)
  --prefer <기준>      auto | formal | plain
  --no-llm             문서 층(AI 판정)을 끄고 규칙만 검사
  --fail-on <단계>     error | warn | info 이상이면 실패 (기본 warn)
  --json               JSON으로 출력
  --db <경로>          저장소 파일 (기본 ~/.munche-meo/munche.db)

종료 코드: 0 통과, 1 위반 있음, 2 사용법 오류`;

const TEXT_EXT = /\.(md|markdown|txt)$/i;

function collect(paths: string[]): string[] {
  const out: string[] = [];
  const walk = (p: string) => {
    const st = statSync(p);
    if (st.isDirectory()) {
      for (const name of readdirSync(p)) {
        if (name === "node_modules" || name.startsWith(".")) continue;
        walk(join(p, name));
      }
    } else if (TEXT_EXT.test(p) || paths.includes(p)) out.push(p);
  };
  paths.forEach(walk);
  return out;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      pack: { type: "string", multiple: true },
      rules: { type: "string", multiple: true },
      config: { type: "string" },
      disable: { type: "string", multiple: true },
      "max-eojeol": { type: "string" },
      prefer: { type: "string" },
      "no-llm": { type: "boolean" },
      "fail-on": { type: "string" },
      json: { type: "boolean" },
      db: { type: "string" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
  if (values.version) return console.log(VERSION), 0;
  const [cmd, ...rest] = positionals;
  if (values.help || !cmd) return console.log(HELP), cmd ? 0 : 2;
  const svc = new Service(values.db);

  if (cmd === "check") {
    const cfg = loadConfig(values.config);
    const extra = [...cfg.rules, ...loadRuleFiles(values.rules ?? [])];
    const opts = {
      packs: [...new Set(["default", ...(cfg.packs ?? []), ...(values.pack ?? [])])],
      disable: [...(cfg.disable ?? []), ...(values.disable ?? [])],
      maxEojeol: values["max-eojeol"] ? Number(values["max-eojeol"]) : cfg.maxEojeol,
      prefer: (values.prefer ?? cfg.prefer) as "auto" | "formal" | "plain" | undefined,
    };
    const failOn = (values["fail-on"] ?? "warn") as "error" | "warn" | "info";
    const inputs: { name: string; text: string }[] = rest.length
      ? collect(rest).map((p) => ({ name: relative(process.cwd(), p) || p, text: readFileSync(p, "utf8") }))
      : [{ name: "<stdin>", text: await readStdin() }];

    const results: { file: string; violations: Violation[] }[] = [];
    let guideNote = "";
    for (const f of inputs) {
      const r = await svc.check(f.text, opts, extra, !values["no-llm"]);
      guideNote = r.guide;
      results.push({ file: f.name, violations: r.violations });
    }
    const all = results.flatMap((r) => r.violations);
    const bad = failing(all, failOn);
    if (values.json) {
      console.log(JSON.stringify({ files: results, total: all.length, failing: bad.length, guide_layer: guideNote }, null, 2));
    } else {
      for (const r of results) for (const v of r.violations) console.log(formatViolation(v, r.file));
      console.log(`\n파일 ${results.length}개, 위반 ${all.length}건 (실패 기준 ${failOn} 이상 ${bad.length}건). 문서 층: ${guideNote}`);
    }
    return bad.length ? 1 : 0;
  }

  if (cmd === "rules") {
    const list = svc.listRules(loadConfig(values.config).rules);
    if (values.json) console.log(JSON.stringify(list, null, 2));
    else for (const r of list.rules) console.log(`${r.id.padEnd(18)} ${r.pack.padEnd(17)} ${r.severity.padEnd(5)} ${r.description}`);
    return 0;
  }

  if (cmd === "rule" && rest[0] === "add" && rest[1]) {
    const specs = parseRuleYaml(readFileSync(rest[1], "utf8"));
    for (const s of specs) {
      compileSpec(s);
      svc.store.saveRule(s);
      console.log(`저장: ${s.id}`);
    }
    return 0;
  }

  if (cmd === "guide" && rest[0] === "add" && rest.length > 1) {
    for (const p of rest.slice(1)) {
      const d = readGuideFile(p);
      const r = await svc.addGuide(d.name, d.text);
      console.log(`등록: ${r.name} (조각 ${r.chunks}개, ${r.model})`);
    }
    return 0;
  }

  if (cmd === "guide" && rest[0] === "search" && rest[1]) {
    for (const h of await svc.searchGuide(rest.slice(1).join(" "), 4)) {
      console.log(`${h.score.toFixed(3)}  ${h.doc} #${h.chunk}\n    ${h.text.slice(0, 160).replace(/\n/g, " ")}`);
    }
    return 0;
  }

  console.error(HELP);
  return 2;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    console.error(`오류: ${(e as Error).message}`);
    process.exit(2);
  },
);
