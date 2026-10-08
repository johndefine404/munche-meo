<p align="center"><img src="public/logo.svg" width="80" alt="문체냥 로고"></p>

# 문체냥 (munche-meo)

[Define404]

한국어 글의 문체 규칙 위반을 문장마다 짚어 주는 고양이 검사기입니다.

AI가 쓴 한국어 글, 회사·브랜드 문서를 검사해서 규칙 위반을 문장 단위로 짚어 주는 오픈소스 검사기입니다. 고쳐 쓰지는 않습니다. 어느 문장이 어떤 규칙에 걸렸는지만 알려 줍니다.

- 규칙 층: 규칙표로만 검사합니다. AI를 부르지 않아 0원이고 결과가 매번 같습니다
- 문서 층: 내 문체 가이드, 브랜드 보이스, 용어집을 등록하면 문단마다 관련 조각을 찾아 AI가 어긋나는지 판정하고 근거 조각을 같이 보여 줍니다
- 한 엔진을 MCP 서버, 명령줄, Claude Code 훅, 웹 버전에서 같이 씁니다
- 오픈소스(MIT)라 누구나 무료로 쓰고 고칠 수 있습니다

## 기본 규칙

| 규칙 | 묶음 | 단계 | 무엇을 보나 |
|---|---|---|---|
| `em-dash` | default | 오류 | 엠대시(U+2014). 쉼표나 쌍점으로 바꾸라고 안내합니다 |
| `section-sign` | default | 경고 | 섹션 기호(U+00A7) |
| `speech-level` | default | 경고 | 존댓말(~습니다, ~요)과 반말·해라체(~다, ~했어), 명사형 종결(~함, ~됨)이 한 글에 섞였는지. 다수 쪽을 기준으로 소수 쪽을 짚습니다 |
| `long-sentence` | default | 경고 | 한 문장이 20어절을 넘는지 (기준은 바꿀 수 있습니다) |
| `ai-cliche` | default | 참고 | AI 글에 자주 나오는 상투어 예시 ("라고 할 수 있습니다", "살펴보겠습니다" 등) |
| `translationese` | default | 참고 | 번역투 예시 ("에 있어서", "를 가지고 있다", "되어지다" 등) |
| `markdown-symbols` | external-message | 오류 | 고객에게 그대로 보내는 글에 남은 `**`, `#`, `|`, 백틱, 링크 문법, `>` |
| `prose-paragraph` | bullets | 경고 | 불릿으로 써야 하는 보고 글에 두 문장 넘는 줄글 문단 |

- `default` 묶음은 항상 켜집니다. `external-message`, `bullets`는 필요할 때 켭니다
- 상투어·번역투 목록은 Define404가 직접 고른 예시입니다. 완전한 목록이 아니고, 걸려도 고칠지는 글쓴이가 정합니다
- 제목, 코드 블록, 인라인 코드 안은 문장 검사에서 뺍니다

### 존댓말·반말 판별 방식

문장 끝 어절의 어미를 어미표로 판별합니다. 형태소 분석기(Kiwi 등)는 아직 쓰지 않습니다.

- 존댓말: ~니다, ~니까, ~세요, ~요, ~죠
- 반말·해라체: ~다, ~냐, ~했어, ~거야, ~하자, 물음표로 끝나는 ~어/~지 등
- 명사형 종결: ~함, ~됨, ~있음, ~없음 등
- "필요", "포함", "책임"처럼 어미와 모양이 같은 명사는 예외 목록으로 거릅니다
- 명사로 끝나는 목록 항목("반영 완료")은 판별하지 않습니다

어미표 방식이라 놓치거나 잘못 짚는 문장이 있습니다. 걸린 문장을 보고 판단해 주세요.

## 내 규칙 (YAML)

