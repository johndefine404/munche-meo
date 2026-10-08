// [Define404] munche-meo: 임베딩·판정 AI 연결 (환경 변수로 고른다)
//
// MUNCHE_MEO_EMBED = local | openai     (기본: OPENAI_API_KEY 있으면 openai, 없으면 local)
// MUNCHE_MEO_LLM   = anthropic | openai | mock | none
//                      (기본: ANTHROPIC_API_KEY 있으면 anthropic, OPENAI_API_KEY 있으면 openai, 없으면 none)
// OPENAI_BASE_URL 을 바꾸면 OpenAI 호환 서버(Ollama, LM Studio 등)를 쓸 수 있습니다.
import { localEmbed, mockComplete, normalize, type Complete } from "../core/guide.ts";

export interface Embedder {
  model: string;
  embed(texts: string[]): Promise<Float32Array[]>;
}

const env = (k: string) => process.env[k] || "";

export function getEmbedder(): Embedder {
  const kind = env("MUNCHE_MEO_EMBED") || (env("OPENAI_API_KEY") ? "openai" : "local");
  if (kind === "local") return { model: "local-hash-512", embed: async (t) => t.map(localEmbed) };
  if (kind !== "openai") throw new Error(`알 수 없는 MUNCHE_MEO_EMBED: ${kind}`);
  const model = env("MUNCHE_MEO_EMBED_MODEL") || "text-embedding-3-small";
  const base = env("OPENAI_BASE_URL") || "https://api.openai.com/v1";
  return {
    model: `openai:${model}`,
    async embed(texts) {
      const res = await fetch(`${base}/embeddings`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${env("OPENAI_API_KEY")}` },
        body: JSON.stringify({ model, input: texts }),
      });
      if (!res.ok) throw new Error(`임베딩 요청 실패 ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = (await res.json()) as { data: { embedding: number[] }[] };
      return data.data.map((d) => normalize(Float32Array.from(d.embedding)));
    },
  };
}

export function getCompleter(): { name: string; complete: Complete } | null {
  const kind = env("MUNCHE_MEO_LLM") || (env("ANTHROPIC_API_KEY") ? "anthropic" : env("OPENAI_API_KEY") ? "openai" : "none");
  if (kind === "none") return null;
  if (kind === "mock") return { name: "mock", complete: mockComplete };
  if (kind === "anthropic") {
    const model = env("MUNCHE_MEO_LLM_MODEL") || "claude-haiku-4-5";
    return {
      name: `anthropic:${model}`,
      async complete(system, user) {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": env("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model, max_tokens: 1024, system, messages: [{ role: "user", content: user }] }),
        });
        if (!res.ok) throw new Error(`판정 요청 실패 ${res.status}: ${(await res.text()).slice(0, 200)}`);
        const data = (await res.json()) as { content: { type: string; text?: string }[] };
        return data.content.map((c) => c.text ?? "").join("");
      },
    };
  }
  if (kind === "openai") {
    const model = env("MUNCHE_MEO_LLM_MODEL") || "gpt-4o-mini";
    const base = env("OPENAI_BASE_URL") || "https://api.openai.com/v1";
    return {
      name: `openai:${model}`,
      async complete(system, user) {
        const res = await fetch(`${base}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${env("OPENAI_API_KEY")}` },
          body: JSON.stringify({ model, temperature: 0, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
        });
        if (!res.ok) throw new Error(`판정 요청 실패 ${res.status}: ${(await res.text()).slice(0, 200)}`);
        const data = (await res.json()) as { choices: { message: { content: string } }[] };
        return data.choices[0]?.message.content ?? "";
      },
    };
  }
  throw new Error(`알 수 없는 MUNCHE_MEO_LLM: ${kind}`);
}
