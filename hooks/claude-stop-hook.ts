#!/usr/bin/env node
// [Define404] munche-meo Claude Code Stop 훅: 답변이 끝날 때 마지막 답변을 규칙 층으로 검사한다
//
// 위반이 있으면 Claude에게 위반 목록을 돌려주고 한 번 더 고쳐 쓰게 한다 (MUNCHE_MEO_HOOK_MODE=block, 기본)
// MUNCHE_MEO_HOOK_MODE=warn 이면 막지 않고 화면에 알림만 띄운다.
// AI 호출은 하지 않는다 (규칙 층만, 0원).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkRules, failing } from "../src/core/check.ts";
import { compileSpec } from "../src/core/user-rules.ts";
import { loadConfig } from "../src/node/service.ts";

interface HookInput {
  transcript_path?: string;
  stop_hook_active?: boolean;
  last_assistant_message?: string;
  cwd?: string;
}

// 대화 기록(JSONL)에서 마지막 사용자 입력 뒤에 나온 답변 글만 모은다
export function lastAssistantText(jsonl: string): string {
  const lines = jsonl.split("\n").filter(Boolean);
  const parts: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    let e: { type?: string; message?: { content?: unknown } };
    try {
      e = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (e.type === "user") break;
    if (e.type !== "assistant") continue;
    const c = e.message?.content;
    if (typeof c === "string") parts.unshift(c);
    else if (Array.isArray(c)) {
      const t = c.filter((b: { type?: string }) => b.type === "text").map((b: { text?: string }) => b.text ?? "").join("\n");
      if (t) parts.unshift(t);
    }
  }
  return parts.join("\n\n");
}

async function main() {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  const input = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as HookInput;
  if (input.stop_hook_active) return; // 이미 한 번 돌려보냈으면 다시 막지 않는다

  const text = input.last_assistant_message ?? (input.transcript_path && existsSync(input.transcript_path) ? lastAssistantText(readFileSync(input.transcript_path, "utf8")) : "");
  if (!text.trim()) return;

  const cfgPath = join(input.cwd || process.cwd(), ".munche-meo.yaml");
  const cfg = existsSync(cfgPath) ? loadConfig(cfgPath) : { rules: [] };
  const packs = (process.env.MUNCHE_MEO_HOOK_PACKS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const vs = checkRules(text, { ...cfg, packs: [...new Set(["default", ...(cfg.packs ?? []), ...packs])] }, cfg.rules.map(compileSpec));
  const bad = failing(vs, (process.env.MUNCHE_MEO_HOOK_FAIL_ON as "error" | "warn" | "info") || "warn");
  if (!bad.length) return;

  const list = bad
    .slice(0, 15)
    .map((v) => `- ${v.rule}: ${v.message}${v.suggestion ? ` (${v.suggestion})` : ""}\n  "${v.text.slice(0, 100)}"`)
    .join("\n");
  const reason = `munche-meo가 마지막 답변에서 위반 ${bad.length}건을 찾았습니다. 내용은 그대로 두고 아래만 고쳐 답변을 다시 써 주세요.\n${list}`;
  if (process.env.MUNCHE_MEO_HOOK_MODE === "warn") {
    process.stdout.write(JSON.stringify({ systemMessage: reason }));
  } else {
    process.stdout.write(JSON.stringify({ decision: "block", reason }));
  }
}

main().catch((e) => {
  console.error(`munche-meo 훅 오류: ${(e as Error).message}`);
  process.exit(0); // 훅 오류로 대화를 막지 않는다
});
