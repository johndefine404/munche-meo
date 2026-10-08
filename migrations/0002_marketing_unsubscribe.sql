-- [Define404] munche-meo: 광고성 정보 수신 철회 링크용 값
-- 메일 속 링크 한 번으로 철회할 수 있게 한다. 이 값으로는 광고 수신 철회만 할 수 있고 다른 자료는 열리지 않는다
ALTER TABLE leads ADD COLUMN unsub_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS leads_unsub_token ON leads(unsub_token);
