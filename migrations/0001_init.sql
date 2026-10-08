-- [Define404] munche-meo 웹 버전 D1 스키마

-- 메일 가입자 (리드). 개인정보 수집 동의는 필수, 광고성 정보 수신 동의는 선택으로 따로 받는다
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL UNIQUE,
  consent_privacy_at TEXT NOT NULL,
  consent_marketing INTEGER NOT NULL DEFAULT 0,
  consent_marketing_at TEXT,
  consent_version TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- 내 규칙 (YAML 원문 한 벌)
CREATE TABLE IF NOT EXISTS user_rules (
  lead_id INTEGER PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
  yaml TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 가이드 문서와 조각. 임베딩은 JSON 배열로 두고 코사인은 워커에서 계산한다
CREATE TABLE IF NOT EXISTS guides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS guide_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guide_id INTEGER NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
  lead_id INTEGER NOT NULL,
  idx INTEGER NOT NULL,
  text TEXT NOT NULL,
  embedding TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS guide_chunks_lead ON guide_chunks(lead_id);
CREATE INDEX IF NOT EXISTS guides_lead ON guides(lead_id);
