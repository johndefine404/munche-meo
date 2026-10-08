// [Define404] munche-meo: 문장 끝 어미로 높임 단계를 가른다 (형태소 분석기 없이 어미표로 판별)
//
// formal  : 존댓말 (~습니다, ~요, ~세요, ~죠)
// plain   : 반말·해라체 (~다, ~냐, ~했어, ~하자)
// nominal : 명사형 종결 (~함, ~됨, ~있음)
// null    : 판별 안 함 (명사로 끝나는 목록 항목, 영어·숫자로 끝나는 문장 등)

export type Level = "formal" | "plain" | "nominal";

// "필요", "중요"처럼 요로 끝나지만 어미가 아닌 낱말
const FORMAL_STOP = ["필요", "중요", "수요", "개요", "주요", "요요"];
// "포함", "책임"처럼 ㅁ으로 끝나는 명사
const NOMINAL_STOP = ["포함", "기함", "대함", "책임", "모임", "처음", "마음", "다음", "이음", "고함", "함함"];
// "바다"처럼 다로 끝나는 명사
const PLAIN_STOP = ["바다", "보다"];

const PLAIN_TAIL = [
  "냐", "하자", "가자", "보자", "두자", "되자", "먹자", "하라", "해라", "보라",
  "거야", "이야", "했어", "었어", "았어", "였어", "있어", "없어", "겠어", "됐어", "봤어",
  "할게", "줄게", "볼게", "할래", "잖아", "거든", "구나", "는군", "던데",
];
const PLAIN_Q_TAIL = ["어", "아", "지", "니", "나", "해", "야", "래", "냐"];

export interface Ending {
  level: Level;
  tail: string; // 판별에 쓴 끝 글자
  word: string; // 마지막 어절의 한글 부분
}

export function lastWord(sentence: string): { word: string; question: boolean } | null {
  const question = /\?\s*["'”’)\]」』]*\s*$/.test(sentence);
  let s = sentence.trim();
  for (let k = 0; k < 4; k++) {
    const before = s;
    s = s.replace(/[\s.!?。…~,:;"'”’」』\]*_]+$/u, "");
    s = s.replace(/\s*[(（][^()（）]*[)）]$/u, ""); // 끝의 괄호 보충은 떼고 본다
    if (s === before) break;
  }
  const last = s.split(/\s+/).pop() || "";
  const m = last.match(/[가-힣]+$/);
  if (!m) return null;
  return { word: m[0], question };
}

const ends = (w: string, list: string[]) => list.find((t) => w.endsWith(t));

export function classify(sentence: string): Ending | null {
  const lw = lastWord(sentence);
  if (!lw) return null;
  const { word, question } = lw;

  let t = word.match(/(니다|니까|세요|셔요|십시오|시오|죠)$/)?.[0];
  if (t) return { level: "formal", tail: t, word };
  if (word.length >= 2 && word.endsWith("요") && !FORMAL_STOP.some((x) => word.endsWith(x))) {
    return { level: "formal", tail: word.slice(-2), word };
  }

  t = word.match(/(있음|없음|했음|었음|았음|였음|겠음|않음|같음|됨|함|임)$/)?.[0];
  if (t && !NOMINAL_STOP.some((x) => word.endsWith(x))) return { level: "nominal", tail: t, word };

  if (word.length >= 2 && word.endsWith("다") && !PLAIN_STOP.some((x) => word === x)) {
    return { level: "plain", tail: word.slice(-2), word };
  }
  t = ends(word, PLAIN_TAIL);
  if (t) return { level: "plain", tail: t, word };
  if (question) {
    t = ends(word, PLAIN_Q_TAIL);
    if (t) return { level: "plain", tail: t, word };
  }
  return null;
}
