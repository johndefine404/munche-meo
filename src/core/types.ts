// [Define404] munche-meo: 공용 타입 (CLI, MCP 서버, 웹 버전이 같이 쓴다)

export type Severity = "error" | "warn" | "info";

export interface Violation {
  rule: string;
  severity: Severity;
  message: string;
  line: number;
  text: string; // 걸린 문장(또는 문단)
  match?: string; // 걸린 글자
  suggestion?: string;
  source: "rule" | "guide";
  cite?: { doc: string; chunk: number; text: string }; // 문서 층 근거 조각
}

export type BlockKind = "prose" | "list" | "heading" | "code" | "table" | "quote";

export interface Sentence {
  text: string;
  start: number; // 원문 기준 위치
  line: number; // 1부터
  block: number;
  kind: "sentence" | "item" | "heading";
}

export interface Block {
  kind: BlockKind;
  text: string;
  start: number;
  line: number;
  sentences: Sentence[];
}

export interface Doc {
  text: string;
  blocks: Block[];
  sentences: Sentence[];
  lineOf(offset: number): number;
}

export interface CheckOptions {
  packs?: string[]; // 켤 묶음. 기본은 ["default"]
  disable?: string[]; // 끌 규칙 id
  maxEojeol?: number; // 긴 문장 기준 (기본 20)
  prefer?: "formal" | "plain" | "auto"; // 존댓말·반말 기준 (기본 auto: 다수 쪽)
}

export type Hit = Omit<Violation, "rule" | "severity" | "source"> & { severity?: Severity };

export interface Rule {
  id: string;
  pack: string;
  description: string;
  severity: Severity;
  check(doc: Doc, opts: Required<CheckOptions>): Hit[];
}
