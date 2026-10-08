// [Define404] munche-meo: 기본 규칙 묶음
//
// default          : 엠대시, 섹션 기호, 존댓말·반말 섞임, 긴 문장, AI 상투어, 번역투
// external-message : 고객에게 그대로 보내는 글의 마크다운 기호 (선택)
// bullets          : 불릿으로 써야 하는 글의 줄글 문단 (선택)
//
// AI 상투어·번역투 목록은 Define404가 직접 고른 예시입니다. 완전한 목록이 아니며, 걸려도 고칠지는 글쓴이가 정합니다.
import { classify } from "./ending.ts";
import { countEojeol, maskInlineCode } from "./split.ts";
import type { Doc, Hit, Rule, Sentence } from "./types.ts";

function lineText(doc: Doc, offset: number): string {
  const s = doc.text.lastIndexOf("\n", offset - 1) + 1;
  const e = doc.text.indexOf("\n", offset);
  return doc.text.slice(s, e === -1 ? undefined : e).trim();
}

function charRule(id: string, re: RegExp, description: string, message: string, suggestion: string, severity: Rule["severity"]): Rule {
  return {
    id,
    pack: "default",
    description,
    severity,
    check(doc) {
      const hits: Hit[] = [];
      for (const m of doc.text.matchAll(re)) {
        const off = m.index ?? 0;
        hits.push({ line: doc.lineOf(off), text: lineText(doc, off), match: m[0], message, suggestion });
      }
      return hits;
    },
  };
}

type Phrase = { re: string; why: string; fix?: string };

// 직접 고른 예시 목록. 정규식 한 줄 = 한 항목
const AI_CLICHE: Phrase[] = [
  { re: "혁신적인|획기적인|압도적인", why: "근거 없이 크게 말하는 꾸밈말", fix: "수치나 사례로 바꾸세요" },
  { re: "아무리 강조해도 지나치지 않", why: "AI 글에 자주 나오는 강조 관용구", fix: "지우고 근거를 쓰세요" },
  { re: "결론적으로|요약하자면|종합적으로 (?:볼 때|보면)", why: "기계적인 마무리 접속어", fix: "지우고 결론부터 쓰세요" },
  { re: "(?:라고|다고) 할 수 있습니다", why: "단정을 피하는 말끝", fix: "~입니다로 단정하세요" },
  { re: "(?:살펴|알아)보겠습니다|이야기해 보겠습니다", why: "글 앞머리 안내 문구", fix: "지우고 본론부터 쓰세요" },
  { re: "시너지|극대화|원활한", why: "뜻이 흐린 사업 상투어", fix: "무엇이 어떻게 좋아지는지 쓰세요" },
  { re: "한 단계 더 나아가|새로운 지평|게임 체인저", why: "과장 관용구" },
  { re: "핵심적인 역할을", why: "AI 글에 자주 나오는 관용구", fix: "무슨 일을 하는지 쓰세요" },
  { re: "여정을|여정에", why: "과정을 여정으로 부르는 비유" },
  { re: "놓치지 마세요", why: "광고 상투어" },
];

const TRANSLATIONESE: Phrase[] = [
  { re: "에 있어서?", why: "번역투 조사", fix: "~에서, ~은/는" },
  { re: "[을를] 가지고 있", why: "have 직역", fix: "~이/가 있다" },
  { re: "에 의해(?:서)?", why: "수동태 직역", fix: "능동형으로 바꾸세요" },
  { re: "되어지|되어진|되어져", why: "이중 피동", fix: "된다, 된" },
  { re: "가장 \\S+ (?:것|\\S+) 중(?:의)? 하나", why: "one of the most 직역", fix: "꼭 필요하면 \"손꼽히는\"" },
  { re: "(?:으로|로) 인해", why: "번역투 인과 표현", fix: "~때문에, ~로" },
  { re: "하는 데 있어", why: "번역투", fix: "~할 때" },
  { re: "[을를] 진행(?:했|하|합)", why: "진행하다 남용", fix: "\"회의를 진행했습니다\" 대신 \"회의했습니다\"" },
  { re: "에 위치한", why: "located in 직역", fix: "~에 있는" },
  { re: "할 필요가 있", why: "need to 직역", fix: "~해야 합니다" },
  { re: "적(?:인)? 측면에서", why: "번역투 명사구", fix: "무엇이 어떤지 바로 쓰세요" },
];

function phraseRule(id: string, description: string, list: Phrase[]): Rule {
  const compiled = list.map((p) => ({ ...p, rx: new RegExp(p.re, "g") }));
  return {
    id,
    pack: "default",
    description,
    severity: "info",
    check(doc) {
      const hits: Hit[] = [];
      for (const s of doc.sentences) {
        const body = maskInlineCode(s.text);
        for (const p of compiled) {
          for (const m of body.matchAll(p.rx)) {
            hits.push({ line: s.line, text: s.text, match: m[0], message: `${p.why}: "${m[0]}"`, suggestion: p.fix });
          }
        }
      }
      return hits;
    },
  };
}