```yaml
rules:
  - id: no-gogaeknim            # 영문 소문자·숫자·하이픈
    description: 고객님 대신 손님이라고 씁니다
    severity: warn              # error | warn | info (기본 warn)
    banned: [고객님]             # 금지어

  - id: brand-name
    severity: error
    replace: { 디파인404: Define404 }   # 바꿀 말 제안

  - id: no-double-bang
    regex: "!{2,}"              # 정규식 (flags: i, m, s, u)

  - id: no-nominal-ending
    ending: { forbid: [함, 됨] }  # 어미 조건: level(formal|plain), forbid, require
```

규칙 하나에 `banned`, `replace`, `regex`, `ending` 중 하나만 적습니다. 예시: `examples/rules.yaml`

프로젝트 루트에 `.munche-meo.yaml`을 두면 명령줄과 훅이 자동으로 읽습니다. 예시: `examples/munche-meo.yaml`

```yaml
packs: [default, bullets]
disable: [ai-cliche]
max_eojeol: 20
prefer: formal        # auto(다수 쪽) | formal | plain
rules: [...]
```

## 설치

Node.js 22.18 이상이 필요합니다 (TypeScript 파일을 그대로 실행합니다. 24 이상 권장).

```bash
git clone https://github.com/johndefine404/munche-meo
cd munche-meo
npm install
npm test
npm run check   # 타입 검사
```

npm 배포는 아직 하지 않았습니다. 아래 예시의 `/절대경로/munche-meo`는 내려받은 폴더 경로로 바꿉니다.

## 명령줄

```bash
node src/node/cli.ts check docs/                       # 폴더 안 .md, .txt 전부
node src/node/cli.ts check 안내문.txt --pack external-message
node src/node/cli.ts check 보고.md --pack bullets --rules examples/rules.yaml
cat 답변.txt | node src/node/cli.ts check              # 표준 입력
node src/node/cli.ts check docs/ --json --no-llm       # 규칙만, JSON 출력
node src/node/cli.ts rules                             # 규칙 목록
node src/node/cli.ts rule add examples/rules.yaml      # 내 규칙 저장
node src/node/cli.ts guide add examples/style-guide.md # 가이드 문서 등록
node src/node/cli.ts guide search "호칭"               # 가이드 조각 찾기
```

- 종료 코드: 0 통과, 1 위반 있음, 2 사용법 오류
- `--fail-on error|warn|info`로 실패 기준을 정합니다 (기본 warn, 참고 단계는 실패로 치지 않습니다)
- 저장소 파일은 `~/.munche-meo/munche.db`입니다 (`--db` 또는 `MUNCHE_MEO_DB`로 바꿉니다). 검사만 할 때는 이 파일을 새로 만들지 않습니다

### 커밋 전 검사

`.git/hooks/pre-commit`:

```sh
#!/bin/sh
files=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(md|txt)$')
[ -z "$files" ] && exit 0
node /절대경로/munche-meo/src/node/cli.ts check $files --no-llm
```

### CI (GitHub Actions 예시, 아직 실제 저장소에서 돌려 보지 않았습니다)

```yaml
- uses: actions/setup-node@v4
  with: { node-version: 24 }
- run: git clone --depth 1 https://github.com/johndefine404/munche-meo /tmp/hg && npm ci --prefix /tmp/hg
- run: node /tmp/hg/src/node/cli.ts check docs/ --no-llm
```

## 문서 층 (가이드 문서 RAG)

1. `guide add`나 MCP `add_guide_document`로 문서를 넣으면 제목·문단 단위 조각으로 자르고 임베딩해 SQLite에 저장합니다
2. 검사할 때 문단마다 가까운 조각 4개를 찾습니다 (코사인 유사도)
3. AI에게 "이 문단이 이 조각들에 어긋나는가"만 묻고, 위반과 근거 조각을 돌려줍니다

| 환경 변수 | 값 | 설명 |
|---|---|---|
| `MUNCHE_MEO_EMBED` | `local` / `openai` | 기본: `OPENAI_API_KEY`가 있으면 openai, 없으면 local |
| `MUNCHE_MEO_EMBED_MODEL` | | openai 기본 `text-embedding-3-small` |
| `MUNCHE_MEO_LLM` | `anthropic` / `openai` / `mock` / `none` | 기본: `ANTHROPIC_API_KEY`가 있으면 anthropic, `OPENAI_API_KEY`가 있으면 openai, 둘 다 없으면 꺼짐 |
| `MUNCHE_MEO_LLM_MODEL` | | anthropic 기본 `claude-haiku-4-5`, openai 기본 `gpt-4o-mini` |
| `OPENAI_BASE_URL` | | OpenAI 호환 서버(Ollama, LM Studio 등) 주소 |

