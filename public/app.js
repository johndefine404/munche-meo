// [Define404] munche-meo 웹 화면 동작
(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const SEV = { error: "오류", warn: "경고", info: "참고" };
  const KEY = "munche-meo-token";

  // 열쇠는 이 브라우저에만 둔다. 저장소를 못 쓰는 환경이면 이번 화면에서만 쓴다
  let token = null;
  try { token = localStorage.getItem(KEY); } catch {}
  const saveToken = (t) => { token = t; try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch {} };

  async function api(path, opts = {}) {
    const headers = { "content-type": "application/json" };
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(path, { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `요청 실패 (${res.status})`), { status: res.status });
    return data;
  }

  // ---------- 검사 ----------
  const SAMPLE = [
    "이번 주에 예약 페이지 배포를 마쳤습니다. 결제 화면은 다음 주에 붙인다.",
    "",
    "- 메일 발송 경로 정리함",
    "- 고객 문의 3건에 **바로** 답변했습니다",
    "",
    "새 예약 화면은 손님이 처음 들어와서 날짜를 고르고 인원을 정한 다음 원하는 시간대를 눌러 바로 예약을 마칠 수 있도록 단계를 줄인 것이 가장 큰 변화라고 할 수 있습니다.",
  ].join("\n");

  const text = $("#text");
  const counter = () => ($("#char-count").textContent = `${text.value.length.toLocaleString()}자`);
  text.addEventListener("input", counter);
  $("#sample-btn").addEventListener("click", () => { text.value = SAMPLE; counter(); text.focus(); });

  function highlight(sentence, match) {
    const s = esc(sentence);
    if (!match) return s;
    const m = esc(match);
    const i = s.indexOf(m);
    return i < 0 ? s : `${s.slice(0, i)}<mark>${m}</mark>${s.slice(i + m.length)}`;
  }

  function render(data) {
    const vs = data.violations;
    const tally = { error: 0, warn: 0, info: 0 };
    vs.forEach((v) => tally[v.severity]++);
    $("#summary").innerHTML = vs.length
      ? `위반 ${vs.length}건${data.guide_layer && data.guide_layer !== "꺼짐" ? ` · 가이드 판정 ${esc(data.guide_layer)}` : ""}<div class="tally">${["error", "warn", "info"].filter((k) => tally[k]).map((k) => `<span class="sev ${k}">${SEV[k]} ${tally[k]}</span>`).join("")}</div>`
      : "걸린 규칙이 없습니다.";
    $("#results").innerHTML = vs
      .map((v) => `<li>
        <div class="v-head"><span class="sev ${v.severity}">${SEV[v.severity]}</span><span>${v.line}행</span><span>${esc(v.rule)}</span></div>
        <p class="v-msg">${esc(v.message)}</p>
        <p class="v-text">${highlight(v.text, v.match)}</p>
        ${v.suggestion ? `<p class="v-fix">${esc(v.suggestion)}</p>` : ""}
        ${v.cite ? `<p class="v-cite">근거: ${esc(v.cite.doc)} 조각 ${v.cite.chunk}, ${esc(v.cite.text.slice(0, 140))}</p>` : ""}
      </li>`)
      .join("");
  }

  $("#check-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!text.value.trim()) { $("#summary").textContent = "검사할 글을 넣어 주세요."; return; }
    const btn = e.submitter || $("#check-form button[type=submit]");
    btn.disabled = true;
    $("#summary").textContent = "검사하는 중입니다.";
    try {
      const packs = [...document.querySelectorAll("input[name=pack]:checked")].map((i) => i.value);
      render(await api("/api/check", { method: "POST", body: JSON.stringify({ text: text.value, packs, guide: !!token && $("#use-guide").checked }) }));
    } catch (err) {
      $("#summary").textContent = err.message;
      $("#results").innerHTML = "";
    } finally {
      btn.disabled = false;
    }
  });

  // ---------- 규칙 표 ----------
  api("/api/meta").then((m) => {
    $("#rule-rows").innerHTML = m.rules
      .map((r) => `<tr><td><code>${esc(r.id)}</code></td><td>${esc(r.pack)}</td><td><span class="sev ${r.severity}">${SEV[r.severity]}</span></td><td>${esc(r.description)}</td></tr>`)
      .join("");
    if (m.contact) $("#contact").href = m.contact;
    if (m.privacy) document.querySelectorAll(".privacy-link").forEach((a) => (a.href = m.privacy));
    if (m.signup === false) {
      const btn = $("#signup button[type=submit]");
      btn.disabled = true;
      $("#signup-msg").textContent = "가입과 내 규칙·가이드 기능은 준비 중입니다. 위의 기본 검사는 지금 바로 쓸 수 있습니다.";
    }
  }).catch(() => {});

  // ---------- 가입 ----------
  const RULE_SAMPLE = `rules:\n  - id: no-gogaeknim\n    description: 고객님 대신 손님이라고 씁니다\n    banned: [고객님]\n  - id: brand-name\n    replace: { 디파인404: Define404 }\n  - id: no-nominal-ending\n    description: 명사형 종결을 쓰지 않습니다\n    ending: { forbid: [함, 됨] }\n`;

  async function showMember() {
    $("#signup").hidden = true;
    $("#member").hidden = false;
    document.querySelector(".guide-only").hidden = false;
    try {
      const r = await api("/api/rules");
      $("#rules-yaml").value = r.yaml || RULE_SAMPLE;
      await loadMarketing();
      await loadGuides();
    } catch (err) {
      if (err.status === 401) { saveToken(null); location.reload(); }
    }
  }

  async function loadMarketing() {
    const me = await api("/api/me");
    $("#member-marketing").checked = me.consent_marketing;
    if (me.consent_marketing) $("#marketing-msg").textContent = `광고성 정보 수신 동의 중입니다 (${me.consent_marketing_at.slice(0, 10)} 동의, ${me.consent_marketing_expires_at.slice(0, 10)}까지). 체크를 풀면 바로 철회됩니다.`;
  }

  $("#member-marketing").addEventListener("change", async (e) => {
    try {
      const r = await api("/api/me/marketing", { method: "PUT", body: JSON.stringify({ consent: e.target.checked }) });
      const done = r.consent_marketing ? "광고성 정보 수신 동의를 처리했습니다." : "광고성 정보 수신 동의를 철회했습니다.";
      $("#marketing-msg").textContent = `${done} ${r.notice === "mail" ? "처리 결과 안내 메일을 보냅니다." : "이 서버는 메일 발송이 설정되지 않아 처리 기록만 남깁니다."}`;
    } catch (err) {
      e.target.checked = !e.target.checked;
      $("#marketing-msg").textContent = err.message;
    }
  });

  async function loadGuides() {
    const { guides } = await api("/api/guides");
    $("#guide-list").innerHTML = guides.length
      ? guides.map((g) => `<li><span>${esc(g.name)} <span class="note">조각 ${g.chunks}개</span></span><button type="button" data-id="${g.id}">지우기</button></li>`).join("")
      : `<li class="note">아직 등록한 문서가 없습니다.</li>`;
  }

  $("#signup").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("#signup-msg");
    try {
      const r = await api("/api/signup", {
        method: "POST",
        body: JSON.stringify({ email: $("#email").value, consent_privacy: $("#consent-privacy").checked, consent_marketing: $("#consent-marketing").checked }),
      });
      saveToken(r.token);
      showMember();
    } catch (err) {
      msg.textContent = err.message;
    }
  });

  $("#save-rules").addEventListener("click", async () => {
    try {
      const r = await api("/api/rules", { method: "PUT", body: JSON.stringify({ yaml: $("#rules-yaml").value }) });
      $("#rules-msg").textContent = `규칙 ${r.saved}개를 저장했습니다`;
    } catch (err) {
      $("#rules-msg").textContent = err.message;
    }
  });

  $("#add-guide").addEventListener("click", async () => {
    const f = $("#guide-file").files[0];
    if (!f) { $("#guide-msg").textContent = "파일을 골라 주세요"; return; }
    try {
      const r = await api("/api/guides", { method: "POST", body: JSON.stringify({ name: f.name, text: await f.text() }) });
      $("#guide-msg").textContent = `${r.name}: 조각 ${r.chunks}개로 등록했습니다`;
      $("#guide-file").value = "";
      loadGuides();
    } catch (err) {
      $("#guide-msg").textContent = err.message;
    }
  });

  $("#guide-list").addEventListener("click", async (e) => {
    const id = e.target.dataset?.id;
    if (!id) return;
    await api(`/api/guides/${id}`, { method: "DELETE" }).catch((err) => ($("#guide-msg").textContent = err.message));
    loadGuides();
  });

  $("#show-key").addEventListener("click", () => {
    const k = $("#key-text");
    k.textContent = token || "";
    k.hidden = !k.hidden;
  });

  $("#leave").addEventListener("click", async () => {
    if (!confirm("메일 주소, 내 규칙, 가이드 문서를 모두 지웁니다. 되돌릴 수 없습니다.")) return;
    await api("/api/me", { method: "DELETE" }).catch(() => {});
    saveToken(null);
    location.reload();
  });

  if (token) showMember();
})();