const speechLevel: Rule = {
  id: "speech-level",
  pack: "default",
  description: "존댓말과 반말(해라체·명사형 종결)이 한 글에 섞였는지",
  severity: "warn",
  check(doc, opts) {
    const rows: { s: Sentence; level: string; tail: string }[] = [];
    for (const s of doc.sentences) {
      if (s.kind === "heading") continue;
      const e = classify(maskInlineCode(s.text));
      if (e) rows.push({ s, level: e.level, tail: e.tail });
    }
    const formal = rows.filter((r) => r.level === "formal").length;
    const plain = rows.length - formal;
    let target: "formal" | "plain" | null = opts.prefer === "auto" ? null : opts.prefer;
    if (!target) {
      if (!formal || !plain) return [];
      target = formal >= plain ? "formal" : "plain";
    }
    const hits: Hit[] = [];
    for (const r of rows) {
      const isFormal = r.level === "formal";
      if (target === "formal" && !isFormal) {
        hits.push({
          line: r.s.line,
          text: r.s.text,
          match: r.tail,
          message: r.level === "nominal" ? `존댓말 글에 명사형 종결(~${r.tail})이 섞였습니다` : `존댓말 글에 반말 어미(~${r.tail})가 섞였습니다`,
          suggestion: "~습니다, ~요로 맞추세요",
        });
      } else if (target === "plain" && isFormal) {
        hits.push({ line: r.s.line, text: r.s.text, match: r.tail, message: `반말(해라체) 글에 존댓말 어미(~${r.tail})가 섞였습니다`, suggestion: "~다로 맞추세요" });
      }
    }
    return hits;
  },
};

const longSentence: Rule = {
  id: "long-sentence",
  pack: "default",
  description: "한 문장이 기준 어절 수(기본 20)를 넘는지",
  severity: "warn",
  check(doc, opts) {
    const hits: Hit[] = [];
    for (const s of doc.sentences) {
      const n = countEojeol(s.text);
      if (n > opts.maxEojeol) {
        hits.push({ line: s.line, text: s.text, message: `${n}어절입니다 (기준 ${opts.maxEojeol}어절)`, suggestion: "한 문장에 정보 하나만 담아 나누세요" });
      }
    }
    return hits;
  },
};

const MD_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\*\*[^*\n]+\*\*/g, label: "굵게 표시(**)" },
  { re: /^\s{0,3}#{1,6}\s/gm, label: "제목 기호(#)" },
  { re: /\|/g, label: "표 기호(|)" },
  { re: /`/g, label: "백틱(`)" },
  { re: /\[[^\]\n]*\]\([^)\n]*\)/g, label: "링크 문법([]())" },
  { re: /^\s*>/gm, label: "인용 기호(>)" },
];

const markdownSymbols: Rule = {
  id: "markdown-symbols",
  pack: "external-message",
  description: "고객에게 그대로 보내는 글에 마크다운 기호가 남았는지",
  severity: "error",
  check(doc) {
    const hits: Hit[] = [];
    for (const p of MD_PATTERNS) {
      const seen = new Set<number>();
      for (const m of doc.text.matchAll(p.re)) {
        const off = m.index ?? 0;
        const line = doc.lineOf(off);
        if (seen.has(line)) continue; // 같은 줄은 한 번만
        seen.add(line);
        hits.push({ line, text: lineText(doc, off), match: m[0].trim(), message: `메일·메신저에서 기호가 그대로 보입니다: ${p.label}`, suggestion: "기호를 지우고 문장, 줄바꿈, 번호로 구분하세요" });
      }
    }
    return hits;
  },
};

const proseParagraph: Rule = {
  id: "prose-paragraph",
  pack: "bullets",
  description: "불릿으로 써야 하는 글에 두 문장 넘는 줄글 문단이 있는지",
  severity: "warn",
  check(doc) {
    return doc.blocks
      .filter((b) => b.kind === "prose" && b.sentences.length >= 2)
      .map((b) => ({
        line: b.line,
        text: b.text.length > 80 ? b.text.slice(0, 80) + "..." : b.text,
        message: `${b.sentences.length}문장짜리 줄글 문단입니다`,
        suggestion: "한 줄에 한 건씩 불릿으로 나누세요",
      }));
  },
};

export const BUILTIN_RULES: Rule[] = [
  charRule("em-dash", new RegExp("\\u2014", "g"), "엠대시(U+2014)를 썼는지", "엠대시는 AI가 쓴 글이라는 인상을 줍니다", "쉼표(,)나 쌍점(:)으로 바꾸세요", "error"),
  charRule("section-sign", new RegExp("\\u00A7", "g"), "섹션 기호(U+00A7)를 썼는지", "섹션 기호는 일상 글에서 읽기 어렵습니다", "'제3조', '3절'처럼 글자로 쓰세요", "warn"),
  speechLevel,
  longSentence,
  phraseRule("ai-cliche", "AI 글에 자주 나오는 상투어 (예시 목록)", AI_CLICHE),
  phraseRule("translationese", "번역투 표현 (예시 목록)", TRANSLATIONESE),
  markdownSymbols,
  proseParagraph,
];

export const PACKS: Record<string, string> = {
  default: "기본 규칙: 엠대시, 섹션 기호, 존댓말·반말 섞임, 긴 문장, AI 상투어, 번역투",
  "external-message": "고객용 글: 마크다운 기호(**, #, |, 백틱, 링크, >) 금지",
  bullets: "보고용 글: 두 문장 넘는 줄글 문단 금지",
};