- `local` 임베딩은 글자 조각을 해시한 벡터입니다. 키 없이 0원으로 돌지만 의미 검색 품질은 실제 임베딩 모델보다 낮습니다
- 임베딩 방식을 바꾸면 문서를 다시 등록해야 합니다 (모델이 같은 조각끼리만 비교합니다)
- `--no-llm`(명령줄)이나 `use_guide: false`(MCP)로 문서 층을 끄면 규칙 층만 돕니다
- 받는 문서는 .md, .txt입니다. PDF는 텍스트로 바꿔서 넣어 주세요
- 시험은 `local` 임베딩과 `mock` 판정기로만 했습니다. 실제 Anthropic·OpenAI 호출은 아직 시험하지 않았습니다

## MCP 서버

도구: `check_text`, `add_rule`, `list_rules`, `add_guide_document`, `search_guide`

### Claude Code

```bash
claude mcp add munche-meo -- node /절대경로/munche-meo/src/node/mcp.ts
```

### Claude 데스크톱

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "munche-meo": {
      "command": "node",
      "args": ["/절대경로/munche-meo/src/node/mcp.ts"],
      "env": { "ANTHROPIC_API_KEY": "" }
    }
  }
}
```

### Cursor

`.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "munche-meo": { "command": "node", "args": ["/절대경로/munche-meo/src/node/mcp.ts"] }
  }
}
```

`node`를 못 찾으면 `command`에 `which node`로 나온 절대경로를 넣습니다. `env`의 키를 비우면 규칙 층만 돕니다.

### ChatGPT 개발자 모드 (원격, 미시험)

웹 버전을 배포하면 `https://<워커 주소>/mcp`가 원격 MCP 주소입니다. 상태 없는 HTTP JSON-RPC이고 `check_text`, `list_rules` 두 도구만 있습니다 (기본 규칙만, 내 규칙·가이드 없음). ChatGPT 개발자 모드 커넥터에 이 주소를 넣으면 되도록 만들었지만 실제 ChatGPT에서는 아직 시험하지 않았습니다.

확인한 것: stdio 서버는 initialize, tools/list, tools/call 요청을 직접 보내 응답을 확인했습니다. Claude 데스크톱, Claude Code, Cursor 앱 안에서 붙여 본 것은 아닙니다.

## Claude Code 훅

답변이 끝날 때(Stop) 마지막 답변을 규칙 층으로 검사합니다. 위반이 있으면 Claude에게 목록을 돌려줘 그 부분만 다시 쓰게 합니다. 같은 답변을 두 번 막지는 않습니다. AI 호출은 없습니다.

`~/.claude/settings.json` (또는 프로젝트의 `.claude/settings.json`):

```json
{
  "hooks": {
    "Stop": [
      { "hooks": [{ "type": "command", "command": "node /절대경로/munche-meo/hooks/claude-stop-hook.ts" }] }
    ]
  }
}
```

| 환경 변수 | 설명 |
|---|---|
| `MUNCHE_MEO_HOOK_MODE` | `block`(기본, 다시 쓰게 함) / `warn`(화면 알림만) |
| `MUNCHE_MEO_HOOK_PACKS` | 더 켤 묶음. 예: `bullets,external-message` |
| `MUNCHE_MEO_HOOK_FAIL_ON` | `error` / `warn`(기본) / `info` |

작업 폴더에 `.munche-meo.yaml`이 있으면 그 설정과 규칙을 씁니다. 가짜 대화 기록 파일로 동작을 확인했고, 실제 Claude Code 세션에 설치해 본 것은 아닙니다.

## 웹 버전 (Cloudflare Workers)

