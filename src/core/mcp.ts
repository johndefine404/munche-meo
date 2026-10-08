// [Define404] munche-meo: MCP JSON-RPC 처리 (stdio 서버와 웹 /mcp 가 같이 쓴다)

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run(args: Record<string, unknown>): Promise<unknown>;
}

type RpcMsg = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

const VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

export async function handleRpc(msg: RpcMsg, tools: Tool[], name: string, version: string): Promise<object | null> {
  const id = msg.id ?? null;
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id, result });
  const fail = (code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
  if (!msg.method) return fail(-32600, "invalid request");
  const isNotification = msg.id === undefined;

  switch (msg.method) {
    case "initialize": {
      const asked = String(msg.params?.protocolVersion ?? "");
      return ok({
        protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name, version },
        instructions: "한국어 글을 문장 단위로 검사합니다. 고쳐 쓰지 않고 위반만 짚습니다. check_text 결과의 위반을 글쓴이에게 보여 주세요.",
      });
    }
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case "tools/call": {
      const tool = tools.find((t) => t.name === msg.params?.name);
      if (!tool) return fail(-32602, `unknown tool: ${String(msg.params?.name)}`);
      try {
        const result = await tool.run((msg.params?.arguments as Record<string, unknown>) ?? {});
        const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
        return ok({ content: [{ type: "text", text }], isError: false });
      } catch (e) {
        return ok({ content: [{ type: "text", text: `오류: ${(e as Error).message}` }], isError: true });
      }
    }
    default:
      if (isNotification) return null; // notifications/initialized 등
      return fail(-32601, `method not found: ${msg.method}`);
  }
}

export const CHECK_TEXT_SCHEMA = {
  type: "object",
  properties: {
    text: { type: "string", description: "검사할 한국어 글" },
    packs: {
      type: "array",
      items: { type: "string", enum: ["default", "external-message", "bullets", "all"] },
      description: "켤 규칙 묶음. 기본 default. 고객에게 보낼 글이면 external-message, 보고용이면 bullets 추가",
    },
    max_eojeol: { type: "number", description: "긴 문장 기준 어절 수 (기본 20)" },
    prefer: { type: "string", enum: ["auto", "formal", "plain"], description: "존댓말 기준. auto는 다수 쪽" },
  },
  required: ["text"],
};
