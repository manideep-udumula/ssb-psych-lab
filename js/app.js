/* =====================================================================
   SSB Psych Lab — app (static site; Supabase or browser storage)
   ===================================================================== */
(function () {
  "use strict";
  const { FACTORS, OLQS, assess, OLQ_TIPS } = window.PsychEngine;
  const PROGRAM_DAYS = 30;
  const TESTS = {
    tat: { code: "TAT", name: "Thematic Apperception Test", options: [4, 6, 12], def: 12, spec: (n) => `${n === 12 ? "11 pictures + blank slide" : n + " pictures"} · 30 s view + 4 min write`, minutes: (n) => Math.round(n * 4.5) },
    wat: { code: "WAT", name: "Word Association Test", options: [20, 40, 60], def: 60, spec: (n) => `${n} words · 15 s each`, minutes: (n) => Math.round((n * 15) / 60) },
    srt: { code: "SRT", name: "Situation Reaction Test", options: [20, 40, 60], def: 60, spec: (n) => `${n} situations · ${n / 2} min total`, minutes: (n) => n / 2 },
    sd: { code: "SD", name: "Self Description", options: [5], def: 5, spec: () => "5 paragraphs · 15 min", minutes: () => 15 },
  };
  const TAT_VIEW = 30, TAT_WRITE = 240, TAT_BLANK_VIEW = 60, WAT_SEC = 15, SRT_SEC_PER = 30, SD_SEC = 900;
  const SD_PROMPTS = [
    "What do your parents think about you?",
    "What do your teachers / employer think about you?",
    "What do your friends and colleagues think about you?",
    "What do you think about yourself?",
    "What qualities would you like to develop in yourself?",
  ];

  /* ---------- utils ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad = (n) => String(n).padStart(2, "0");
  const fmtClock = (s) => { s = Math.max(0, Math.ceil(s)); return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; };
  const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseLocal = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const daysBetween = (a, b) => Math.round((parseLocal(b) - parseLocal(a)) / 86400000);
  const fmtDate = (s) => parseLocal(s).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const words = (s) => (s || "").trim().split(/\s+/).filter(Boolean).length;
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const r1 = (n) => (n == null ? "—" : (Math.round(n * 10) / 10).toFixed(1));
  const scoreClass = (v) => (v == null ? "neutral" : v >= 7 ? "good" : v >= 5 ? "warn" : "bad");
  const today = () => localDate();

  /* ---------- state ---------- */
  const S = { user: null, sessions: [], overall: null, choice: {}, view: "today", reportId: null, filter: "all", page: "landing", notice: "", last: 0, authMode: "login", ai: { reviews: [], status: null, pending: {}, err: {} }, battery: null, pass: null };
  const PAY = Object.assign({ upiId: "", payee: "SSB Psych Lab", price: 299, regularPrice: 0, launchSeats: 0 }, (window.SSB_CONFIG || {}).payment || {});
  PAY.launch = PAY.regularPrice > PAY.price; PAY.left = null; PAY.seats = PAY.launchSeats;
  // Live offer from the server: price now, regular price, and how many launch passes are really left
  function applyOffer(o) {
    if (!o || !o.price) return;
    PAY.price = +o.price; if (o.regular) PAY.regularPrice = +o.regular;
    if (o.seats != null) PAY.seats = +o.seats; if (o.left != null) PAY.left = +o.left;
    PAY.launch = !!o.launch && PAY.regularPrice > PAY.price;
  }
  const offPct = () => Math.round((1 - PAY.price / PAY.regularPrice) * 100);
  const seatsTxt = () => (PAY.left != null && PAY.seats ? `${PAY.left} of ${PAY.seats} launch passes left` : `First ${PAY.seats || 100} candidates only`);
  const GUEST_ROUTES = ["login", "register", "forgot", "reset"];   // visitor-only pages; "reset" is the link from the reset email
  const BATTERY_ORDER = ["tat", "wat", "srt", "sd"], BATTERY_BREAK = 120;
  const dayNum = (d) => (S.user ? daysBetween(S.user.startDate, d || today()) + 1 : 1);
  const setNum = (day) => (((Math.max(1, day) - 1) % PROGRAM_DAYS) + 1);   // content set 1..30, cycles after day 30
  const assessed = () => S.sessions.filter((s) => s.assessment);
  const tatPic = (id) => window.TAT_BANK.find((p) => p.id === id);

  function itemsFor(test, set, count) {
    const i = set - 1;
    if (test === "wat") return window.WAT_DAYS[i].slice(0, count).map((x) => ({ w: x.w, c: x.c, i: x.i }));
    if (test === "srt") return window.SRT_DAYS[i].slice(0, count).map((x) => ({ t: x.t, c: x.c }));
    if (test === "tat") { const pics = count === 12 ? 11 : count; const ids = window.TAT_DAYS[i].slice(0, pics).map((id) => ({ id })); if (count === 12) ids.push({ blank: true }); return ids; }
    return SD_PROMPTS.map((t) => ({ t }));
  }

  /* ---------- routing ---------- */
  function setView(v, id) {
    S.view = v; S.reportId = id || null;
    const h = (v === "report" || v === "battery") && id ? v + "-" + id : v;
    if (location.hash.slice(1) !== h) history.replaceState(null, "", "#" + h);
    render(); window.scrollTo(0, 0);
  }
  function readHash() {
    const h = location.hash.slice(1);
    if (!S.user) { S.page = GUEST_ROUTES.includes(h) ? "auth" : "landing"; if (S.page === "auth") S.authMode = h === "reset" ? "recovery" : h; }
    if (h.startsWith("report-")) { S.view = "report"; S.reportId = h.slice(7); }
    else if (h.startsWith("battery-")) { S.view = "battery"; S.reportId = h.slice(8); }
    else if (["today", "progress", "interview"].includes(h)) S.view = h; else S.view = "today";
  }
  window.addEventListener("hashchange", () => { readHash(); render(); });

  /* ---------- render ---------- */
  function render() {
    const nav = $("#nav"), main = $("#main");
    document.body.classList.toggle("authed", !!S.user);
    $("#guestBtns").hidden = !!S.user;
    if (!S.user) {
      if (S.authMode === "recovery" && !Store.isRecovery()) { S.authMode = "forgot"; S.notice = "That reset link has expired or was already used. Request a new one."; }
      const key = S.page === "auth" ? "auth-" + S.authMode : "landing";
      if (S.lastLogged !== key) { S.lastLogged = key; Store.logView(S.page === "auth" ? "auth" : "landing"); }
      nav.hidden = true; $("#chest").textContent = "SSB PSYCH PRACTICE"; $("#userBtns").hidden = true;
      main.innerHTML = S.page === "auth" ? viewAuth() : viewLanding();
      if (S.page === "auth") bindAuth();
      return;
    }
    nav.hidden = false; $("#userBtns").hidden = false; $("#hqBtn").hidden = !S.isAdmin;
    $("#chest").textContent = `CHEST NO. ${S.user.chest}`;
    document.querySelectorAll(".tab").forEach((b) => b.setAttribute("aria-current", b.dataset.view === (S.view === "report" || S.view === "battery" ? "progress" : S.view) ? "page" : "false"));
    let html = "";
    if (!Store.persistent) html += `<div class="banner">This browser is blocking local storage, so progress will be lost when you close the page.</div>`;
    if (S.view === "today") html += viewToday();
    else if (S.view === "progress") html += viewProgress();
    else if (S.view === "report") html += viewReport();
    else if (S.view === "battery") html += viewBattery();
    else html += viewInterview();
    main.innerHTML = html; bind(); feedbackBanner();
    const key = S.view;
    if (key !== S.lastLogged) { S.lastLogged = key; Store.logView(key); }
  }

  /* ---------- auth ---------- */
  /* ---------- home page: what every visitor sees; any action asks them to log in or register ---------- */
  function viewLanding() {
    const cards = Object.entries(TESTS).map(([, t]) => `<button class="card test landing-test" type="button" data-gate="register">
        <div><div class="code">${t.code}</div><div class="tname">${t.name}</div></div>
        <div class="spec">${t.spec(t.def)} · ~${t.minutes(t.def)} min</div>
        <span class="linkish">Register to take this test →</span></button>`).join("");
    return `<section class="card hero">
        <div class="eyebrow">SSB psychology practice · 30-day program</div>
        <h1 class="hero-h">Practise the board the way it is run.</h1>
        <p class="lead">Daily TAT, WAT, SRT and Self Description in real board timings, then a psychologist's review of how each response reads against the Officer Like Qualities.</p>
        ${PAY.launch ? `<div class="launchbar"><span class="offer-tag">Launch offer</span><span class="lp"><b>Full 30-day pass ₹${PAY.price}</b> <s class="was-s">₹${PAY.regularPrice}</s></span><span class="muted">${offPct()}% off · ${seatsTxt()} · Day 1 free</span></div>` : ""}
        <div class="row" style="gap:10px"><button class="btn" type="button" data-gate="register">Register and get your chest number</button><button class="btn quiet" type="button" data-gate="login">Log in</button></div>
        <p class="muted" style="font-size:13px;margin:0">Free to start. Your chest number is allotted when you register.</p>
      </section>
      <section><div class="section-h" style="margin-bottom:12px"><h2>The four tests</h2><span class="muted" style="font-size:14px">Register to start any test</span></div><div class="tests">${cards}</div></section>
      <section class="two">
        <div class="card"><h2 class="sub">How the 30 days work</h2><ol class="list">
          <li>Register, then take your tests each day at your own pace.</li>
          <li>Every response is scored against the OLQs, with what to practise next.</li>
          <li>Run the full battery to get one psychologist's review across all four tests.</li></ol></div>
        <div class="card"><h2 class="sub">What you get</h2><ul class="list">
          <li class="str">An OLQ profile that builds up over the program.</li>
          <li class="str">Improvement areas, with a model of a stronger response.</li>
          <li class="str">Progress across 30 days, with your streak and test history.</li></ul></div>
      </section>
      <p class="muted" style="font-size:13px;margin:0">SSB Psych Lab is an independent practice tool. It is not affiliated with the Services Selection Board, and its reviews are practice feedback, not an official assessment. Interview practice is coming soon.</p>`;
  }
  // Clicking any [data-gate] control on a guest page opens the login/register page (or back to home)
  function gate(mode) { S.page = "auth"; S.authMode = mode; S.notice = S.notice || ""; history.replaceState(null, "", "#" + mode); render(); window.scrollTo(0, 0); }

  /* ---------- login, register, forgot password, new password ---------- */
  function viewAuth() {
    const m = S.authMode, reg = m === "register";
    const notice = S.notice ? `<div class="banner" role="status">${esc(S.notice)}</div>` : ""; S.notice = "";
    const head = (eyebrow, title, sub) => `<div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p class="muted" style="margin:6px 0 0">${sub}</p></div>`;
    const home = `<button type="button" class="linkbtn" data-gate="landing" style="font-size:14px">← Back to home</button>`;
    if (m === "forgot") return `<div class="auth">${head("Account", "Reset your password", "Enter the email you registered with. We'll send a link to choose a new password.")}${notice}
      <form class="card" id="authForm" novalidate>
        <div class="field"><label for="aEmail">Email</label><input id="aEmail" type="email" required autocomplete="email"></div>
        <div class="err" id="aErr" role="alert"></div>
        <div class="banner" id="aOk" role="status" hidden></div>
        <button class="btn" type="submit">Send reset link</button>
        <div class="muted" style="font-size:14px"><button type="button" class="linkbtn" id="aBackLogin">Back to log in</button></div>
      </form>${home}</div>`;
    if (m === "recovery") return `<div class="auth">${head("Account", "Choose a new password", "Set a new password for your account. The reset link works once.")}
      <form class="card" id="authForm" novalidate>
        <div class="field"><label for="aPw">New password</label><input id="aPw" type="password" required minlength="6" autocomplete="new-password"></div>
        <div class="field"><label for="aPw2">Confirm new password</label><input id="aPw2" type="password" required minlength="6" autocomplete="new-password"></div>
        <div class="err" id="aErr" role="alert"></div>
        <button class="btn" type="submit">Save password and log in</button>
      </form>${home}</div>`;
    return `<div class="auth">
      ${head("SSB psychology practice", reg ? "Report at the board" : "Welcome back", reg ? "Register to start your 30-day program. A chest number is allotted to you automatically." : "Log in with your email and password to continue your program.")}
      ${notice}
      <form class="card" id="authForm" novalidate>
        ${reg ? `<div class="field"><label for="aName">Full name</label><input id="aName" required maxlength="40" autocomplete="name"></div>` : ""}
        <div class="field"><label for="aEmail">Email</label><input id="aEmail" type="email" required autocomplete="email"></div>
        <div class="field"><label for="aPw">Password</label><input id="aPw" type="password" required minlength="6" autocomplete="${reg ? "new-password" : "current-password"}"></div>
        ${reg ? "" : `<div style="text-align:right;margin-top:-6px"><button type="button" class="linkbtn" id="aForgot" style="font-size:14px">Forgot password?</button></div>`}
        ${reg ? `<div class="field"><label for="aEntry">Entry</label><select id="aEntry">${["NDA", "CDS", "AFCAT", "TES", "TGC", "SSC Tech", "NCC Special", "ACC", "Other"].map((e) => `<option>${e}</option>`).join("")}</select></div>` : ""}
        <div class="err" id="aErr" role="alert"></div>
        <button class="btn" type="submit">${reg ? "Register and get chest number" : "Log in"}</button>
        <div class="muted" style="font-size:14px">${reg ? "Already registered?" : "New candidate?"} <button type="button" class="linkbtn" id="aSwitch">${reg ? "Log in" : "Register"}</button></div>
      </form>
      <p class="muted" style="font-size:12px;margin:0">${Store.kind === "supabase" ? "Your progress is saved to your account and available on any device." : "Offline mode: accounts and progress are stored only in this browser on this computer."}</p>
      ${home}
    </div>`;
  }
  function bindAuth() {
    const form = $("#authForm");
    if ($("#aSwitch")) $("#aSwitch").onclick = () => { S.authMode = S.authMode === "login" ? "register" : "login"; render(); };
    if ($("#aForgot")) $("#aForgot").onclick = () => gate("forgot");
    if ($("#aBackLogin")) $("#aBackLogin").onclick = () => gate("login");

    async function submitAuth() {
      const err = $("#aErr"), email = $("#aEmail").value.trim(), pw = $("#aPw").value;
      if (!/^\S+@\S+\.\S+$/.test(email)) return (err.textContent = "Enter a valid email address.");
      if (pw.length < 6) return (err.textContent = "Password must be at least 6 characters.");
      try {
        if (S.authMode === "register") {
          const name = $("#aName").value.trim(); if (!name) return (err.textContent = "Enter your name.");
          const res = await Store.register({ name, email, entry: $("#aEntry").value, password: pw });
          if (res && res.needsConfirm) { S.authMode = "login"; render(); modal(`<div class="eyebrow">Almost there</div><h2 style="font-size:26px">Confirm your email</h2><p style="margin:0">We sent a link to <b>${esc(email)}</b>. Open it to activate your account, then log in here. Your chest number is allotted on confirmation.</p><div class="row" style="justify-content:flex-end"><button class="btn" id="cOk">OK</button></div>`); $("#cOk").onclick = closeModal; return; }
          S.user = res; await loadUser(); markActive(true); showChest(); setView("today");
        } else { S.user = await Store.login(email, pw); await loadUser(); markActive(true); setView("today"); maybePayPopup(); }
      } catch (ex) { err.textContent = ex.message || "Something went wrong. Try again."; }
    }
    async function submitForgot() {
      const email = $("#aEmail").value.trim(), ok = $("#aOk"), btn = form.querySelector("button[type=submit]");
      if (!/^\S+@\S+\.\S+$/.test(email)) return ($("#aErr").textContent = "Enter a valid email address.");
      try {
        await Store.requestReset(email);
        ok.hidden = false; ok.textContent = `If an account exists for ${email}, a reset link is on its way. Check your spam folder too.`;
        btn.disabled = true; setTimeout(() => (btn.disabled = false), 60000);   // one link per minute
      } catch (ex) { $("#aErr").textContent = ex.message || "Couldn't send the reset link. Try again."; }
    }
    async function submitRecovery() {
      const pw = $("#aPw").value, pw2 = $("#aPw2").value;
      if (pw.length < 6) return ($("#aErr").textContent = "Password must be at least 6 characters.");
      if (pw !== pw2) return ($("#aErr").textContent = "The two passwords don't match.");
      try {
        S.user = await Store.completeRecovery(pw); await loadUser(); markActive(true); setView("today");
        modal(`<div class="eyebrow">Done</div><h2 style="font-size:26px">Password updated</h2><p style="margin:0">You're logged in with your new password.</p><div class="row" style="justify-content:flex-end"><button class="btn" id="cOk">OK</button></div>`); $("#cOk").onclick = closeModal;
      } catch (ex) { $("#aErr").textContent = ex.message || "This reset link has expired. Request a new one."; }
    }
    const handler = S.authMode === "forgot" ? submitForgot : S.authMode === "recovery" ? submitRecovery : submitAuth;
    form.addEventListener("submit", (e) => { e.preventDefault(); $("#aErr").textContent = ""; handler(); });
  }

  // Visitors: any [data-gate] control opens the login/register page. Attached once for the whole page.
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("[data-gate]");
    if (!b || S.user) return;
    if (b.dataset.gate === "landing") { S.page = "landing"; history.replaceState(null, "", location.pathname); render(); window.scrollTo(0, 0); }
    else gate(b.dataset.gate);
  });
  function showChest() {
    const m = modal(`<div class="eyebrow">Registration complete</div><div>Your chest number is</div><div class="chestbig">${S.user.chest}</div>
      <p class="muted" style="margin:0">Use it like you would at the board. Day 1 of your 30-day program starts today.</p><div class="row" style="justify-content:flex-end"><button class="btn" id="cOk">Start</button></div>`);
    $("#cOk", m).onclick = () => { closeModal(); maybePayPopup(); };
  }
  async function loadUser() {
    S.sessions = await Store.sessions(S.user.id); S.overall = await Store.overall(S.user.id);
    try { S.fbCount = await Store.feedbackCount(S.user.id); } catch (e) { S.fbCount = 0; }
    S.battery = loadBattery(); S.ai = { reviews: [], status: null, pending: {}, err: {} }; loadAI();
    await loadPass();
    S.isAdmin = false; if (Store.kind === "supabase") Store.rpc("is_admin").then((v) => { S.isAdmin = v === true; const b = $("#hqBtn"); if (b) b.hidden = !S.isAdmin; }).catch(() => {});
  }

  /* ---------- today ---------- */
  function viewToday() {
    const d = today(), n = dayNum(d), set = setNum(n), todays = S.sessions.filter((s) => s.date === d);
    const doneDates = {}; S.sessions.forEach((s) => (doneDates[s.date] = doneDates[s.date] || new Set()).add(s.test));
    let strip = "";
    for (let i = 1; i <= PROGRAM_DAYS; i++) {
      const ds = localDate(new Date(parseLocal(S.user.startDate).getTime() + (i - 1) * 86400000));
      const st = doneDates[ds]; const cls = i > n ? "future" : st ? (st.size >= 2 ? "done" : "part") : "";
      strip += `<span class="${cls} ${i === n ? "today" : ""}" title="Day ${i} · ${fmtDate(ds)}${st ? " · " + [...st].map((t) => TESTS[t].code).join(", ") : ""}"></span>`;
    }
    const last = new Map(); S.sessions.forEach((s) => last.set(s.test, s.date));
    let suggest = null, gap = -1;
    for (const t of Object.keys(TESTS)) { const ld = last.get(t); const g = ld ? daysBetween(ld, d) : 999; if (g > gap) { gap = g; suggest = t; } }
    const cards = Object.entries(TESTS).map(([k, t]) => {
      const cnt = S.choice[k] || t.def; const done = todays.filter((s) => s.test === k);
      const ls = done.length && done[done.length - 1].assessment ? done[done.length - 1].assessment.overall : null;
      const lock = passLocked(n);
      return `<div class="card test${lock ? " locked" : ""}">
        ${done.length ? `<span class="pill ${scoreClass(ls)} done-flag">✓ Done${ls != null ? " · " + r1(ls) : ""}</span>` : ""}
        <div><div class="code">${t.code}</div><div class="tname">${t.name}</div></div>
        ${t.options.length > 1 ? `<div class="seg" role="group" aria-label="${t.code} length">${t.options.map((o) => `<button data-count="${k}:${o}" aria-pressed="${o === cnt}">${o === 12 && k === "tat" ? "11+1" : o}</button>`).join("")}</div>` : ""}
        <div class="spec">${t.spec(cnt)} · ~${t.minutes(cnt)} min · Set ${pad(set)}</div>
        ${suggest === k && !done.length ? `<div class="suggest">${gap >= 999 ? "Not attempted yet" : `Not taken for ${gap} days`}</div>` : ""}
        ${lock ? `<button class="btn" data-pay="locked" style="margin-top:auto">${ICON.lock} Unlock with full pass</button>` : `<button class="btn" data-start="${k}" style="margin-top:auto">${done.length ? "Take again" : "Start " + t.code}</button>`}
      </div>`;
    }).join("");
    const a = assessed(), lastA = a[a.length - 1];
    return `
    <section class="card"><div class="dayhead">
      <div class="daynum num">${pad(Math.min(n, 99))}<small>DAY</small></div>
      <div><div class="eyebrow">${new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</div>
        <h1 style="font-size:30px;margin-top:4px">${esc(S.user.name)}</h1>
        <div class="muted" style="font-size:14px">${n > PROGRAM_DAYS ? `Program complete · now repeating set ${set}` : `Day ${n} of ${PROGRAM_DAYS}`} · ${esc(S.user.entry)} entry · ${todays.length ? `${todays.length} test${todays.length > 1 ? "s" : ""} today` : "No test taken today yet"} · ${streak()} day streak${S.pass && S.pass.status === "paid" ? ` · <span class="pill good" style="font-size:12px">Full pass</span>` : ""}</div>
        <div class="strip" aria-label="30 day program">${strip}</div></div></div></section>
    ${passCard(n)}
    ${batteryCard()}
    <section><div class="section-h" style="margin-bottom:12px"><h2>Single tests</h2><span class="muted" style="font-size:14px">Day ${n} uses set ${pad(set)} of 30. Timings follow the SSB format.</span></div>
      <div class="tests">${cards}</div></section>
    <section class="card"><div class="section-h" style="margin-bottom:14px"><h2>OLQ profile</h2>${lastA ? `<button class="btn ghost" data-report="${lastA.id}">Last report: ${TESTS[lastA.test].code} · ${r1(lastA.assessment.overall)}</button>` : ""}</div>
      ${a.length ? olqBlock(olqAverages(a)) : `<p class="muted" style="margin:0 0 16px">Your Officer Like Qualities profile appears here after your first test. The brass mark on each bar is 7.0, the level a recommended candidate usually shows.</p>` + olqBlock(null)}</section>`;
  }
  function streak() { const st = new Set(S.sessions.map((s) => s.date)); let n = 0, dt = new Date(); if (!st.has(localDate(dt))) dt = new Date(dt.getTime() - 86400000); while (st.has(localDate(dt))) { n++; dt = new Date(dt.getTime() - 86400000); } return n; }
  function olqAverages(list) { const o = {}; OLQS.forEach((q) => { const v = list.map((s) => Number(s.assessment.olq[q])).filter((x) => x > 0); o[q] = v.length ? avg(v) : null; }); return o; }
  function olqBlock(vals) {
    const low = vals ? OLQS.filter((o) => vals[o] != null).sort((a, b) => vals[a] - vals[b]).slice(0, 3) : [];
    return `<div class="factors">${FACTORS.map((f) => {
      const fv = vals ? avg(f.olqs.map((o) => vals[o]).filter((x) => x != null)) : null;
      return `<div class="factor"><h3>Factor ${f.id} · ${f.name} ${fv != null ? `<span class="num" style="color:var(--ink)">${r1(fv)}</span>` : ""}</h3>
      ${f.olqs.map((o) => { const v = vals ? vals[o] : null; const foc = low.includes(o);
        return `<div class="olq ${foc ? "focus" : ""}" title="${o}: ${v == null ? "no data" : r1(v) + " / 10"}"><span class="name">${o}${foc ? ' <span class="pill warn" style="font-size:10px;padding:0 6px">Focus</span>' : ""}</span><span class="bar"><b style="width:${v == null ? 0 : v * 10}%"></b><em></em></span><span class="val">${r1(v)}</span></div>`; }).join("")}</div>`;
    }).join("")}</div>`;
  }

  /* ---------- report ---------- */
  function viewReport() {
    const s = S.sessions.find((x) => x.id === S.reportId);
    if (!s) return `<div class="card"><p>That report isn't in your file.</p><button class="btn" data-goto="progress">Go to Progress</button></div>`;
    const t = TESTS[s.test], items = itemsFor(s.test, s.set, s.count);
    const A = assess({ test: s.test, items, responses: s.responses }, { tatBank: window.TAT_BANK }); // full detail, deterministic
    const psy = !!(s.assessment && s.assessment.source === "psychologist"), P = psy ? s.assessment : A; // the psychologist's verdict overrides the automatic scores
    const answered = s.responses.filter((x) => (x || "").trim()).length, C = 2 * Math.PI * 52, ov = P.overall;
    return `<div class="row" style="justify-content:space-between"><button class="btn quiet" data-goto="progress">← All reports</button><span class="eyebrow">Day ${s.day} · Set ${pad(s.set)} · ${fmtDate(s.date)} · ${t.code}</span></div>
    <section class="card report-head">
      <div class="ring"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" fill="none" stroke="var(--line)" stroke-width="10"/><circle cx="60" cy="60" r="52" fill="none" stroke="var(--olive)" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(C * ov) / 10} ${C}"/></svg><div class="score num">${r1(ov)}<small>/ 10</small></div></div>
      <div style="display:flex;flex-direction:column;gap:8px"><div class="eyebrow" ${psy ? 'style="color:var(--brass)"' : ""}>${psy ? `${ICON.pen} Psychologist's assessment` : "Scored report"}</div><h1 style="font-size:30px">${t.name}</h1>
        <div class="row" style="gap:8px">${P.grade ? `<span class="pill ${scoreClass(ov)}">${esc(P.grade)}</span>` : ""}${psy ? `<span class="pill" style="color:var(--brass)">Reviewed by your psychologist</span>` : ""}</div><p style="margin:0;max-width:65ch">${esc(P.summary || "")}</p></div>
    </section>
    <div class="kpis">
      <div class="kpi"><b>${answered}/${items.length}</b><span>Responses completed</span></div>
      <div class="kpi"><b>${Math.round((answered / items.length) * 100)}%</b><span>Completion rate</span></div>
      <div class="kpi"><b>${Math.round(avg(s.responses.filter((x) => (x || "").trim()).map(words)) || 0)}</b><span>Avg words per response</span></div>
      <div class="kpi"><b>${fmtClock(s.timeUsed || 0)}</b><span>Time used</span></div>
    </div>
    ${psychSection(s)}
    <section class="two">
      <div class="card"><h2 style="font-size:22px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px">Improvement areas</h2>
        <ul class="list">${(P.improvements || []).map((i) => `<li class="imp"><b>${esc(i.olq)}</b><span>${esc(i.issue)}</span>${i.action ? `<div style="color:var(--olive);font-size:14px;margin-top:4px">${psy ? "Practise" : "Do this"}: ${esc(i.action)}</div>` : ""}</li>`).join("") || `<li class="muted">—</li>`}</ul></div>
      <div class="card"><h2 style="font-size:22px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px">What worked</h2>
        <ul class="list">${(P.strengths || []).map((x) => `<li class="str">${esc(x)}</li>`).join("") || `<li class="muted">—</li>`}</ul>${!psy && A.pattern ? `<p class="muted" style="font-size:14px;margin:14px 0 0">${esc(A.pattern)}</p>` : ""}</div>
    </section>
    <section class="card"><div class="section-h" style="margin-bottom:14px"><h2>OLQs in this test</h2><span class="muted" style="font-size:13px">${psy ? "Psychologist's rating · " : ""}Brass mark = 7.0</span></div>${olqBlock(P.olq)}</section>
    ${psy ? psychNotes(s) : ""}
    ${responsesBlock(s, items, A, psy)}`;
  }
  function responsesBlock(s, items, A, psy) {
    const tags = [...new Set(A.items.map((i) => i.tag))]; const f = S.filter;
    const rows = items.map((it, i) => {
      const fb = A.items[i]; if (f !== "all" && fb.tag !== f) return "";
      const ans = (s.responses[i] || "").trim();
      let prompt = s.test === "tat" ? (it.blank ? "Blank slide (own picture)" : `Picture ${i + 1}`) : s.test === "wat" ? esc(it.w).toUpperCase() : esc(it.t);
      const pic = s.test === "tat" && !it.blank ? tatPic(it.id) : null;
      const cls = /Positive|Good/.test(fb.tag) ? "good" : /Neutral|Average/.test(fb.tag) ? "warn" : "bad";
      return `<div class="resp"><div class="idx num">${pad(i + 1)}</div><div>
        <div class="row" style="gap:8px;justify-content:space-between"><span class="prompt">${prompt}</span><span class="pill ${cls}">${esc(fb.tag)}${psy ? "" : " · " + r1(fb.score)}</span></div>
        ${pic ? `<img class="thumb" src="${pic.file}" alt="${esc(pic.desc)}">` : ""}
        <div class="ans ${ans ? "" : "empty"}">${ans ? esc(ans) : "No response"}</div>
        ${fb.note ? `<div class="note">${esc(fb.note)}</div>` : ""}
        ${fb.better ? `<div class="better">${s.test === "wat" ? "Model response" : s.test === "srt" ? "Ideal approach" : "Tip"}: ${esc(fb.better)}</div>` : ""}
      </div></div>`;
    }).join("");
    return `<section class="card"><div class="section-h" style="margin-bottom:8px"><h2>Your responses</h2>
      <div class="filters" role="group" aria-label="Filter responses"><button class="chipbtn" data-filter="all" aria-pressed="${f === "all"}">All</button>${tags.map((t) => `<button class="chipbtn" data-filter="${esc(t)}" aria-pressed="${f === t}">${esc(t)} (${A.items.filter((i) => i.tag === t).length})</button>`).join("")}</div></div>
      ${rows || `<p class="muted">No responses match this filter.</p>`}</section>`;
  }

  /* ---------- progress ---------- */
  function viewProgress() {
    const a = assessed(), n = dayNum();
    const daysActive = new Set(S.sessions.map((s) => s.date)).size;
    const allResp = S.sessions.reduce((t, s) => t + s.count, 0), done = S.sessions.reduce((t, s) => t + s.responses.filter((x) => (x || "").trim()).length, 0);
    const avgOverall = avg(a.map((s) => s.assessment.overall));
    const delta = a.length >= 4 ? avg(a.slice(-3).map((s) => s.assessment.overall)) - avg(a.slice(0, 3).map((s) => s.assessment.overall)) : null;
    const perTest = Object.entries(TESTS).map(([k, t]) => {
      const l = a.filter((s) => s.test === k);
      const comp = l.length ? avg(l.map((s) => s.responses.filter((x) => (x || "").trim()).length / s.count)) : null;
      return `<tr><td><b>${t.code}</b> <span class="muted">${t.name}</span></td><td>${l.length}</td><td>${r1(avg(l.map((s) => s.assessment.overall)))}</td><td>${l.length ? r1(Math.max(...l.map((s) => s.assessment.overall))) : "—"}</td><td>${comp == null ? "—" : Math.round(comp * 100) + "%"}</td></tr>`;
    }).join("");
    const impCount = {}; a.forEach((s) => s.assessment.improvements.forEach((i) => (impCount[i.olq] = (impCount[i.olq] || 0) + 1)));
    const impTop = Object.entries(impCount).sort((x, y) => y[1] - x[1]).slice(0, 6);
    const cal = []; for (let i = 1; i <= PROGRAM_DAYS; i++) { const ds = localDate(new Date(parseLocal(S.user.startDate).getTime() + (i - 1) * 86400000)); const l = S.sessions.filter((s) => s.date === ds);
      cal.push(`<div class="${l.length ? "on" : ""} ${i === n ? "now" : ""}"><b>D${pad(i)} · ${fmtDate(ds)}</b><div class="tags">${l.map((s) => `<i>${TESTS[s.test].code}</i>`).join("")}</div></div>`); }
    const hist = S.sessions.slice().reverse().map((s) => `<tr class="click" data-report="${s.id}"><td>D${pad(s.day)}</td><td>${fmtDate(s.date)}</td><td><b>${TESTS[s.test].code}</b></td><td>${s.count}</td><td><span class="pill ${scoreClass(s.assessment.overall)}">${r1(s.assessment.overall)}</span></td></tr>`).join("");
    return `<div class="section-h"><h2>Progress</h2><span class="muted" style="font-size:14px">Started ${fmtDate(S.user.startDate)} · Day ${n}</span></div>
    <div class="kpis">
      <div class="kpi"><b>${S.sessions.length}</b><span>Tests taken</span></div>
      <div class="kpi"><b>${daysActive}<span style="font-size:16px;color:var(--muted)"> / ${Math.min(Math.max(n, 1), PROGRAM_DAYS)}</span></b><span>Days active</span></div>
      <div class="kpi"><b>${r1(avgOverall)}</b><span>Average OLQ score</span></div>
      <div class="kpi"><b>${allResp ? Math.round((done / allResp) * 100) : 0}%</b><span>Responses completed</span></div>
      <div class="kpi"><b style="color:${delta == null ? "inherit" : delta >= 0 ? "var(--good)" : "var(--bad)"}">${delta == null ? "—" : (delta >= 0 ? "+" : "") + r1(delta)}</b><span>Change: first 3 vs last 3 tests</span></div>
    </div>
    ${reviewsList()}
    <section class="card"><div class="section-h" style="margin-bottom:6px"><h2 style="font-size:22px">Overall score by test</h2><span class="muted" style="font-size:13px">Dashed line = 7.0 recommendable</span></div>
      ${a.length ? `<div class="chart" id="trend"></div>` : `<p class="muted">Take a test to start your trend line.</p>`}</section>
    <section class="card"><div class="section-h" style="margin-bottom:14px"><h2 style="font-size:22px">Average OLQ profile</h2><span class="muted" style="font-size:13px">${a.length} test${a.length === 1 ? "" : "s"} · weakest three marked Focus</span></div>${olqBlock(a.length ? olqAverages(a) : null)}</section>
    <section class="two">
      <div class="card"><h2 style="font-size:22px;margin-bottom:10px">Recurring improvement areas</h2>${impTop.length ? `<ul class="list">${impTop.map(([k, v]) => `<li class="row" style="justify-content:space-between;border-bottom:1px solid var(--line);padding-bottom:8px"><span>${esc(k)}</span><span class="pill warn">${v} test${v > 1 ? "s" : ""}</span></li>`).join("")}</ul>` : `<p class="muted">Appears after your first test.</p>`}</div>
      <div class="card"><h2 style="font-size:22px;margin-bottom:10px">By test</h2><div class="tablewrap"><table class="t"><thead><tr><th>Test</th><th>Taken</th><th>Avg</th><th>Best</th><th>Done</th></tr></thead><tbody>${perTest}</tbody></table></div></div>
    </section>
    <section class="card" style="display:flex;flex-direction:column;gap:12px"><div class="section-h"><h2 style="font-size:22px">Candidate assessment so far</h2><button class="btn" id="overallBtn" ${a.length < 2 ? "disabled" : ""}>${S.overall ? "Update assessment" : "Generate assessment"}</button></div>
      ${a.length < 2 ? `<p class="muted" style="margin:0">Needs at least two tests. Reads all your reports together and gives one overall view with a 7-day plan.</p>` : ""}
      <div id="overallOut">${S.overall ? overallHTML(S.overall) : ""}</div></section>
    <section class="card"><h2 style="font-size:22px;margin-bottom:12px">30-day log</h2><div class="cal">${cal.join("")}</div></section>
    <section class="card"><h2 style="font-size:22px;margin-bottom:8px">All reports</h2>${hist ? `<div class="tablewrap"><table class="t"><thead><tr><th>Day</th><th>Date</th><th>Test</th><th>Items</th><th>Score</th></tr></thead><tbody>${hist}</tbody></table></div>` : `<p class="muted">No tests yet.</p>`}</section>`;
  }
  function buildOverall() {
    const a = assessed(); const av = olqAverages(a);
    const readiness = Math.round(avg(Object.values(av).filter((x) => x != null)) * 10) / 10;
    const sorted = OLQS.filter((o) => av[o] != null).sort((x, y) => av[x] - av[y]);
    const half = Math.floor(a.length / 2);
    const trend = a.length >= 4 ? avg(a.slice(half).map((s) => s.assessment.overall)) - avg(a.slice(0, half).map((s) => s.assessment.overall)) : 0;
    const byTest = {}; Object.keys(TESTS).forEach((k) => { const l = a.filter((s) => s.test === k); byTest[k] = l.length ? avg(l.map((s) => s.assessment.overall)) : null; });
    const taken = Object.keys(byTest).filter((k) => byTest[k] != null);
    const weakTest = taken.sort((x, y) => byTest[x] - byTest[y])[0];
    const untested = Object.keys(TESTS).filter((k) => byTest[k] == null);
    const spread = (() => { const v = taken.map((k) => byTest[k]); return v.length > 1 ? Math.max(...v) - Math.min(...v) : 0; })();
    const summary = [
      `Across ${a.length} tests your average OLQ level is ${r1(readiness)} out of 10${readiness >= 7 ? ", around the level the board recommends" : readiness >= 5.5 ? ", an average candidate's level" : ", below the average candidate"}.`,
      a.length >= 4 ? (trend > 0.3 ? `You are improving: your recent tests average ${r1(trend)} higher than your early ones.` : trend < -0.3 ? `Your recent scores have dropped by ${r1(-trend)}; check whether fatigue or rushing is the cause.` : "Your scores are steady; push the weakest OLQs to move up.") : "Take a few more tests for a reliable trend.",
      spread > 1.5 ? `Your picture is inconsistent across tests (${TESTS[weakTest].code} is clearly weaker), which psychologists notice.` : "Your personality picture is fairly consistent across tests, which is good.",
      untested.length ? `You have not yet taken ${untested.map((k) => TESTS[k].code).join(", ")}.` : "",
    ].filter(Boolean).join(" ");
    const DRILLS = {
      "Speed of Decision": ["20 WAT words at 15 s each, no blanks", "20 SRTs in 10 minutes", "Write the first sensible action, then refine"],
      "Initiative": ["Start every SRT with a verb", "Write 5 TAT endings where the hero acts first", "Volunteer for one new task at home or college"],
      "Self Confidence": ["Rewrite 10 negative WAT words positively", "Record a 2-minute self-introduction daily", "Remove 'fear, cannot, worry' from answers"],
      "Sense of Responsibility": ["For each SRT, add who you inform and how you follow up", "Take charge of one household task this week"],
      "Cooperation": ["Add the people who help the hero in every TAT", "Join a group activity or sport"],
      "Social Adaptability": ["Talk to one new person daily", "Write SRTs set in unfamiliar places"],
      "Organising Ability": ["Use first/then/finally in SRTs", "Plan your next day in writing each night"],
      "Reasoning Ability": ["Underline every part of an SRT before answering", "Explain a news story's cause and effect in 3 lines"],
      "Effective Intelligence": ["Solve one practical problem around you daily", "Do 10 minutes of reasoning puzzles"],
      "Power of Expression": ["Read an editorial aloud daily", "Keep WAT responses 4-8 words"],
      "Ability to Influence the Group": ["In TAT, show the hero convincing others", "Lead one discussion with friends this week"],
      "Liveliness": ["Write 10 WAT words with cheerful, hopeful lines", "Play a team sport this week"],
      "Determination": ["Write TAT stories where the hero recovers from a setback", "Pick one habit and keep it 7 days straight"],
      "Courage": ["Answer danger SRTs with a calculated risk to help", "Try one physical challenge (swim, climb, run 5 km)"],
      "Stamina": ["Take full 60-item sets, not short ones", "Run 2.4 km three times this week"],
    };
    const focus = sorted.slice(0, 3).map((o) => ({ olq: o, why: `Averages ${r1(av[o])} across your tests. ${OLQ_TIPS[o]}`, drills: DRILLS[o] || [] }));
    const order = [weakTest, ...untested, "wat", "srt", "tat", "sd"].filter((x, i, arr) => x && arr.indexOf(x) === i);
    const plan = Array.from({ length: 7 }, (_, i) => { const t1 = order[i % order.length], t2 = order[(i + 1) % order.length]; const fo = focus[i % focus.length];
      return `${TESTS[t1].code} full set + ${TESTS[t2].code}; focus on ${fo ? fo.olq : "consistency"}${fo && fo.drills[0] ? ` (${fo.drills[0].toLowerCase()})` : ""}.`; });
    return { readiness, summary, focus, plan, at: Date.now(), basedOn: a.length };
  }
  function overallHTML(O) {
    return `<div style="display:flex;flex-direction:column;gap:14px">
      <div class="row"><span class="pill ${scoreClass(O.readiness)}">Readiness ${r1(O.readiness)} / 10</span><span class="muted" style="font-size:13px">Updated ${new Date(O.at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · from ${O.basedOn} tests</span></div>
      <p style="margin:0;max-width:70ch">${esc(O.summary)}</p>
      <div class="two"><div><div class="eyebrow" style="margin-bottom:8px">Focus OLQs</div><ul class="list">${O.focus.map((f) => `<li class="imp"><b>${esc(f.olq)}</b><span>${esc(f.why)}</span>${f.drills.length ? `<ul style="margin:6px 0 0;padding-left:18px;font-size:14px">${f.drills.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>` : ""}</li>`).join("")}</ul></div>
      <div><div class="eyebrow" style="margin-bottom:8px">Next 7 days</div><ol style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:6px">${O.plan.map((p) => `<li>${esc(p)}</li>`).join("")}</ol></div></div></div>`;
  }
  function drawTrend() {
    const el = $("#trend"); if (!el) return;
    const a = assessed(); const W = Math.max(320, el.clientWidth), H = 220, L = 30, R = 12, T = 12, B = 28;
    const xs = (i) => (a.length === 1 ? L + (W - L - R) / 2 : L + (i * (W - L - R)) / (a.length - 1)), ys = (v) => T + ((10 - v) * (H - T - B)) / 10;
    let g = ""; [0, 2, 4, 6, 8, 10].forEach((v) => { g += `<line x1="${L}" x2="${W - R}" y1="${ys(v)}" y2="${ys(v)}"/><text x="${L - 6}" y="${ys(v) + 4}" text-anchor="end">${v}</text>`; });
    const pts = a.map((s, i) => [xs(i), ys(s.assessment.overall)]);
    const path = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
    const area = pts.length > 1 ? `<path class="area" d="${path} L${pts[pts.length - 1][0]} ${ys(0)} L${pts[0][0]} ${ys(0)} Z"/>` : "";
    const step = Math.ceil(a.length / 8), last = pts[pts.length - 1];
    const xl = a.map((s, i) => (i % step === 0 || i === a.length - 1 ? `<text x="${xs(i)}" y="${H - 8}" text-anchor="middle">D${s.day}</text>` : "")).join("");
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Overall score per test"><g class="grid">${g}</g><line class="ref" x1="${L}" x2="${W - R}" y1="${ys(7)}" y2="${ys(7)}"/>${area}<path class="ln" d="${path}"/>${pts.map((p, i) => `<circle class="dot" cx="${p[0]}" cy="${p[1]}" r="${i === pts.length - 1 ? 6 : 4.5}"/>`).join("")}<text x="${last[0]}" y="${last[1] - 12}" text-anchor="middle" style="fill:var(--ink);font-weight:700">${r1(a[a.length - 1].assessment.overall)}</text>${xl}${pts.map((p, i) => `<rect data-i="${i}" x="${p[0] - 14}" y="${T}" width="28" height="${H - T - B}" fill="transparent" style="cursor:pointer"/>`).join("")}</svg><div class="tip"></div>`;
    const tip = el.querySelector(".tip");
    el.querySelectorAll("rect[data-i]").forEach((rc) => { const i = +rc.dataset.i, s = a[i];
      rc.addEventListener("mouseenter", () => { tip.innerHTML = `Day ${s.day} · ${TESTS[s.test].code} · <b>${r1(s.assessment.overall)}</b>`; tip.style.left = (pts[i][0] / W) * 100 + "%"; tip.style.top = (pts[i][1] / H) * el.clientHeight + "px"; tip.classList.add("on"); });
      rc.addEventListener("mouseleave", () => tip.classList.remove("on")); rc.addEventListener("click", () => setView("report", s.id)); });
  }
  function viewInterview() {
    const feats = [
      ["PIQ-based personal interview", "Fill your Personal Information Questionnaire once. The interviewing officer builds questions from your family, education, hobbies, sports and achievements, just as at the board."],
      ["Rapid-fire comprehensive questions", "A burst of 8-10 linked questions in one go. Answer them in order; the app checks what you recalled and what you missed."],
      ["Current affairs and defence knowledge", "Questions on recent national and international events, the armed forces, and your state and district."],
      ["Situation and stress questions", "Why the Army, past failures, your weaknesses, what you'd do if not selected: the questions candidates find hardest."],
      ["Spoken answers", "Answer aloud like a real interview. Your answers are transcribed and timed."],
      ["Interview OLQ report", "Scores on all 15 OLQs from your answers, consistency with your psych tests, and what to improve before your next attempt."],
    ];
    return `<section class="card" style="display:flex;flex-direction:column;gap:16px;max-width:820px">
      <div class="row" style="justify-content:space-between"><div class="eyebrow">Interviewing Officer</div><span class="pill warn">Coming soon</span></div>
      <h1 style="font-size:36px">Personal interview practice</h1>
      <p style="margin:0;max-width:65ch">The interview is the second half of your assessment at the board. This section is being built now and will open here once it's ready. Your psychology test results will carry over, so the interviewing officer can probe the same qualities from a different angle.</p>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr))">${feats.map(([t, d]) => `<div style="border-left:3px solid var(--olive);padding:4px 0 4px 12px"><b>${t}</b><div class="muted" style="font-size:14px;margin-top:4px">${d}</div></div>`).join("")}</div>
      <div class="banner" style="margin:0">Until then, keep up your daily TAT, WAT, SRT and SD. A consistent picture across psych tests and interview is what the board looks for.</div>
      <div><button class="btn" data-goto="today">Back to today's tests</button></div></section>`;
  }

  /* ---------- bindings ---------- */
  function bind() {
    const m = $("#main");
    m.querySelectorAll("[data-count]").forEach((b) => b.addEventListener("click", () => { const [k, v] = b.dataset.count.split(":"); S.choice[k] = +v; render(); }));
    m.querySelectorAll("[data-start]").forEach((b) => b.addEventListener("click", () => startTest(b.dataset.start, S.choice[b.dataset.start] || TESTS[b.dataset.start].def)));
    m.querySelectorAll("[data-report]").forEach((b) => b.addEventListener("click", () => { S.filter = "all"; setView("report", b.dataset.report); }));
    m.querySelectorAll("[data-goto]").forEach((b) => b.addEventListener("click", () => setView(b.dataset.goto)));
    m.querySelectorAll("[data-psy]").forEach((b) => b.addEventListener("click", () => requestSingle(b.dataset.psy)));
    m.querySelectorAll("[data-psyb]").forEach((b) => b.addEventListener("click", () => requestBattery(b.dataset.psyb)));
    m.querySelectorAll("[data-battery]").forEach((b) => b.addEventListener("click", () => setView("battery", b.dataset.battery)));
    m.querySelectorAll("[data-pay]").forEach((b) => b.addEventListener("click", () => openPay(b.dataset.pay)));
    m.querySelectorAll("[data-paycheck]").forEach((b) => b.addEventListener("click", () => checkPass(b)));
    m.querySelectorAll("[data-bstart]").forEach((b) => b.addEventListener("click", () => startBattery()));
    m.querySelectorAll("[data-bresume]").forEach((b) => b.addEventListener("click", () => nextInBattery()));
    m.querySelectorAll("[data-bquit]").forEach((b) => b.addEventListener("click", async () => { if (await confirmBox("Stop this battery?", "Tests you've finished stay as single-test reports. You can start a new battery any time.", "Stop battery")) { saveBattery(null); render(); } }));
    m.querySelectorAll("[data-filter]").forEach((b) => b.addEventListener("click", () => { S.filter = b.dataset.filter; render(); }));
    const ob = $("#overallBtn"); if (ob) ob.addEventListener("click", async () => { S.overall = buildOverall(); render(); try { await Store.saveOverall(S.user.id, S.overall); } catch (e) { alertBanner("The overall assessment couldn't be saved; it will be rebuilt next time."); } });
    if (S.view === "progress") drawTrend();
  }
  window.addEventListener("resize", () => { if (S.view === "progress") drawTrend(); });

  /* ---------- dialogs ---------- */
  function modal(html) { const l = $("#modalLayer"); l.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><div class="card">${html}</div></div>`; return l.firstElementChild; }
  function closeModal() { $("#modalLayer").innerHTML = ""; }
  function confirmBox(title, body, okText, danger) {
    return new Promise((res) => { const m = modal(`<h2 style="font-size:24px">${title}</h2><p style="margin:0">${body}</p><div class="row" style="justify-content:flex-end"><button class="btn quiet" id="cNo">Cancel</button><button class="btn ${danger ? "danger" : ""}" id="cYes">${okText}</button></div>`);
      $("#cNo", m).onclick = () => { closeModal(); res(false); }; $("#cYes", m).onclick = () => { closeModal(); res(true); }; });
  }
  function openProfile() {
    const u = S.user;
    const m = modal(`<div class="eyebrow">Candidate profile</div><h2 style="font-size:28px">Chest No. ${u.chest}</h2>
      <form id="pf" style="display:flex;flex-direction:column;gap:12px">
        <div class="field"><label for="pfName">Name</label><input id="pfName" maxlength="40" value="${esc(u.name)}"></div>
        <div class="field"><label for="pfEntry">Entry</label><select id="pfEntry">${["NDA", "CDS", "AFCAT", "TES", "TGC", "SSC Tech", "NCC Special", "ACC", "Other"].map((e) => `<option ${e === u.entry ? "selected" : ""}>${e}</option>`).join("")}</select></div>
        <div class="muted" style="font-size:13px">Email: ${esc(u.email)} · Program started ${fmtDate(u.startDate)}. Chest numbers are allotted by the system and can't be changed.</div>
        <div class="row" style="justify-content:space-between"><button type="button" class="btn quiet" id="pfReset">Restart 30 days from today</button><div class="row"><button type="button" class="btn quiet" id="pfCancel">Cancel</button><button class="btn" type="submit">Save</button></div></div>
      </form>`);
    $("#pfCancel", m).onclick = closeModal;
    $("#pfReset", m).onclick = async () => { closeModal(); if (await confirmBox("Restart the program?", "Day 1 will start again from today. Your past reports stay in your file.", "Restart")) { S.user = await Store.updateUser(u.id, { startDate: today() }); render(); } };
    $("#pf", m).addEventListener("submit", async (e) => { e.preventDefault(); S.user = await Store.updateUser(u.id, { name: $("#pfName", m).value.trim() || u.name, entry: $("#pfEntry", m).value }); closeModal(); render(); });
  }


  /* ---------- full-program pass (₹299 by UPI, approved by hand in HQ) ---------- */
  // Day 1's test set is free; sets 2–30 need the pass. Keyed to the content set, so restarting the program
  // only replays Day 1. If the pass status can't be read (offline mode, or the server isn't set up), nothing is locked.
  async function loadPass() {
    if (Store.kind !== "supabase") { S.pass = { status: "paid" }; return; }
    try { S.pass = await Store.myPass(); } catch (e) { S.pass = null; }
    if (!S.pass || !["none", "pending", "paid", "rejected"].includes(S.pass.status)) S.pass = { status: "unknown" };
    applyOffer(S.pass);
  }
  const passOpen = () => !S.pass || ["paid", "unknown"].includes(S.pass.status);
  function passLocked(n) { return Store.kind === "supabase" && !passOpen() && setNum(n || dayNum()) > 1; }
  const isPhone = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const upiLink = () => `upi://pay?pa=${PAY.upiId}&pn=${encodeURIComponent(PAY.payee)}&am=${PAY.price}.00&cu=INR&tn=${encodeURIComponent("SSB Psych Lab pass C" + (S.user ? S.user.chest : ""))}`;
  const fmtWhen = (iso) => { try { return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }); } catch (e) { return ""; } };
  const maskUtr = (u) => (u ? "•••• " + String(u).slice(-4) : "");

  function passCard(n) {
    if (!S.pass || passOpen()) return "";
    if (S.pass.status === "pending") return `<section class="card paycard pending"><div class="row" style="justify-content:space-between"><span class="eyebrow" style="color:var(--brass)">Payment under review</span><span class="pill warn">UTR ${maskUtr(S.pass.utr)}</span></div>
      <p style="margin:0">We've got your ₹${PAY.price} payment details${S.pass.submitted ? ` (sent ${fmtWhen(S.pass.submitted)})` : ""}. Days 2–30 unlock as soon as it's confirmed, usually within a few minutes.</p>
      <div class="row"><button class="btn quiet" data-paycheck="1">Check status</button></div></section>`;
    const day1 = setNum(n) === 1;
    return `<section class="card paycard${PAY.launch ? " launch" : ""}"><div class="paycard-in"><div><div class="eyebrow" style="color:var(--olive)">${PAY.launch ? `<span class="offer-tag">Launch offer</span> ₹${PAY.price} <s class="was-s">₹${PAY.regularPrice}</s> · ${seatsTxt()}` : `Full program pass · ₹${PAY.price} once`}</div>
      <h2 style="font-size:24px;margin-top:4px">${day1 ? "Day 1 is on us." : `Day ${n} is part of the full pass.`}</h2>
      <p class="muted" style="margin:4px 0 0">${S.pass.status === "rejected" ? "We couldn't match your last payment. Check the UTR and send it again." : day1 ? `Unlock Days 2–30 with one payment of ₹${PAY.price}. No expiry, take them at your own pace.` : `One payment of ₹${PAY.price} unlocks Days 2–30. No expiry.`}</p></div>
      <button class="btn" data-pay="card">Unlock all 30 days</button></div></section>`;
  }

  function openPay(reason) {
    if (!S.user) return gate("register");
    const st = S.pass ? S.pass.status : "none";
    if (st === "pending") return payPending();
    const n = dayNum();
    const lead = reason === "locked" ? `<div class="banner" style="margin:0">Day ${n}'s tests are part of the full pass. Day 1 is free.</div>`
      : st === "rejected" ? `<div class="banner bad" style="margin:0"><b>We couldn't verify your last payment.</b>${S.pass.note ? " " + esc(S.pass.note) : ""} If you did pay, enter the correct 12-digit UTR below.</div>` : "";
    const m = modal(`<div class="pay">
      <div class="row" style="justify-content:space-between;align-items:flex-start"><span class="eyebrow" style="color:var(--olive)">SSB Psych Lab · Full program pass</span><button class="x" id="payX" aria-label="Close">×</button></div>
      <h2 class="pay-h">Unlock all 30 days</h2>
      ${PAY.launch ? `<div class="offer-row"><span class="offer-tag">Launch offer · ${offPct()}% off</span><span class="seats">${seatsTxt()}</span></div>` : ""}
      <div class="price">${PAY.launch ? `<span class="was" aria-label="Regular price ₹${PAY.regularPrice}">₹${PAY.regularPrice}</span>` : ""}<span class="num">₹${PAY.price}</span><span class="muted">one payment<br>no expiry</span></div>
      ${PAY.launch ? `<p class="muted" style="margin:-6px 0 0;font-size:13px">After the first ${PAY.seats} passes, the price goes to ₹${PAY.regularPrice}.</p>` : ""}
      ${lead}
      <ul class="list">
        <li class="str">Fresh TAT, WAT, SRT and SD sets for Days 2–30</li>
        <li class="str">Full battery with a Psychologist Review every day</li>
        <li class="str">Your OLQ profile and progress across the whole program</li>
        <li class="str">No time limit. Take the 30 sets at your own pace</li></ul>
      <div class="pstep"><div class="pnum">1</div><div class="pbody"><b>Pay ₹${PAY.price} by UPI</b>
        ${isPhone() ? `<a class="btn" id="payApp" href="${esc(upiLink())}">Pay ₹${PAY.price} with a UPI app</a><span class="muted" style="font-size:13px">Opens GPay, PhonePe, Paytm or BHIM. If it doesn't open, pay to the UPI ID below.</span>` : `<span class="muted" style="font-size:14px">Scan with any UPI app on your phone.</span>`}
        <div class="qrwrap"><img class="qr" src="assets/upi-qr-${PAY.price}.png?v=3" onerror="this.parentNode.hidden=true" alt="UPI QR code to pay ₹${PAY.price} to ${esc(PAY.upiId)}" width="168" height="168"></div>
        <div class="upiid"><span class="spec">${esc(PAY.upiId)}</span><button type="button" class="btn quiet" id="payCopy">Copy UPI ID</button></div></div></div>
      <form class="pstep" id="payForm" novalidate><div class="pnum">2</div><div class="pbody"><b>Send us the UTR</b>
        <span class="muted" style="font-size:14px">After paying, open the payment in your UPI app and copy the 12-digit <b>UPI Ref No.</b> (also called UTR).</span>
        <div class="field"><label for="payUtr" class="sr">12-digit UTR</label><input id="payUtr" inputmode="numeric" autocomplete="off" maxlength="16" placeholder="e.g. 431245678901"></div>
        <div class="err" id="payErr" role="alert"></div>
        <button class="btn" type="submit" id="paySend">Submit for verification</button></div></form>
      <p class="muted" style="font-size:13px;margin:0">We confirm your payment and unlock your pass within a few minutes. Day 1 stays open meanwhile. Questions: ssbpsychlab@gmail.com</p>
      <div class="row" style="justify-content:flex-end"><button class="btn quiet" id="payLater">Maybe later</button></div></div>`);
    m.classList.add("paymodal");
    $("#payX", m).onclick = closeModal; $("#payLater", m).onclick = closeModal;
    $("#payCopy", m).onclick = async (e) => { try { await navigator.clipboard.writeText(PAY.upiId); e.target.textContent = "Copied"; } catch (x) { e.target.textContent = PAY.upiId; } setTimeout(() => (e.target.textContent = "Copy UPI ID"), 2000); };
    $("#payUtr", m).addEventListener("input", (e) => { e.target.value = e.target.value.replace(/[^0-9]/g, "").slice(0, 12); });
    $("#payForm", m).addEventListener("submit", async (e) => {
      e.preventDefault(); const err = $("#payErr", m), btn = $("#paySend", m), utr = $("#payUtr", m).value.replace(/\D/g, "");
      err.textContent = ""; if (!/^\d{12}$/.test(utr)) return (err.textContent = "The UTR is a 12-digit number. Check the payment details in your UPI app.");
      btn.disabled = true; btn.textContent = "Sending…";
      try { S.pass = await Store.submitPayment(utr); closeModal(); render(); payPending(true); }
      catch (x) {
        const k = String(x.message || "");
        err.textContent = /utr_used/.test(k) ? "This UTR has already been submitted. If you think that's a mistake, email ssbpsychlab@gmail.com."
          : /already_pending/.test(k) ? "You already have a payment under review." : /already_paid/.test(k) ? "Your pass is already active."
          : /too_many/.test(k) ? "Too many attempts today. Try again tomorrow or email ssbpsychlab@gmail.com." : /utr_format/.test(k) ? "The UTR is a 12-digit number."
          : "Couldn't send it. Check your connection and try again.";
        btn.disabled = false; btn.textContent = "Submit for verification";
        if (/already_/.test(k)) { await loadPass(); render(); }
      }
    });
  }
  function payPending(justSent) {
    const m = modal(`<div class="eyebrow" style="color:var(--brass)">${justSent ? "Received" : "Payment under review"}</div>
      <h2 style="font-size:26px">${justSent ? "Thanks, we've got it" : "We're checking your payment"}</h2>
      <p style="margin:0">UTR <b class="spec">${esc(S.pass.utr || "")}</b>${S.pass.submitted ? ` · sent ${fmtWhen(S.pass.submitted)}` : ""}.</p>
      <p style="margin:0">We'll match it with the ₹${PAY.price} in our account and unlock Days 2–30 within a few minutes. Tap Check status to see if it's done.</p>
      <div class="row" style="justify-content:flex-end"><button class="btn quiet" id="pCheck">Check status</button><button class="btn" id="pOk">OK</button></div>`);
    $("#pOk", m).onclick = closeModal; $("#pCheck", m).onclick = (e) => checkPass(e.target, true);
  }
  async function checkPass(btn, inModal) {
    const was = btn.textContent; btn.disabled = true; btn.textContent = "Checking…";
    await loadPass(); btn.disabled = false; btn.textContent = was;
    if (S.pass.status === "paid") { closeModal(); render(); passWelcome(); }
    else if (S.pass.status === "pending") btn.textContent = "Still under review";
    else { closeModal(); render(); if (S.pass.status === "rejected") openPay(); }
    if (inModal && S.pass.status === "pending") setTimeout(() => (btn.textContent = was), 2500);
  }
  function passWelcome() {
    try { localStorage.setItem("ssbpb:passSeen:" + S.user.id, "1"); } catch (e) {}
    const m = modal(`<div class="eyebrow" style="color:var(--good)">Payment confirmed</div><h2 style="font-size:28px">Your full pass is active</h2>
      <p style="margin:0">All 30 days are unlocked, with no expiry. Keep to a daily rhythm, the way the board would expect.</p>
      <div class="row" style="justify-content:flex-end"><button class="btn" id="wOk">Go to today's tests</button></div>`);
    $("#wOk", m).onclick = () => { closeModal(); setView("today"); };
  }
  // Shown once per visit (browser tab session) to signed-in candidates without a pass
  function maybePayPopup() {
    if (!S.user || RUN || Store.kind !== "supabase" || !S.pass || $("#modalLayer").children.length) return;
    let seen = false; try { seen = !!localStorage.getItem("ssbpb:passSeen:" + S.user.id); } catch (e) {}
    if (S.pass.status === "paid") { if (!seen) passWelcome(); return; }
    if (!["none", "rejected"].includes(S.pass.status)) return;
    const k = "ssbpb:payPop:" + S.user.id;
    try { if (sessionStorage.getItem(k)) return; sessionStorage.setItem(k, "1"); } catch (e) {}
    openPay("welcome");
  }

  /* ---------- feedback (early-stage testing) ---------- */
  const snoozeKey = () => "ssbpb:fbSnooze:" + (S.user ? S.user.id : "");
  function fbMeta() {
    const last = S.sessions[S.sessions.length - 1];
    const lastTxt = last ? `${TESTS[last.test].code} (${last.count} items) on day ${last.day}, score ${r1(last.assessment && last.assessment.overall)}` : "none yet";
    return { chest_no: S.user.chest, tests_taken: S.sessions.length, last_test: lastTxt, device: navigator.userAgent.slice(0, 180) };
  }
  function feedbackBanner() {
    const old = $("#fbBar"); if (old) old.remove();
    if (!S.user || RUN || !S.sessions.length || S.fbCount > 0) return;
    let snoozedAt = -1; try { snoozedAt = +(localStorage.getItem(snoozeKey()) ?? -1); } catch (e) {}
    if (S.sessions.length <= snoozedAt) return;       // "Not now" waits until the next test
    const bar = document.createElement("div"); bar.id = "fbBar"; bar.className = "fbbar"; bar.setAttribute("role", "region"); bar.setAttribute("aria-label", "Feedback request");
    bar.innerHTML = `<div><b>How useful was this test?</b> <span class="muted">One tap helps us improve SSB Psych Lab.</span></div>
      <div class="row" style="gap:8px;flex-wrap:nowrap"><div class="seg" role="group" aria-label="Rate from 1 (not useful) to 5 (very useful)">${[1, 2, 3, 4, 5].map((n) => `<button data-q="${n}" aria-label="${n} out of 5">${n}</button>`).join("")}</div><button class="btn quiet" id="fbLater" style="padding:6px 10px">Not now</button></div>`;
    document.body.appendChild(bar);
    $("#fbLater").onclick = () => { try { localStorage.setItem(snoozeKey(), String(S.sessions.length)); } catch (e) {} bar.remove(); };
    bar.querySelectorAll("[data-q]").forEach((b) => b.onclick = async () => {
      const rating = +b.dataset.q;
      bar.querySelectorAll("[data-q]").forEach((x) => { x.disabled = true; x.setAttribute("aria-pressed", +x.dataset.q === rating); });
      try { await Store.saveFeedback(S.user.id, { rating, ...fbMeta(), emailed: false }); S.fbCount = (S.fbCount || 0) + 1; }
      catch (e) { bar.querySelectorAll("[data-q]").forEach((x) => (x.disabled = false)); return; }
      bar.innerHTML = `<div><b>Thanks for rating ${rating}/5.</b> <span class="muted">${rating <= 3 ? "What should we fix? A line or two helps a lot." : "Anything we should add or change?"}</span></div>
        <div class="row" style="gap:8px;flex-wrap:nowrap"><button class="btn quiet" id="fbDone">Done</button><button class="btn" id="fbMore">Add a comment</button></div>`;
      $("#fbDone").onclick = () => bar.remove();
      $("#fbMore").onclick = () => { bar.remove(); openFeedback(rating); };
    });
  }
  function openFeedback(preset) {
    preset = typeof preset === "number" ? preset : 0;
    const lastTxt = fbMeta().last_test;
    const m = modal(`<div class="eyebrow">Feedback · Chest No. ${S.user.chest}</div><h2 style="font-size:26px">How is SSB Psych Lab working for you?</h2>
      <form id="fbForm" style="display:flex;flex-direction:column;gap:12px">
        <div class="field"><label>Overall, how useful is it?</label>
          <div class="seg" role="radiogroup" aria-label="Rating from 1 to 5" id="fbRate">${[1, 2, 3, 4, 5].map((n) => `<button type="button" role="radio" aria-checked="false" aria-pressed="false" data-r="${n}">${n}</button>`).join("")}</div>
          <span class="muted" style="font-size:12px">1 = not useful · 5 = very useful</span></div>
        <div class="field"><label for="fbLiked">What worked well?</label><textarea id="fbLiked" rows="2" maxlength="1500" class="fbta"></textarea></div>
        <div class="field"><label for="fbImprove">What should we improve? (scoring, timings, word/situation sets, design…)</label><textarea id="fbImprove" rows="3" maxlength="2000" class="fbta"></textarea></div>
        <div class="field"><label for="fbIssues">Anything broken or confusing? (optional)</label><textarea id="fbIssues" rows="2" maxlength="1500" class="fbta"></textarea></div>
        <div class="field"><label for="fbRec">Would you recommend it to a friend preparing for SSB?</label><select id="fbRec"><option value="">Choose…</option><option>Yes</option><option>Maybe</option><option>No</option></select></div>
        <div class="muted" style="font-size:12px">Sent with your name, email and chest number so we can reply, plus your last test (${esc(lastTxt)}).</div>
        <div class="err" id="fbErr" role="alert"></div>
        <div class="row" style="justify-content:flex-end"><button type="button" class="btn quiet" id="fbCancel">Cancel</button><button class="btn" type="submit" id="fbSend">Send feedback</button></div>
      </form>`);
    let rating = preset;
    m.querySelectorAll("#fbRate button").forEach((x) => { const on = +x.dataset.r === rating; x.setAttribute("aria-pressed", on); x.setAttribute("aria-checked", on); });
    m.querySelectorAll("#fbRate button").forEach((b) => b.onclick = () => { rating = +b.dataset.r; m.querySelectorAll("#fbRate button").forEach((x) => { const on = +x.dataset.r === rating; x.setAttribute("aria-pressed", on); x.setAttribute("aria-checked", on); }); });
    $("#fbCancel", m).onclick = closeModal;
    $("#fbForm", m).addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = { rating: rating || null, recommend: $("#fbRec", m).value, liked: $("#fbLiked", m).value.trim(), improve: $("#fbImprove", m).value.trim(), issues: $("#fbIssues", m).value.trim() };
      if (!f.rating && !f.liked && !f.improve && !f.issues) { $("#fbErr", m).textContent = "Pick a rating or write a line before sending."; return; }
      const btn = $("#fbSend", m); btn.disabled = true; btn.textContent = "Sending…";
      // saved in Supabase; the database emails it to the team on its own, so nobody waits for email
      try { await Store.saveFeedback(S.user.id, { ...f, ...fbMeta(), emailed: false }); }
      catch (err) { btn.disabled = false; btn.textContent = "Send feedback"; $("#fbErr", m).textContent = "Couldn't send right now. Check your connection and try again."; return; }
      S.fbCount = (S.fbCount || 0) + 1; closeModal(); const bar = $("#fbBar"); if (bar) bar.remove();
      const ok = modal(`<h2 style="font-size:24px">Thank you!</h2><p style="margin:0">Your feedback reached the team. It goes straight into the next update.</p><div class="row" style="justify-content:flex-end"><button class="btn" id="fbOk">Close</button></div>`);
      $("#fbOk", ok).onclick = closeModal;
    });
  }

  /* ---------- full battery + Psychologist Review ---------- */
  const bKey = () => "ssbpb:battery:" + (S.user ? S.user.id : "");
  function loadBattery() { try { const b = JSON.parse(localStorage.getItem(bKey()) || "null"); return b && b.date === today() ? b : null; } catch (e) { return null; } }
  function saveBattery(b) { S.battery = b; try { if (b) localStorage.setItem(bKey(), JSON.stringify(b)); else localStorage.removeItem(bKey()); } catch (e) {} }
  const batterySessions = (bid) => S.sessions.filter((s) => s.assessment && s.assessment.battery === bid);
  function batteriesDone() {
    const m = new Map(); S.sessions.forEach((s) => { const b = s.assessment && s.assessment.battery; if (b) { if (!m.has(b)) m.set(b, {}); m.get(b)[s.test] = s; } });
    return [...m.entries()].filter(([, t]) => BATTERY_ORDER.every((k) => t[k])).map(([id, t]) => ({ id, tests: t, date: t.sd.date, day: t.sd.day }));
  }
  const nextTest = () => BATTERY_ORDER.find((t) => !S.battery.done[t]);
  function startBattery() { if (passLocked()) return openPay("locked"); saveBattery({ id: "b" + Date.now().toString(36), date: today(), done: {} }); nextInBattery(); }
  function nextInBattery() { if (!S.battery) return; const t = nextTest(); if (!t) return; startTest(t, TESTS[t].def, S.battery.id); }
  const ICON = {
    check: '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>',
    lock: '<svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    pen: '<svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  };
  function bsteps(done, current) {
    return `<div class="bsteps">${BATTERY_ORDER.map((t) => { const s = done[t]; const st = s ? "done" : t === current ? "now" : "";
      const sc = s && typeof s === "object" && s.assessment ? `<span class="num" style="color:var(--${scoreClass(s.assessment.overall)});font-weight:600">${r1(s.assessment.overall)}</span>` : `<span class="spec">~${TESTS[t].minutes(TESTS[t].def)} min</span>`;
      return `<div class="bstep ${st}"><span class="dot">${st === "done" ? ICON.check : st === "now" ? "NOW" : ""}</span><div style="flex:1"><b>${TESTS[t].code}</b><span class="muted">${TESTS[t].spec(TESTS[t].def)}</span></div>${sc}</div>`; }).join("")}</div>`;
  }
  function batteryCard() {
    if (Store.kind !== "supabase") return "";
    const todayDone = batteriesDone().filter((b) => b.date === today()).pop();
    if (S.battery && !todayDone) {
      const done = {}; Object.entries(S.battery.done).forEach(([t, id]) => (done[t] = S.sessions.find((s) => s.id === id) || true));
      const nt = nextTest();
      return `<section class="card battery"><div class="row" style="justify-content:space-between"><span class="eyebrow" style="color:var(--olive)">Full battery in progress</span><span class="pill" style="color:var(--brass)">${ICON.pen} Psychologist Review</span></div>
        <h2 style="font-size:32px">Full Psych Battery</h2>${bsteps(done, nt)}
        <div class="row"><button class="btn" data-bresume="1">Continue with ${TESTS[nt].code}</button><button class="btn quiet" data-bquit="1">Stop battery</button></div></section>`;
    }
    if (todayDone) {
      const rv = findReview("battery", todayDone.id);
      return `<section class="card battery"><div class="row" style="justify-content:space-between"><span class="eyebrow" style="color:var(--olive)">Today's full battery · done</span><span class="pill" style="color:var(--brass)">${ICON.pen} Psychologist Review</span></div>
        <h2 style="font-size:32px">Full Psych Battery</h2>${bsteps(todayDone.tests, null)}
        <div class="row"><button class="btn" data-battery="${todayDone.id}">${rv && rv.status === "done" ? "Read your Psychologist Review" : "Open Psychologist Review"}</button></div></section>`;
    }
    return `<section class="card battery"><div class="row" style="justify-content:space-between"><span class="eyebrow" style="color:var(--olive)">Recommended · board order</span><span class="pill" style="color:var(--brass)">${ICON.pen} Psychologist Review</span></div>
      <h2 style="font-size:32px">Full Psych Battery</h2>
      <p class="muted" style="margin:0">All four tests in one sitting, the way the board runs them. Finish all four today to unlock your full Psychologist Review.</p>
      ${bsteps({}, null)}
      <div class="spec" style="border-top:1px dashed var(--line);padding-top:10px">About 2 hours in total · 2-minute break between tests</div>
      <div class="lockbox">${ICON.lock}<span><b>Psychologist Review is locked.</b> It opens after SD is submitted. One full review per day.</span></div>
      <div>${passLocked() ? `<button class="btn" data-pay="locked">${ICON.lock} Unlock with full pass</button>` : `<button class="btn" data-bstart="1">Start full battery</button>`}</div></section>`;
  }
  function batteryBreak(prev, saveErr) {
    const nt = nextTest(); let left = BATTERY_BREAK;
    envShell("Full battery");
    $("#envSub").textContent = `Test ${BATTERY_ORDER.indexOf(nt) + 1} of 4 next`;
    const done = {}; Object.entries(S.battery.done).forEach(([t, id]) => (done[t] = S.sessions.find((s) => s.id === id) || true));
    const answered = prev.responses.filter((x) => (x || "").trim()).length;
    $("#envIn").innerHTML = `${saveErr ? `<div class="banner" id="bSaveErr">Your ${TESTS[prev.test].code} couldn't be saved (${esc(saveErr.message || "connection problem")}). <button class="linkbtn" id="bRetry">Retry</button></div>` : ""}
      <div class="row" style="color:var(--good);font-weight:600"><span class="bstep done" style="display:inline-flex"><span class="dot">${ICON.check}</span></span>${TESTS[prev.test].code} submitted · ${answered} of ${prev.count} answered</div>
      <div class="card" style="display:flex;flex-direction:column;gap:12px"><div class="eyebrow">Up next</div><h2 style="font-size:30px">${TESTS[nt].name}</h2><p class="muted" style="margin:0">${TESTS[nt].spec(TESTS[nt].def)}.</p>
        <div style="text-align:center;border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:14px 0"><div class="eyebrow">Break</div><div class="brk num" id="brk">${fmtClock(left)}</div><div class="muted" style="font-size:13px">${TESTS[nt].code} starts on its own when the break ends</div></div>
        <button class="btn" id="bNext">Start ${TESTS[nt].code} now</button></div>
      <div class="card" style="display:flex;flex-direction:column;gap:10px"><div class="eyebrow">Battery progress</div>${bsteps(done, nt)}</div>
      <p class="muted" style="font-size:13px;margin:0">If you leave now, finished tests stay as single-test reports. The full Psychologist Review needs all four today.</p>`;
    RUN = { paused: false, battery: S.battery.id, brk: true };
    const go = () => { if (RUN && RUN.timer) clearInterval(RUN.timer); RUN = null; nextInBattery(); };
    $("#bNext").onclick = go;
    const rb = $("#bRetry"); if (rb) rb.onclick = async () => { rb.textContent = "Saving…"; try { await Store.saveSession(S.user.id, prev); S.unsaved = null; $("#bSaveErr").textContent = "Saved."; } catch (e) { rb.textContent = "Retry"; } };
    $("#envExit").onclick = async () => { RUN.paused = true; const ok = await confirmBox("Leave the battery?", "Finished tests stay as single-test reports. You can continue this battery later today from the Today page.", "Leave"); if (ok) endRun(); else RUN.paused = false; };
    tick((dt) => { left -= dt; const b = $("#brk"); if (b) b.textContent = fmtClock(left); setBar(1 - left / BATTERY_BREAK); if (left <= 0) go(); });
  }

  async function loadAI() {
    if (Store.kind !== "supabase") return;
    try { S.ai.reviews = await Store.aiReviews(); } catch (e) {}
    try { S.ai.status = await Store.ai("status"); } catch (e) { S.ai.status = null; }
    if (S.user && !RUN && ["report", "battery", "progress", "today"].includes(S.view)) render();
  }
  const findReview = (kind, key) => S.ai.reviews.find((r) => r.kind === kind && (kind === "battery" ? r.battery_id === key : r.session_id === key));
  function stimuli(s) {
    const items = itemsFor(s.test, s.set, s.count);
    return items.map((it) => s.test === "tat" ? (it.blank ? "Blank slide" : tatPic(it.id).desc) : s.test === "wat" ? it.w : s.test === "srt" ? it.t : "");
  }
  async function runReview(key, call) {
    S.ai.pending[key] = Date.now(); delete S.ai.err[key]; render();
    try {
      const j = await call(); const rv = j.review;
      S.ai.reviews = [rv, ...S.ai.reviews.filter((r) => r.id !== rv.id)];
      try { S.sessions = await Store.sessions(S.user.id); } catch (e) {}
      Store.ai("status").then((st) => (S.ai.status = st)).catch(() => {});
    } catch (e) { S.ai.err[key] = { msg: e.message, code: e.code }; }
    delete S.ai.pending[key]; if (!RUN) render();
  }
  function requestSingle(sid) {
    const s = S.sessions.find((x) => x.id === sid); if (!s || S.ai.pending[sid]) return;
    runReview(sid, () => Store.ai("single", { session_id: sid, items: stimuli(s) }));
  }
  function requestBattery(bid, auto) {
    if (S.ai.pending[bid]) return;
    if (auto && S.ai.status && !S.ai.status.configured) return;
    const by = {}; batterySessions(bid).forEach((s) => (by[s.test] = s));
    const items = {}; ["tat", "wat", "srt"].forEach((t) => { if (by[t]) items[t] = stimuli(by[t]); });
    runReview(bid, () => Store.ai("battery", { battery_id: bid, items }));
  }
  const gradeCls = (g) => { g = String(g || ""); return /not yet|needs work/i.test(g) ? "bad" : /strong|promising|^recommended/i.test(g) ? "good" : "warn"; };
  function ring(ov, size) {
    const C = 2 * Math.PI * 52;
    return `<div class="ring" style="width:${size}px;height:${size}px"><svg viewBox="0 0 120 120" role="img" aria-label="Overall ${r1(ov)} out of 10"><circle cx="60" cy="60" r="52" fill="none" stroke="var(--line)" stroke-width="10"/><circle cx="60" cy="60" r="52" fill="none" stroke="var(--olive)" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(C * (ov || 0)) / 10} ${C}"/></svg><div class="score num">${r1(ov)}<small>/ 10</small></div></div>`;
  }
  function writingCard(kind) {
    const steps = kind === "battery" ? ["Reading your TAT stories", "Judging your SRT reactions", "Scanning your WAT responses", "Reading your self description", "Writing your final review"] : ["Reading your answers", "Rating the 15 OLQs", "Writing your review"];
    return `<section class="card psy" aria-live="polite"><div class="row" style="justify-content:space-between"><span class="eyebrow" style="color:var(--brass)">Psychologist Review</span><span class="pill" style="color:var(--brass)">Writing…</span></div>
      <h2 style="font-size:26px">Your psychologist is writing</h2>
      <ul class="list" style="gap:6px">${steps.map((t) => `<li class="muted" style="font-size:14px">${t}</li>`).join("")}</ul>
      <div class="indet"><b></b></div><div class="spec">${kind === "battery" ? "Usually about a minute" : "Usually 10–20 seconds"}. You can keep reading your scored report meanwhile.</div></section>`;
  }
  function reviewHTML(rv, kind) {
    const r = rv.result || {}; const grade = r.recommendation || r.grade;
    const strengths = r.top_strengths || r.strengths || [], imps = r.priority_improvements || r.improvements || [];
    const ex = (list) => (list || []).filter((e) => e && (e.comment || e.quote)).map((e) => `<div class="resp"><div class="idx num">${e.item ? pad(e.item) : "·"}</div><div style="display:flex;flex-direction:column;gap:6px">${e.quote ? `<div class="quote">“${esc(e.quote)}”</div>` : ""}<div style="font-size:14px">${esc(e.comment || "")}</div>${e.better ? `<div class="better">Better: ${esc(e.better)}</div>` : ""}</div></div>`).join("");
    const perTest = kind === "battery" && r.tests ? BATTERY_ORDER.filter((t) => r.tests[t]).map((t) => { const d = r.tests[t]; return `<div style="border-top:1px solid var(--line);padding-top:12px;display:flex;flex-direction:column;gap:8px"><b style="font-family:var(--display);font-size:20px;letter-spacing:.04em">${TESTS[t].code}</b><ul style="margin:0;padding-left:18px;font-size:14px">${(d.observations || []).map((o) => `<li>${esc(o)}</li>`).join("")}</ul>${ex((d.examples || []).slice(0, 2))}</div>`; }).join("") : "";
    return `<section class="card psy"><div class="row" style="justify-content:space-between"><span class="eyebrow" style="color:var(--brass)">Psychologist Review</span><span class="pill" style="color:var(--brass)">${ICON.pen} ${kind === "battery" ? "Full battery" : TESTS[rv.test] ? TESTS[rv.test].code : ""}</span></div>
      <div class="report-head" style="padding:0;border:0;background:none">${ring(r.overall, 112)}<div style="display:flex;flex-direction:column;gap:8px"><h2 style="font-size:28px">Personality profile</h2>${grade ? `<div><span class="pill ${gradeCls(grade)}">${esc(grade)}</span></div>` : ""}</div></div>
      ${r.summary ? `<p style="margin:0;max-width:70ch">${esc(r.summary)}</p>` : ""}
      ${r.consistency ? `<div class="lockbox" style="display:block"><b>Consistency:</b> ${esc(r.consistency)}</div>` : ""}</section>
    ${r.olq && Object.keys(r.olq).length ? `<section class="card"><div class="section-h" style="margin-bottom:14px"><h2>OLQs · Psychologist's rating</h2><span class="muted" style="font-size:13px">Brass mark = 7.0</span></div>${olqBlock(r.olq)}</section>` : ""}
    <section class="two">
      <div class="card"><h2 style="font-size:22px;margin-bottom:12px">Strengths</h2><ul class="list">${strengths.map((x) => `<li class="str">${esc(x)}</li>`).join("") || `<li class="muted">—</li>`}</ul></div>
      <div class="card"><h2 style="font-size:22px;margin-bottom:12px">Priority improvements</h2><ul class="list">${imps.map((i) => `<li class="imp"><b>${esc(i.area || "")}</b><span>${esc(i.why || "")}</span>${i.practice ? `<div style="color:var(--olive);font-size:14px;margin-top:4px"><b>Practise:</b> ${esc(i.practice)}</div>` : ""}</li>`).join("") || `<li class="muted">—</li>`}</ul></div>
    </section>
    ${kind === "battery" ? (perTest ? `<section class="card" style="display:flex;flex-direction:column;gap:12px"><h2 style="font-size:22px">What each test showed</h2>${perTest}</section>` : "")
      : `<section class="card" style="display:flex;flex-direction:column;gap:12px"><h2 style="font-size:22px">What the psychologist noticed</h2>${(r.observations || []).length ? `<ul style="margin:0;padding-left:18px">${r.observations.map((o) => `<li>${esc(o)}</li>`).join("")}</ul>` : ""}${ex(r.examples)}</section>`}
    ${(r.seven_day_plan || []).length ? `<section class="card"><h2 style="font-size:22px;margin-bottom:12px">Your next 7 days</h2><ol class="plan">${r.seven_day_plan.map((p) => `<li>${esc(p)}</li>`).join("")}</ol></section>` : ""}
    <p class="muted" style="font-size:12px;margin:0">Prepared by the SSB Psych Lab psychologist, an AI model guided by the SSB OLQ framework, and cross-checked with your scored reports. Use it as practice guidance, not a board verdict.</p>`;
  }
  function psychGate(key, kind, btnAttr) {
    const st = S.ai.status, err = S.ai.err[key];
    if (S.ai.pending[key]) return writingCard(kind);
    if (st && !st.configured) return `<section class="card psy"><span class="eyebrow" style="color:var(--brass)">Psychologist Review</span><h2 style="font-size:24px">Opening soon</h2><p class="muted" style="margin:0">Your psychologist is getting ready. Reviews will appear here once they open; your scored report below is ready now.</p></section>`;
    const left = st ? Math.max(0, st.limits.single - st.used.single) : null;
    const blocked = kind === "single" && st && (left === 0 || !st.singleOpen);
    const note = kind === "single" ? (st ? (left === 0 ? "You've used today's single-test review. It resets daily." : !st.singleOpen ? "Today's Psychologist Reviews are fully booked. Back tomorrow." : st.limits.single === 1 ? "1 single-test review a day · use it on the test you most want checked" : `${left} of ${st.limits.single} single-test reviews left today`) : "1 single-test review a day")
      : "One full review per day";
    return `<section class="card psy"><div class="row" style="justify-content:space-between"><span class="eyebrow" style="color:var(--brass)">Psychologist Review</span><span class="pill" style="color:var(--brass)">${ICON.pen} ${kind === "battery" ? "Full battery" : "This test"}</span></div>
      <h2 style="font-size:26px">${kind === "battery" ? "Get your full Psychologist Review" : "Want a psychologist's reading of this test?"}</h2>
      <p class="muted" style="margin:0">${kind === "battery" ? "Your psychologist reads all four tests together, replaces the automatic scores with a proper assessment, rates your 15 OLQs, checks whether the tests show one consistent personality, and gives you a 7-day plan." : "Your psychologist reads every answer and replaces the automatic score with a proper assessment: OLQ ratings, what worked, what didn't, and how to improve."}</p>
      ${err ? `<div class="banner" role="alert" style="margin:0">${esc(err.msg)}</div>` : ""}
      <div class="row"><button class="btn" ${btnAttr} ${blocked ? "disabled" : ""}>${err && err.code === "ai_failed" ? "Try again" : "Get Psychologist Review"}</button><span class="spec">${note}</span></div></section>`;
  }
  function psychSection(s) {
    if (Store.kind !== "supabase") return "";
    if (s.assessment && s.assessment.battery) {
      const complete = batteriesDone().some((b) => b.id === s.assessment.battery);
      return `<div class="banner" style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap"><span>This test is part of a full battery${complete ? "." : " that wasn't finished."}</span>${complete ? `<button class="btn ghost" data-battery="${s.assessment.battery}">Open full Psychologist Review</button>` : ""}</div>`;
    }
    if (s.assessment && s.assessment.source === "psychologist") return "";
    return psychGate(s.id, "single", `data-psy="${s.id}"`);
  }
  function psychNotes(s) {
    const rv = s.assessment.battery ? null : findReview("single", s.id); const r = rv && rv.result;
    if (!r || !((r.observations || []).length || (r.examples || []).length)) return "";
    const ex = (r.examples || []).filter((e) => e && (e.comment || e.quote)).map((e) => `<div class="resp"><div class="idx num">${e.item ? pad(e.item) : "·"}</div><div style="display:flex;flex-direction:column;gap:6px">${e.quote ? `<div class="quote">“${esc(e.quote)}”</div>` : ""}<div style="font-size:14px">${esc(e.comment || "")}</div>${e.better ? `<div class="better">Better: ${esc(e.better)}</div>` : ""}</div></div>`).join("");
    return `<section class="card" style="display:flex;flex-direction:column;gap:12px"><h2 style="font-size:22px">What the psychologist noticed</h2>${(r.observations || []).length ? `<ul style="margin:0;padding-left:18px">${r.observations.map((o) => `<li>${esc(o)}</li>`).join("")}</ul>` : ""}${ex}</section>`;
  }
  function viewBattery() {
    const bid = S.reportId, list = batterySessions(bid);
    if (!list.length) return `<div class="card"><p>That battery isn't in your file.</p><button class="btn" data-goto="progress">Go to Progress</button></div>`;
    const by = {}; list.forEach((s) => (by[s.test] = s));
    const complete = BATTERY_ORDER.every((t) => by[t]);
    const tiles = BATTERY_ORDER.map((t) => by[t] ? `<button class="kpi click" data-report="${by[t].id}" style="text-align:left;cursor:pointer;font:inherit"><b style="color:var(--${scoreClass(by[t].assessment.overall)})">${r1(by[t].assessment.overall)}</b><span><b style="font-family:var(--display);font-size:18px;color:var(--ink)">${TESTS[t].code}</b> · scored report ›</span></button>` : `<div class="kpi"><b class="muted">—</b><span>${TESTS[t].code} · not taken</span></div>`).join("");
    const rv = findReview("battery", bid);
    const first = list[0];
    return `<div class="row" style="justify-content:space-between"><button class="btn quiet" data-goto="progress">← All reports</button><span class="eyebrow">Day ${first.day} · ${fmtDate(first.date)} · Full battery</span></div>
      <div><div class="eyebrow">Full Psych Battery</div><h1 style="font-size:32px;margin-top:4px">${complete ? "All four tests done" : "Battery not finished"}</h1></div>
      <div class="kpis">${tiles}</div>
      ${!complete ? `<div class="banner">The full Psychologist Review needs all four tests from one sitting.</div>` : rv && rv.status === "done" ? reviewHTML(rv, "battery") : psychGate(bid, "battery", `data-psyb="${bid}"`)}`;
  }
  function reviewsList() {
    if (Store.kind !== "supabase") return "";
    const done = S.ai.reviews.filter((r) => r.status === "done");
    const rows = done.map((r) => { const target = r.kind === "battery" ? `data-battery="${r.battery_id}"` : `data-report="${r.session_id}"`; const g = r.result && (r.result.recommendation || r.result.grade);
      return `<tr class="click" ${target}><td>D${pad(r.day || 0)}</td><td>${fmtDate(r.date)}</td><td><b>${r.kind === "battery" ? "Full battery" : TESTS[r.test] ? TESTS[r.test].code : ""}</b></td><td>${g ? `<span class="pill ${gradeCls(g)}">${esc(g)}</span>` : ""}</td><td><span class="pill ${scoreClass(r.result && r.result.overall)}">${r1(r.result && r.result.overall)}</span></td></tr>`; }).join("");
    const bd = batteriesDone().filter((b) => !findReview("battery", b.id));
    const pend = bd.map((b) => `<tr class="click" data-battery="${b.id}"><td>D${pad(b.day)}</td><td>${fmtDate(b.date)}</td><td><b>Full battery</b></td><td><span class="pill neutral">Not requested</span></td><td>—</td></tr>`).join("");
    if (!rows && !pend) return "";
    return `<section class="card"><div class="section-h" style="margin-bottom:8px"><h2 style="font-size:22px">Psychologist Reviews</h2><span class="muted" style="font-size:13px">${done.length} review${done.length === 1 ? "" : "s"}</span></div><div class="tablewrap"><table class="t"><thead><tr><th>Day</th><th>Date</th><th>For</th><th>Verdict</th><th>OLQ</th></tr></thead><tbody>${rows}${pend}</tbody></table></div></section>`;
  }

  /* ---------- test environment ---------- */
  let RUN = null;
  function envShell(title) {
    $("#layer").innerHTML = `<div class="env" role="dialog" aria-label="${title} test"><div class="env-top"><div><div class="env-title">${title}</div><div class="eyebrow" id="envSub"></div></div><div class="row" style="gap:14px"><div class="clock num" id="clock">--:--</div><button class="btn quiet" id="envExit" style="padding:6px 12px">Exit</button></div></div><div class="progressbar"><b id="pbar" style="width:0"></b></div><div class="env-body"><div class="env-in" id="envIn"></div></div></div>`;
    $("#envExit").onclick = async () => { const was = RUN && RUN.paused; if (RUN) RUN.paused = true; const ok = await confirmBox("Leave this test?", "Your answers so far will be thrown away. At the board the test doesn't stop, so try to finish it.", "Leave test", true); if (ok) endRun(); else if (RUN) RUN.paused = was; };
  }
  function endRun() { if (RUN && RUN.timer) clearInterval(RUN.timer); RUN = null; $("#layer").innerHTML = ""; render(); }
  function startTest(test, count, battery) {
    if (passLocked()) return openPay("locked");
    const n = dayNum(), set = setNum(n);
    RUN = { test, count, set, day: n, items: itemsFor(test, set, count), title: battery ? `${TESTS[test].code} · Full battery ${BATTERY_ORDER.indexOf(test) + 1}/4` : TESTS[test].code, paused: false, i: 0, battery: battery || null };
    RUN.responses = RUN.items.map(() => "");
    if (test === "tat") RUN.items.forEach((it) => { if (!it.blank) { const im = new Image(); im.src = tatPic(it.id).file; } }); // preload
    envShell(RUN.title); instructions();
  }
  function instructions() {
    const t = RUN.test, n = RUN.items.length;
    const text = {
      tat: [`You will see ${RUN.items.filter((x) => !x.blank).length} pictures${RUN.items.some((x) => x.blank) ? " and then a blank slide" : ""}, one at a time.`, "Each picture shows for 30 seconds. Then it is removed and you get 4 minutes to write a story.", "Say what led to the situation, what is happening now, and how it ends. Identify a hero and what the hero thinks and does.", "For the blank slide you get 1 minute to imagine any picture of your own, then 4 minutes to write.", "The timer moves on by itself, as it does at the board."],
      wat: [`${n} words will appear one after another.`, "Each word stays for 15 seconds. Write the first thought that comes to mind, as a short sentence.", "The next word appears automatically. Pressing Enter moves on early.", "Don't skip words. A blank counts against you."],
      srt: [`You have ${n} situations and ${n / 2} minutes in total.`, "Write what you would actually do, briefly, in the order you would do it.", "Use Next and Back (or Enter) to move; when the time ends, the test is submitted.", "Attempt all. Short, complete actions beat long half answers."],
      sd: ["You have 15 minutes to write five short paragraphs.", "Write honestly what your parents, teachers or employer, friends and you yourself think of you, and the qualities you want to develop.", "Give real examples. Balance strengths with weaknesses."],
    }[t];
    $("#envSub").textContent = "Instructions";
    $("#clock").textContent = fmtClock({ tat: TAT_VIEW + TAT_WRITE, wat: WAT_SEC, srt: n * SRT_SEC_PER, sd: SD_SEC }[t]);
    $("#envIn").innerHTML = `<div class="card instr"><div class="eyebrow">${TESTS[t].name} · Set ${pad(RUN.set)}</div><h2 style="font-size:30px">Read before you start</h2><ol>${text.map((x) => `<li>${x}</li>`).join("")}</ol><div class="row"><button class="btn" id="beginBtn">Begin test</button></div></div>`;
    $("#beginBtn").onclick = () => { RUN.started = Date.now(); ({ tat: runTAT, wat: runWAT, srt: runSRT, sd: runSD })[t](); };
  }
  function tick(fn) { if (RUN.timer) clearInterval(RUN.timer); let lt = Date.now(); RUN.timer = setInterval(() => { const now = Date.now(), dt = (now - lt) / 1000; lt = now; if (RUN && !RUN.paused) fn(dt); }, 200); }
  function setClock(sec, total) { const c = $("#clock"); if (!c) return; c.textContent = fmtClock(sec); c.classList.toggle("low", sec <= (total > 60 ? 30 : 5)); }
  function setBar(f) { const b = $("#pbar"); if (b) b.style.width = Math.min(100, f * 100) + "%"; }

  function runTAT() {
    RUN.i = 0; RUN.phase = "view"; RUN.left = RUN.items[0].blank ? TAT_BLANK_VIEW : TAT_VIEW;
    const total = RUN.items.length;
    const draw = () => {
      const it = RUN.items[RUN.i];
      $("#envSub").textContent = `${it.blank ? "Blank slide" : "Picture " + (RUN.i + 1)} of ${total}`;
      if (RUN.phase === "view") {
        $("#envIn").innerHTML = `<div class="row" style="justify-content:space-between"><span class="phase">Observe</span><span class="muted" style="font-size:14px">Picture is removed when the timer ends</span></div>
          ${it.blank ? `<div class="tat-frame"><div class="blank-slide">BLANK SLIDE · THINK OF YOUR OWN PICTURE</div></div>` : `<div class="tat-frame"><img src="${tatPic(it.id).file}" alt="TAT picture"></div>`}`;
      } else {
        $("#envIn").innerHTML = `<div class="row" style="justify-content:space-between"><span class="phase write">Write your story</span><span class="wc" id="wc">0 words</span></div>
          <textarea class="write" id="story" aria-label="Your story" placeholder="What led to this, what is happening, how it ends…">${esc(RUN.responses[RUN.i])}</textarea>
          <div class="row" style="justify-content:flex-end"><button class="btn quiet" id="tatNext">Finished early: ${RUN.i === total - 1 ? "submit" : "next picture"}</button></div>`;
        const ta = $("#story"); ta.focus(); const u = () => ($("#wc").textContent = words(ta.value) + " words"); u();
        ta.addEventListener("input", () => { RUN.responses[RUN.i] = ta.value; u(); });
        $("#tatNext").onclick = advance;
      }
    };
    const advance = () => {
      if (RUN.phase === "view") { RUN.phase = "write"; RUN.left = TAT_WRITE; }
      else { RUN.i++; if (RUN.i >= total) return finish(); RUN.phase = "view"; RUN.left = RUN.items[RUN.i].blank ? TAT_BLANK_VIEW : TAT_VIEW; }
      draw();
    };
    draw();
    tick((dt) => { RUN.left -= dt; const it = RUN.items[RUN.i]; const tot = RUN.phase === "view" ? (it.blank ? TAT_BLANK_VIEW : TAT_VIEW) : TAT_WRITE; setClock(RUN.left, tot);
      setBar((RUN.i + (RUN.phase === "write" ? 0.15 + 0.85 * (1 - RUN.left / tot) : 0.15 * (1 - RUN.left / tot))) / total); if (RUN.left <= 0) advance(); });
  }
  function runWAT() {
    RUN.i = 0; RUN.left = WAT_SEC;
    const draw = () => {
      $("#envSub").textContent = `Word ${RUN.i + 1} of ${RUN.items.length}`;
      $("#envIn").innerHTML = `<div class="word" aria-live="assertive">${esc(RUN.items[RUN.i].w)}</div>
        <input class="wat-input" id="watIn" autocomplete="off" spellcheck="false" aria-label="Your response" placeholder="First thought…" value="${esc(RUN.responses[RUN.i])}">
        <div class="muted" style="font-size:13px;text-align:center">Next word in 15 s · Enter to move on</div>`;
      const inp = $("#watIn"); inp.focus(); inp.addEventListener("input", () => (RUN.responses[RUN.i] = inp.value));
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); next(); } });
    };
    const next = () => { RUN.i++; if (RUN.i >= RUN.items.length) return finish(); RUN.left = WAT_SEC; draw(); };
    draw(); tick((dt) => { RUN.left -= dt; setClock(RUN.left, WAT_SEC); setBar((RUN.i + 1 - RUN.left / WAT_SEC) / RUN.items.length); if (RUN.left <= 0) next(); });
  }
  function runSRT() {
    const total = RUN.items.length * SRT_SEC_PER; RUN.left = total; RUN.i = 0;
    const draw = () => {
      const n = RUN.items.length;
      $("#envSub").textContent = `Situation ${RUN.i + 1} of ${n} · ${RUN.responses.filter((x) => x.trim()).length} answered`;
      $("#envIn").innerHTML = `<div class="card"><div class="eyebrow" style="margin-bottom:6px">${pad(RUN.i + 1)}</div><div class="situation">${esc(RUN.items[RUN.i].t)}</div></div>
        <textarea class="write" id="srtIn" style="min-height:140px" aria-label="Your reaction" placeholder="He…">${esc(RUN.responses[RUN.i])}</textarea>
        <div class="row" style="justify-content:space-between"><button class="btn quiet" id="srtBack" ${RUN.i === 0 ? "disabled" : ""}>Back</button><span class="wc" id="wc"></span><button class="btn" id="srtNext">${RUN.i === n - 1 ? "Submit test" : "Next"}</button></div>`;
      const ta = $("#srtIn"); ta.focus(); const u = () => ($("#wc").textContent = words(ta.value) + " words"); u();
      ta.addEventListener("input", () => { RUN.responses[RUN.i] = ta.value; u(); });
      ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#srtNext").click(); } });
      $("#srtBack").onclick = () => { RUN.i--; draw(); };
      $("#srtNext").onclick = async () => {
        if (RUN.i < n - 1) { RUN.i++; draw(); return; }
        const left = RUN.responses.filter((x) => !x.trim()).length;
        if (left) { RUN.paused = true; const ok = await confirmBox("Submit now?", `${left} situation${left > 1 ? "s are" : " is"} still unanswered and you have ${fmtClock(RUN.left)} left.`, "Submit"); if (ok) finish(); else RUN.paused = false; }
        else finish();
      };
    };
    draw(); tick((dt) => { RUN.left -= dt; setClock(RUN.left, total); setBar(1 - RUN.left / total); if (RUN.left <= 0) finish(); });
  }
  function runSD() {
    RUN.left = SD_SEC;
    $("#envSub").textContent = "Five paragraphs";
    $("#envIn").innerHTML = RUN.items.map((it, i) => `<div class="field"><label for="sd${i}" style="font-size:15px;color:var(--ink)">${i + 1}. ${esc(it.t)}</label><textarea class="write" id="sd${i}" data-i="${i}" style="min-height:110px"></textarea></div>`).join("") + `<div class="row" style="justify-content:flex-end"><button class="btn" id="sdDone">Submit</button></div>`;
    $("#envIn").querySelectorAll("textarea").forEach((ta) => ta.addEventListener("input", () => (RUN.responses[+ta.dataset.i] = ta.value)));
    $("#sdDone").onclick = finish;
    tick((dt) => { RUN.left -= dt; setClock(RUN.left, SD_SEC); setBar(1 - RUN.left / SD_SEC); if (RUN.left <= 0) finish(); });
  }
  async function finish() {
    if (!RUN || RUN.finishing) return; RUN.finishing = true; clearInterval(RUN.timer);
    const A = assess({ test: RUN.test, items: RUN.items, responses: RUN.responses }, { tatBank: window.TAT_BANK });
    const stored = { ...A, items: A.items.map((x) => ({ i: x.i, tag: x.tag, score: x.score })) }; // notes are regenerated on view
    if (RUN.battery) stored.battery = RUN.battery;
    const s = { id: "s" + Date.now().toString(36), test: RUN.test, count: RUN.count, set: RUN.set, day: RUN.day, date: today(), createdAt: Date.now(),
      responses: RUN.responses.map((x) => x || ""), timeUsed: Math.round((Date.now() - RUN.started) / 1000), assessment: stored };
    S.sessions.push(s);
    let saveErr = null;
    try { await Store.saveSession(S.user.id, s); } catch (e) { saveErr = e; }
    const bid = RUN.battery; RUN = null; $("#layer").innerHTML = ""; S.filter = "all";
    if (bid && S.battery && S.battery.id === bid) {
      S.battery.done[s.test] = s.id; saveBattery(S.battery);
      if (BATTERY_ORDER.some((t) => !S.battery.done[t])) { if (saveErr) S.unsaved = s; batteryBreak(s, saveErr); return; }
      saveBattery(null); setView("battery", bid);
      if (!saveErr) requestBattery(bid, true);
      else alertBanner(`Your SD couldn't be saved (${saveErr.message || "connection problem"}). Press Retry, then ask for your Psychologist Review.`, async () => { await Store.saveSession(S.user.id, s); S.unsaved = null; });
      return;
    }
    setView("report", s.id);
    if (saveErr) { S.unsaved = s; alertBanner(`This test couldn't be saved (${saveErr.message || "connection problem"}). Your report is shown below; keep this tab open and press Retry.`, async () => { await Store.saveSession(S.user.id, s); S.unsaved = null; }); }
  }
  function alertBanner(msg, retry) {
    const b = document.createElement("div"); b.className = "banner"; b.textContent = msg + " ";
    if (retry) { const btn = document.createElement("button"); btn.className = "linkbtn"; btn.textContent = "Retry"; btn.onclick = async () => { btn.textContent = "Saving…"; try { await retry(); b.textContent = "Saved."; } catch (e) { btn.textContent = "Retry"; } }; b.appendChild(btn); }
    $("#main").prepend(b);
  }

  /* ---------- boot ---------- */
  document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));
  $("#settingsBtn").addEventListener("click", openProfile);
  $("#feedbackBtn").addEventListener("click", () => openFeedback());
  $("#chest").addEventListener("click", () => { if (S.user) openProfile(); });
  $("#logoutBtn").addEventListener("click", async () => { if (await confirmBox("Log out?", "Your progress stays saved for when you log in again.", "Log out")) signOut("", "landing"); });
  $("#guestLoginBtn").addEventListener("click", () => gate("login"));
  $("#guestRegBtn").addEventListener("click", () => gate("register"));

  /* ---------- session timeout: signed in, but no activity for 30 minutes → log out ---------- */
  const IDLE_MS = 30 * 60 * 1000, LAST_KEY = "ssbpb:last";
  function markActive(force) {
    const now = Date.now(); if (!force && now - (S.last || 0) < 10000) return;   // throttle the storage write
    S.last = now; try { localStorage.setItem(LAST_KEY, String(now)); } catch (e) {}
  }
  function signOut(notice, page) {
    try { if (S.user) sessionStorage.removeItem("ssbpb:payPop:" + S.user.id); } catch (e) {}
    Store.logout(); S.user = null; S.sessions = []; S.overall = null; S.battery = null; S.fbCount = 0;
    S.notice = notice || ""; S.authMode = "login"; S.page = page || (notice ? "auth" : "landing");
    history.replaceState(null, "", S.page === "auth" ? "#login" : location.pathname);
    $("#layer").innerHTML = ""; closeModal(); render();
  }
  function idleCheck() {
    if (!S.user) return;
    if (!S.last || RUN) return markActive(true);   // first check after sign-in starts the clock; never sign out mid-test
    if (Date.now() - (S.last || 0) > IDLE_MS) signOut("You were logged out after 30 minutes without activity. Log in to continue your program.");
  }
  ["pointerdown", "keydown", "touchstart", "scroll"].forEach((ev) => document.addEventListener(ev, () => markActive(false), { passive: true, capture: true }));
  setInterval(idleCheck, 15000);

  (async function boot() {
    readHash();
    $("#main").innerHTML = `<div class="loading"><div class="spinner"></div><div class="muted">Opening your file…</div></div>`;
    try { await Store.init(); S.user = await Store.currentUser(); if (S.user) await loadUser(); }
    catch (e) { S.user = null; }
    readHash();   // the email link may have changed the hash (#reset for a password reset)
    if (S.user) {
      const last = +(localStorage.getItem(LAST_KEY) || 0);
      if (last && Date.now() - last > IDLE_MS) { Store.logout(); S.user = null; S.notice = "You were logged out after 30 minutes without activity. Log in to continue your program."; S.page = "auth"; S.authMode = "login"; }
      else markActive(true);
    }
    if (!S.user && Store.isRecovery()) { S.page = "auth"; S.authMode = "recovery"; }
    if (!S.user && Store.kind === "supabase") Store.passOffer().then((o) => { applyOffer(o); if (!S.user && S.page === "landing") render(); }).catch(() => {});
    render();
    if (S.user) maybePayPopup();
  })();
})();