- 글을 붙여 넣으면 기본 규칙으로 검사합니다. 가입 없이 무료이고 글은 저장하지 않습니다
- 메일로 가입하면 내 규칙 저장과 가이드 문서 등록이 열립니다
  - 개인정보 수집·이용 동의(필수)와 광고성 정보 수신 동의(선택)를 따로 받고, 동의 시각과 문구 판을 D1에 남깁니다
  - 가입하면 열쇠(무작위 64자)를 주고 서버에는 해시만 둡니다. 메일 확인 기능은 아직 없어서 같은 메일로 열쇠를 다시 받을 수 없습니다
  - 탈퇴하면 메일, 동의 기록, 규칙, 가이드를 바로 지웁니다
- 가이드 임베딩은 Workers AI `@cf/baai/bge-m3`, 판정은 `@cf/meta/llama-3.3-70b-instruct-fp8-fast`입니다. 조각은 D1에 두고 코사인은 워커에서 계산합니다 (Vectorize 전환은 다음 판)
- 새 가입이 오면 `RESEND_API_KEY`, `OWNER_EMAIL`이 있을 때 메일로 알리고, 없으면 로그에만 남깁니다
- 접속자별 요청 제한(1분 30번), 글 2만 자, 문서 10개·조각 300개 상한이 있습니다

### 개인정보와 광고 수신

법률 자문이 아닌 운영 기준입니다. 웹 버전에만 해당하고, 명령줄·MCP 서버·훅은 자료를 내 컴퓨터 밖으로 보내지 않습니다(가이드 판정 AI를 켠 경우 그 AI 제공자로 가는 글은 제외).

