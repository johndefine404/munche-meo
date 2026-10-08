#!/usr/bin/env node
// [Define404] munche-meo MCP 서버 (stdio). Claude 데스크톱, Claude Code, Cursor 등에서 씁니다
// 표준 출력에는 JSON-RPC 메시지만 내보내고, 기록은 표준 오류로 보낸다.
import { createInterface } from "node:readline";
import { handleRpc } from "../core/mcp.ts";
import { mcpTools, Service, VERSION } from "./service.ts";

const svc = new Service(process.env.MUNCHE_MEO_DB);
const tools = mcpTools(svc);
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

let pending = Promise.resolve();
rl.on("line", (line) => {
  if (!line.trim()) return;
  // 요청 순서대로 응답한다
  pending = pending.then(async () => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }) + "\n");
      return;
    }
    const res = await handleRpc(msg, tools, "munche-meo", VERSION);
    if (res) process.stdout.write(JSON.stringify(res) + "\n");
  });
});
rl.on("close", () => {
  pending.then(() => process.exit(0));
});
console.error(`munche-meo MCP ${VERSION} 준비됨`);
