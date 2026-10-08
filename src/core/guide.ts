// [Define404] munche-meo: 문서 층 (사용자 가이드를 근거로 문단을 판정)
//
// 1. 가이드 문서를 제목·문단 단위 조각으로 자른다
// 2. 조각과 검사할 문단을 임베딩해 가까운 조각 top-k를 찾는다
// 3. AI에게 "이 문단이 이 조각들에 어긋나는가"만 묻고, 근거 조각을 같이 돌려준다
import { parse } from "./split.ts";
import type { Violation } from "./types.ts";

export interface Chunk {
  idx: number;
  text: string;
}

export interface GuideHit {
  doc: string;
  chunk: number;
  text: string;
  score: number;
}

export type Retrieve = (query: string, k: number) => Promise<GuideHit[]>;
export type Complete = (system: string, user: string) => Promise<string>;

const MAX_CHUNK = 700;

// 제목을 조각 앞에 붙여 두면 짧은 조각도 무슨 규칙인지 알 수 있다
export function chunkGuide(text: string): Chunk[] {
  const out: Chunk[] = [];
  const doc = parse(text.replace(/\r\n/g, "\n"));
  let heading = "";
  let buf = "";
  const flush = () => {
    const t = buf.trim();
    if (t) out.push({ idx: out.length, text: heading ? `[${heading}] ${t}` : t });
    buf = "";
  };
  for (const b of doc.blocks) {
    if (b.kind === "heading") {
      flush();
      heading = b.sentences[0]?.text ?? "";
      continue;
    }
    if (buf && buf.length + b.text.length > MAX_CHUNK) flush();
    if (b.text.length > MAX_CHUNK) {
      for (const s of b.sentences.length ? b.sentences.map((x) => x.text) : [b.text]) {
        if (buf.length + s.length > MAX_CHUNK) flush();
        buf += s + "\n";
      }
    } else {
      buf += b.text + "\n\n";
    }
  }
  flush();
  return out;
}

// 키 없이 쓰는 로컬 임베딩: 글자 1~3그램을 해시해 512차원 벡터로 만든다.
// 의미 검색 품질은 실제 임베딩 모델보다 낮지만 0원이고 결과가 매번 같다.
export const LOCAL_DIMS = 512;
export function localEmbed(text: string): Float32Array {
  const v = new Float32Array(LOCAL_DIMS);
  const s = text.toLowerCase().replace(/\s+/g, " ");
  for (let n = 1; n <= 3; n++) {
    for (let i = 0; i + n <= s.length; i++) {
      const g = s.slice(i, i + n);
      if (g.trim().length < n) continue;
      let h = 2166136261;
      for (let j = 0; j < g.length; j++) h = Math.imul(h ^ g.charCodeAt(j), 16777619);
      v[(h >>> 0) % LOCAL_DIMS] += n;
    }
  }
  return normalize(v);
}

export function normalize(v: Float32Array): Float32Array {
  let sum = 0;
  for (const x of v) sum += x * x;
  const n = Math.sqrt(sum) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na * nb) || 1);
}

export const JUDGE_SYSTEM = `당신은 한국어 글 검사기입니다. 사용자가 준 가이드 조각만 근거로 판정합니다.
- 문단이 가이드 조각의 규칙을 분명히 어길 때만 위반으로 적습니다
- 가이드에 없는 일반 문법·취향은 판정하지 않습니다
- 글을 고쳐 쓰지 않습니다
- 반드시 JSON 하나만 출력합니다: {"violations":[{"sentence":"걸린 문장 원문","guide":조각번호,"reason":"어긴 규칙을 한 문장으로"}]}
- 위반이 없으면 {"violations":[]}`;

export function judgePrompt(paragraph: string, hits: GuideHit[]): string {
  const guide = hits.map((h, i) => `<조각 번호="${i}" 문서="${h.doc}">\n${h.text}\n</조각>`).join("\n");
  return `가이드 조각:\n${guide}\n\n검사할 문단:\n<문단>\n${paragraph}\n</문단>`;
}

export function parseJudge(raw: string, hits: GuideHit[], line: number): Violation[] {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return [];
  let data: { violations?: { sentence?: string; guide?: number; reason?: string }[] };
  try {
    data = JSON.parse(m[0]);
  } catch {
    return [];
  }
  const out: Violation[] = [];
  for (const v of data.violations ?? []) {
    const h = hits[Number(v.guide)];
    if (!h || !v.reason) continue;
    out.push({
      rule: "guide",
      severity: "warn",
      source: "guide",
      message: String(v.reason),
      line,
      text: String(v.sentence ?? ""),
      cite: { doc: h.doc, chunk: h.chunk, text: h.text },
    });
  }
  return out;
}

// 시험용 판정기: AI 대신, 가이드 조각에 "따옴표 낱말 + 쓰지 않/금지/피한" 이 있으면 문단에서 그 낱말을 찾는다
export const mockComplete: Complete = async (_system, user) => {
  const guidePart = user.split("검사할 문단:")[0];
  const para = user.split("<문단>")[1]?.split("</문단>")[0] ?? "";
  const violations: { sentence: string; guide: number; reason: string }[] = [];
  const blocks = [...guidePart.matchAll(/<조각 번호="(\d+)"[^>]*>([\s\S]*?)<\/조각>/g)];
  for (const [, no, body] of blocks) {
    for (const line of body.split("\n")) {
      if (!/쓰지 않|금지|피한/.test(line)) continue;
      for (const [, word] of line.matchAll(/["“']([^"”']{1,20})["”']/g)) {
        const sent = parse(para).sentences.find((s) => s.text.includes(word));
        if (sent) violations.push({ sentence: sent.text, guide: Number(no), reason: `가이드에서 "${word}"를 쓰지 않기로 했습니다` });
      }
    }
  }
  return JSON.stringify({ violations });
};

// 문단마다 가이드 조각을 찾아 판정한다. 제목·코드·표는 건너뛴다
export async function checkWithGuide(text: string, retrieve: Retrieve, complete: Complete, k = 4, minScore = 0): Promise<Violation[]> {
  const doc = parse(text);
  const out: Violation[] = [];
  for (const b of doc.blocks) {
    if (b.kind === "heading" || b.kind === "code" || b.kind === "table") continue;
    if (b.text.trim().length < 8) continue;
    const hits = (await retrieve(b.text, k)).filter((h) => h.score >= minScore);
    if (!hits.length) continue;
    const raw = await complete(JUDGE_SYSTEM, judgePrompt(b.text, hits));
    for (const v of parseJudge(raw, hits, b.line)) {
      const s = b.sentences.find((x) => v.text && (x.text.includes(v.text) || v.text.includes(x.text)));
      if (s) v.line = s.line;
      if (!v.text) v.text = b.text.slice(0, 120);
      out.push(v);
    }
  }
  return out;
}