- 기본 검사에 넣은 글은 저장하지 않습니다. 요청 제한에 접속 IP를 쓰지만 저장하지 않습니다
- 가입(필수 동의)
  - 목적: 회원 식별, 내 규칙 저장, 가이드 문서 등록, 동의 처리 결과 같은 서비스 안내
  - 항목: 메일 주소, 동의 일시와 문구 판, 직접 저장한 규칙과 가이드 문서
  - 기간: 탈퇴할 때까지. 탈퇴하면 바로 지웁니다. 열쇠를 잃었으면 [연락처](https://contact.define404.com)로 요청하면 지웁니다
  - 동의하지 않아도 기본 검사는 쓸 수 있고, 가입 기능만 쓸 수 없습니다
- 광고성 정보 수신(선택 동의, 기본값 체크 안 함)
  - 목적: Define404 새 기능, 설치·가이드 정리 대행 안내를 메일로 보내기
  - 항목: 메일 주소, 동의 일시
  - 기간: 철회하거나 탈퇴할 때까지. 동의한 지 2년이 지나면 동의를 끝냅니다(재확인 방식은 자동 종료로 정했습니다. 매일 한국 시각 오전 10시 cron이 처리하고 본인에게 알립니다)
  - 동의하지 않아도 모든 기능을 똑같이 씁니다
  - 철회: 가입 후 화면의 체크 풀기, 또는 메일 속 링크 한 번(`/api/unsubscribe`, 열쇠 없이 비용 없음)
  - 동의, 거부, 철회, 탈퇴, 자동 종료 때마다 처리 결과 안내 메일을 본인에게 보냅니다. 안내 메일에는 광고를 넣지 않고 보낸 곳(Define404)과 연락처를 적습니다. `RESEND_API_KEY`가 없으면 메일 대신 처리 종류만 로그에 남깁니다
- 지금 판에는 광고성 메일을 보내는 기능이 없습니다. 나중에 넣으면 동의가 유효한 사람에게만, 한국 시각 오전 8시부터 오후 9시 전까지만, 제목을 (광고)로 시작하고 보낸 곳·연락처·수신 거부 링크를 넣어 보냅니다
- 자료를 맡기는 곳: Cloudflare(서버, D1 저장소, Workers AI), Resend(메일 발송, 설정한 경우만)
- 기준으로 삼은 조문
  - 개인정보 보호법 제15조 제2항: 목적, 항목, 보유·이용 기간, 거부권과 거부 시 불이익을 알리고 동의를 받습니다
  - 개인정보 보호법 제22조 제1항·제5항: 동의는 항목별로 나누고, 광고 수신 동의는 따로 받으며, 선택 동의를 안 했다고 서비스를 거절하지 않습니다
  - 정보통신망법 제50조: 사전 동의(제1항), 거부 후 발송 금지(제2항), 야간 별도 동의(제3항), 보낸 곳·연락처·철회 방법 표시(제4항), 철회 비용 없음(제6항), 처리 결과 통지(제7항), 2년마다 재확인(제8항)

### 로컬 시험 (AI 호출 없음)

```bash
npm install
npm run dev:mock      # D1 로컬 마이그레이션 + wrangler dev (wrangler.mock.toml)
```

`wrangler.mock.toml`은 AI 바인딩이 없어 Cloudflare 계정에 접속하지 않습니다. 가이드 판정은 로컬 임베딩과 시험용 판정기로 돕니다.

### 배포 (아직 하지 않았습니다)

```bash
npx wrangler login
npx wrangler d1 create munche-meo      # 나온 database_id 를 wrangler.toml 에 넣는다
npx wrangler d1 migrations apply DB --remote
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put OWNER_EMAIL
npx wrangler deploy
```

| 이름 | 위치 | 설명 |
|---|---|---|
| `EMBED_MODEL` | vars | 가이드 임베딩 모델 |
| `LLM_MODEL` | vars | 가이드 판정 모델 |
| `CONTACT_URL` | vars | 대행 문의 버튼 주소 |
| `MAIL_FROM` | vars | 알림 메일 보내는 주소 |
| `MOCK` | vars | `1`이면 Workers AI를 부르지 않습니다 |
| `RESEND_API_KEY` | secret | 동의 처리 결과 안내 메일과 가입 알림 메일 (선택, 없으면 로그만) |
| `OWNER_EMAIL` | secret | 가입 알림을 받을 운영자 메일 (선택) |

## 폴더

```
src/core/    규칙 엔진, 문장 나누기, 어미 판별, 사용자 규칙, 가이드 RAG, MCP 처리 (공용)
src/node/    명령줄, MCP stdio 서버, SQLite 저장소, AI 연결
src/web/     Cloudflare Worker (Hono)
public/      웹 화면
hooks/       Claude Code Stop 훅
migrations/  D1 스키마 (0002: 수신 거부 링크 값)
examples/    예시 글, 규칙, 가이드, 설정
test/        node --test 시험
```

## 함께 보면 좋은 것

- [im-not-ai](https://github.com/epoko77-ai/im-not-ai) (MIT): AI 티 나는 한국어 글을 고쳐 쓰는 도구입니다. munche-meo는 고쳐 쓰지 않고 검사만 하는 쪽이라 역할이 다릅니다. 코드와 패턴 목록은 가져오지 않았습니다

## 만든 곳

[Define404](https://contact.define404.com) · JohnLKim

팀 문체 가이드를 규칙 파일로 정리하는 일, 사내 도구에 설치하는 일은 Define404에 문의해 주세요.

---

## English

munche-meo (Munche-nyang, 문체냥) is an open-source Korean writing checker. It flags rule violations sentence by sentence and never rewrites text. The rule layer is deterministic and free: em dash ban, honorific/plain speech-level mixing (ending-table based, no morphological analyzer yet), sentences over 20 eojeol, translationese and AI cliche examples, and opt-in packs for markdown symbols in customer-facing text and prose paragraphs where bullets are expected. Users can add YAML rules (banned words, replacements, regex, sentence-ending conditions). The document layer indexes your own style guide in SQLite and asks an LLM (Anthropic or OpenAI-compatible, optional) whether each paragraph violates the retrieved guide excerpts, citing the excerpt. The same engine runs as a stdio MCP server, a CLI with CI-friendly exit codes, a Claude Code Stop hook, and a Cloudflare Workers web app (Hono, D1, Workers AI). Tested locally with mock AI only. MIT licensed.
