/* [Define404] 방문 신호. 페이지 열림(view), 실제 조작(human), 그 뒤 10초(engaged)를 한 번씩 보낸다.
   전환은 window.pulse("이름") 으로 보낸다. 접속 주소·쿠키는 쓰지 않는다. */
(function () {
  var END = "https://pulse.astorage9909.workers.dev/e";
  var vid;
  try { vid = localStorage.getItem("pulse_id") || (localStorage.setItem("pulse_id", (vid = Math.random().toString(36).slice(2) + Date.now().toString(36))), vid); } catch (e) { vid = ""; }
  function send(kind, name) {
    try {
      fetch(END, { method: "POST", headers: { "content-type": "text/plain" }, keepalive: true,
        body: JSON.stringify({ kind: kind, vid: vid, path: location.pathname, ref: kind === "view" ? document.referrer : "", name: name || "" }) });
    } catch (e) {}
  }
  window.pulse = function (name) { send("convert", name); };
  send("view");
  var done = 0, seen = 0, ev = ["scroll", "pointerdown", "keydown", "touchstart"];
  function tick() { if (document.visibilityState === "visible" && ++seen >= 10) return send("engaged"); setTimeout(tick, 1000); }
  function go() { if (done) return; done = 1; ev.forEach(function (e) { removeEventListener(e, go, true); }); send("human"); tick(); }
  ev.forEach(function (e) { addEventListener(e, go, { capture: true, passive: true }); });
})();
