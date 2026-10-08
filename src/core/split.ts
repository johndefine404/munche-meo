// [Define404] munche-meo: 글을 블록(문단·목록·제목·코드)과 문장으로 나눈다
import type { Block, BlockKind, Doc, Sentence } from "./types.ts";

const LIST_RE = /^\s*(?:[-*+]|\d+[.)])\s+/;

function blockKind(firstLine: string): BlockKind {
  if (/^\s*```/.test(firstLine)) return "code";
  if (/^\s{0,3}#{1,6}\s/.test(firstLine)) return "heading";
  if (LIST_RE.test(firstLine)) return "list";
  if (/^\s*\|/.test(firstLine)) return "table";
  if (/^\s*>/.test(firstLine)) return "quote";
  return "prose";
}

// 마침표·물음표·느낌표 뒤에 공백이나 줄 끝이 오면 문장 경계. 줄바꿈도 경계로 본다.
export function splitSentences(text: string, base: number): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = [];
  let s = 0;
  const push = (end: number) => {
    const raw = text.slice(s, end);
    const lead = raw.length - raw.trimStart().length;
    const t = raw.trim();
    if (t) out.push({ text: t, start: base + s + lead });
    s = end;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\n") {
      push(i);
      s = i + 1;
      continue;
    }
    if (".!?。".includes(ch)) {
      let j = i + 1;
      while (j < text.length && ".!?。\"'”’)]」』".includes(text[j])) j++;
      if (j >= text.length || /\s/.test(text[j])) {
        push(j);
        i = j - 1;
      }
    }
  }
  push(text.length);
  return out;
}

export function parse(text: string): Doc {
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") lineStarts.push(i + 1);
  const lineOf = (offset: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  const lines = text.split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].trim()) {
      i++;
      continue;
    }
    const startLine = i;
    const kind = blockKind(lines[i]);
    if (kind === "code") {
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) i++;
      i++; // 닫는 ``` 포함
    } else if (kind === "heading") {
      i++;
    } else {
      i++;
      while (i < lines.length && lines[i].trim() && blockKind(lines[i]) !== "heading" && blockKind(lines[i]) !== "code") {
        // 목록 다음에 줄글이 붙으면 새 블록
        const k = blockKind(lines[i]);
        if (kind === "list" && k === "prose" && !/^\s+/.test(lines[i])) break;
        if (kind === "prose" && (k === "list" || k === "table")) break;
        i++;
      }
    }
    const start = lineStarts[startLine];
    const endLine = Math.min(i, lines.length) - 1;
    const end = lineStarts[endLine] + lines[endLine].length;
    const btext = text.slice(start, end);
    const block: Block = { kind, text: btext, start, line: startLine + 1, sentences: [] };
    const bi = blocks.length;

    if (kind === "heading") {
      const t = btext.replace(/^\s*#+\s*/, "");
      block.sentences.push({ text: t.trim(), start: start + btext.indexOf(t), line: startLine + 1, block: bi, kind: "heading" });
    } else if (kind === "list") {
      // 항목 하나 = 한 단위. 항목 안에 문장이 여럿이면 나눈다
      let off = 0;
      for (const ln of btext.split("\n")) {
        const m = ln.match(LIST_RE);
        const bodyOff = m ? m[0].length : ln.length - ln.trimStart().length;
        for (const s of splitSentences(ln.slice(bodyOff), start + off + bodyOff)) {
          block.sentences.push({ text: s.text, start: s.start, line: lineOf(s.start), block: bi, kind: "item" });
        }
        off += ln.length + 1;
      }
    } else if (kind === "prose" || kind === "quote") {
      const body = kind === "quote" ? btext.replace(/^\s*>\s?/gm, (m) => " ".repeat(m.length)) : btext;
      for (const s of splitSentences(body, start)) {
        block.sentences.push({ text: s.text, start: s.start, line: lineOf(s.start), block: bi, kind: "sentence" });
      }
    }
    blocks.push(block);
  }
  const sentences: Sentence[] = blocks.flatMap((b) => b.sentences);
  return { text, blocks, sentences, lineOf };
}

// 어절 수: 공백으로 나눈 덩어리 중 글자가 있는 것만 센다
export function countEojeol(s: string): number {
  return s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

// 인라인 코드(`...`)는 같은 길이의 공백으로 지워 위치를 유지한다
export function maskInlineCode(s: string): string {
  return s.replace(/`[^`\n]*`/g, (m) => " ".repeat(m.length));
}
