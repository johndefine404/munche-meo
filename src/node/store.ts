// [Define404] munche-meo: 로컬 저장소 (SQLite, Node 내장 node:sqlite)
// 내 규칙과 가이드 문서 조각·임베딩을 한 파일에 둔다. 검색은 코사인 유사도를 직접 계산한다.
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { cosine, type GuideHit } from "../core/guide.ts";
import type { RuleSpec } from "../core/user-rules.ts";

export function defaultDbPath(): string {
  return process.env.MUNCHE_MEO_DB || join(homedir(), ".munche-meo", "munche.db");
}

export class Store {
  db: DatabaseSync;

  constructor(path = defaultDbPath()) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rules (id TEXT PRIMARY KEY, spec TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS docs (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, model TEXT NOT NULL, added_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY, doc_id INTEGER NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
        idx INTEGER NOT NULL, text TEXT NOT NULL, embedding BLOB NOT NULL
      );
    `);
  }

  saveRule(spec: RuleSpec) {
    this.db.prepare("INSERT OR REPLACE INTO rules (id, spec, updated_at) VALUES (?, ?, ?)").run(spec.id, JSON.stringify(spec), new Date().toISOString());
  }

  rules(): RuleSpec[] {
    return (this.db.prepare("SELECT spec FROM rules ORDER BY id").all() as { spec: string }[]).map((r) => JSON.parse(r.spec));
  }

  // 같은 이름의 문서는 바꿔 끼운다
  saveDoc(name: string, model: string, chunks: { idx: number; text: string; embedding: Float32Array }[]) {
    this.db.exec("BEGIN");
    try {
      const old = this.db.prepare("SELECT id FROM docs WHERE name = ?").get(name) as { id: number } | undefined;
      if (old) {
        this.db.prepare("DELETE FROM chunks WHERE doc_id = ?").run(old.id);
        this.db.prepare("DELETE FROM docs WHERE id = ?").run(old.id);
      }
      const r = this.db.prepare("INSERT INTO docs (name, model, added_at) VALUES (?, ?, ?)").run(name, model, new Date().toISOString());
      const ins = this.db.prepare("INSERT INTO chunks (doc_id, idx, text, embedding) VALUES (?, ?, ?, ?)");
      for (const c of chunks) ins.run(r.lastInsertRowid, c.idx, c.text, new Uint8Array(c.embedding.buffer));
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  docs(): { name: string; model: string; chunks: number; added_at: string }[] {
    return this.db
      .prepare("SELECT d.name, d.model, d.added_at, COUNT(c.id) AS chunks FROM docs d LEFT JOIN chunks c ON c.doc_id = d.id GROUP BY d.id ORDER BY d.name")
      .all() as never;
  }

  // 같은 임베딩 모델로 만든 조각만 비교한다 (모델이 다르면 벡터 공간이 다르다)
  search(query: Float32Array, model: string, k: number): GuideHit[] {
    const rows = this.db
      .prepare("SELECT d.name, c.idx, c.text, c.embedding FROM chunks c JOIN docs d ON d.id = c.doc_id WHERE d.model = ?")
      .all(model) as { name: string; idx: number; text: string; embedding: Uint8Array }[];
    return rows
      .map((r) => {
        const vec = new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength / 4);
        return { doc: r.name, chunk: r.idx, text: r.text, score: cosine(query, vec) };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }
}
