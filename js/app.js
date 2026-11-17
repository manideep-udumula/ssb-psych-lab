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
  const S = { user: null, sessions: [], overall: null, choice: {}, view: "today", reportId: null, filter: "all", authMode: "login" };
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
    const h = v === "report" && id ? "report-" + id : v;
    if (location.hash.slice(1) !== h) history.replaceState(null, "", "#" + h);
    render(); window.scrollTo(0, 0);
  }
  function readHash() {
    const h = location.hash.slice(1);
    if (h.startsWith("report-")) { S.view = "report"; S.reportId = h.slice(7); }
    else if (["today", "progress", "interview"].includes(h)) S.view = h; else S.view = "today";
  }
  window.addEventListener("hashchange", () => { readHash(); render(); });

  /* ---------- render ---------- */
  function render() {
    const nav = $("#nav"), main = $("#main");
    document.body.classList.toggle("authed", !!S.user);
    if (!S.user) { nav.hidden = true; $("#chest").textContent = "SSB PSYCH PRACTICE"; $("#userBtns").hidden = true; main.innerHTML = viewAuth(); bindAuth(); return; }
    nav.hidden = false; $("#userBtns").hidden = false;
    $("#chest").textContent = `CHEST NO. ${S.user.chest}`;
    document.querySelectorAll(".tab").forEach((b) => b.setAttribute("aria-current", b.dataset.view === (S.view === "report" ? "progress" : S.view) ? "page" : "false"));
    let html = "";
    if (!Store.persistent) html += `<div class="banner">This browser is blocking local storage, so progress will be lost when you close the page.</div>`;
    if (S.view === "today") html += viewToday();
    else if (S.view === "progress") html += viewProgress();
    else if (S.view === "report") html += viewReport();
    else html += viewInterview();
    main.innerHTML = html; bind(); feedbackBanner();
  }

  /* ---------- auth ---------- */
  function viewAuth() {
    const reg = S.authMode === "register";
    return `<div class="auth">
      <div><div class="eyebrow">SSB psychology practice</div><h1>${reg ? "Report at the board" : "Welcome back"}</h1>
      <p class="muted" style="margin:6px 0 0">${reg ? "Register to start your 30-day program. A chest number is allotted to you automatically." : "Log in with your email and password to continue your program."}</p></div>
      <form class="card" id="authForm" novalidate>
        ${reg ? `<div class="field"><label for="aName">Full name</label><input id="aName" required maxlength="40" autocomplete="name"></div>` : ""}
        <div class="field"><label for="aEmail">Email</label><input id="aEmail" type="email" required autocomplete="email"></div>
        <div class="field"><label for="aPw">Password</label><input id="aPw" type="password" required minlength="6" autocomplete="${reg ? "new-password" : "current-password"}"></div>
        ${reg ? `<div class="field"><label for="aEntry">Entry</label><select id="aEntry">${["NDA", "CDS", "AFCAT", "TES", "TGC", "SSC Tech", "NCC Special", "ACC", "Other"].map((e) => `<option>${e}</option>`).join("")}</select></div>` : ""}
        <div class="err" id="aErr" role="alert"></div>
        <button class="btn" type="submit">${reg ? "Register and get chest number" : "Log in"}</button>
        <div class="muted" style="font-size:14px">${reg ? "Already registered?" : "New candidate?"} <button type="button" class="linkbtn" id="aSwitch">${reg ? "Log in" : "Register"}</button></div>
      </form>
      <p class="muted" style="font-size:12px;margin:0">${Store.kind === "supabase" ? "Your progress is saved to your account and available on any device." : "Offline mode: accounts and progress are stored only in this browser on this computer."}</p>
    </div>`;
  }
  function bindAuth() {
    $("#aSwitch").onclick = () => { S.authMode = S.authMode === "login" ? "register" : "login"; render(); };
    $("#authForm").addEventListener("submit", async (e) => {
      e.preventDefault(); const err = $("#aErr"); err.textContent = "";
      const email = $("#aEmail").value.trim(), pw = $("#aPw").value;
      if (!/^\S+@\S+\.\S+$/.test(email)) return (err.textContent = "Enter a valid email address.");
      if (pw.length < 6) return (err.textContent = "Password must be at least 6 characters.");
      try {
        if (S.authMode === "register") {
          const name = $("#aName").value.trim(); if (!name) return (err.textContent = "Enter your name.");
          const res = await Store.register({ name, email, entry: $("#aEntry").value, password: pw });
          if (res && res.needsConfirm) { S.authMode = "login"; render(); $("#aErr").textContent = ""; modal(`<div class="eyebrow">Almost there</div><h2 style="font-size:26px">Confirm your email</h2><p style="margin:0">We sent a link to <b>${esc(email)}</b>. Open it to activate your account, then log in here. Your chest number is allotted on confirmation.</p><div class="row" style="justify-content:flex-end"><button class="btn" id="cOk">OK</button></div>`); $("#cOk").onclick = closeModal; return; }
          S.user = res; await loadUser(); showChest();
        } else { S.user = await Store.login(email, pw); await loadUser(); }
        render();
      } catch (ex) { err.textContent = ex.message || "Something went wrong. Try again."; }
    });
  }
  function showChest() {
    const m = modal(`<div class="eyebrow">Registration complete</div><div>Your chest number is</div><div class="chestbig">${S.user.chest}</div>
      <p class="muted" style="margin:0">Use it like you would at the board. Day 1 of your 30-day program starts today.</p><div class="row" style="justify-content:flex-end"><button class="btn" id="cOk">Start</button></div>`);
    $("#cOk", m).onclick = closeModal;
  }
  async function loadUser() {
    S.sessions = await Store.sessions(S.user.id); S.overall = await Store.overall(S.user.id);
    try { S.fbCount = await Store.feedbackCount(S.user.id); } catch (e) { S.fbCount = 0; }
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
      return `<div class="card test">
        ${done.length ? `<span class="pill ${scoreClass(ls)} done-flag">✓ Done${ls != null ? " · " + r1(ls) : ""}</span>` : ""}
        <div><div class="code">${t.code}</div><div class="tname">${t.name}</div></div>
        ${t.options.length > 1 ? `<div class="seg" role="group" aria-label="${t.code} length">${t.options.map((o) => `<button data-count="${k}:${o}" aria-pressed="${o === cnt}">${o === 12 && k === "tat" ? "11+1" : o}</button>`).join("")}</div>` : ""}
        <div class="spec">${t.spec(cnt)} · ~${t.minutes(cnt)} min · Set ${pad(set)}</div>
        ${suggest === k && !done.length ? `<div class="suggest">${gap >= 999 ? "Not attempted yet" : `Not taken for ${gap} days`}</div>` : ""}
        <button class="btn" data-start="${k}" style="margin-top:auto">${done.length ? "Take again" : "Start " + t.code}</button>
      </div>`;
    }).join("");
    const a = assessed(), lastA = a[a.length - 1];
    return `
    <section class="card"><div class="dayhead">
      <div class="daynum num">${pad(Math.min(n, 99))}<small>DAY</small></div>
      <div><div class="eyebrow">${new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</div>
        <h1 style="font-size:30px;margin-top:4px">${esc(S.user.name)}</h1>
        <div class="muted" style="font-size:14px">${n > PROGRAM_DAYS ? `Program complete · now repeating set ${set}` : `Day ${n} of ${PROGRAM_DAYS}`} · ${esc(S.user.entry)} entry · ${todays.length ? `${todays.length} test${todays.length > 1 ? "s" : ""} today` : "No test taken today yet"} · ${streak()} day streak</div>
        <div class="strip" aria-label="30 day program">${strip}</div></div></div></section>
    <section><div class="section-h" style="margin-bottom:12px"><h2>Today's tests</h2><span class="muted" style="font-size:14px">Day ${n} uses set ${pad(set)} of 30. Timings follow the SSB format.</span></div>
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
    const answered = s.responses.filter((x) => (x || "").trim()).length, C = 2 * Math.PI * 52, ov = A.overall;
    return `<div class="row" style="justify-content:space-between"><button class="btn quiet" data-goto="progress">← All reports</button><span class="eyebrow">Day ${s.day} · Set ${pad(s.set)} · ${fmtDate(s.date)} · ${t.code}</span></div>
    <section class="card report-head">
      <div class="ring"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" fill="none" stroke="var(--line)" stroke-width="10"/><circle cx="60" cy="60" r="52" fill="none" stroke="var(--olive)" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(C * ov) / 10} ${C}"/></svg><div class="score num">${r1(ov)}<small>/ 10</small></div></div>
      <div style="display:flex;flex-direction:column;gap:8px"><div class="eyebrow">Psychologist's assessment</div><h1 style="font-size:30px">${t.name}</h1>
        <div><span class="pill ${scoreClass(ov)}">${A.grade}</span></div><p style="margin:0;max-width:65ch">${esc(A.summary)}</p></div>
    </section>
    <div class="kpis">
      <div class="kpi"><b>${answered}/${items.length}</b><span>Responses completed</span></div>
      <div class="kpi"><b>${Math.round((answered / items.length) * 100)}%</b><span>Completion rate</span></div>
      <div class="kpi"><b>${Math.round(avg(s.responses.filter((x) => (x || "").trim()).map(words)) || 0)}</b><span>Avg words per response</span></div>
      <div class="kpi"><b>${fmtClock(s.timeUsed || 0)}</b><span>Time used</span></div>
    </div>
    <section class="two">
      <div class="card"><h2 style="font-size:22px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px">Improvement areas</h2>
        <ul class="list">${A.improvements.map((i) => `<li class="imp"><b>${esc(i.olq)}</b><span>${esc(i.issue)}</span><div style="color:var(--olive);font-size:14px;margin-top:4px">Do this: ${esc(i.action)}</div></li>`).join("")}</ul></div>
      <div class="card"><h2 style="font-size:22px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px">What worked</h2>
        <ul class="list">${A.strengths.map((x) => `<li class="str">${esc(x)}</li>`).join("")}</ul><p class="muted" style="font-size:14px;margin:14px 0 0">${esc(A.pattern)}</p></div>
    </section>
    <section class="card"><div class="section-h" style="margin-bottom:14px"><h2>OLQs in this test</h2><span class="muted" style="font-size:13px">Brass mark = 7.0</span></div>${olqBlock(A.olq)}</section>
    ${responsesBlock(s, items, A)}`;
  }
  function responsesBlock(s, items, A) {
    const tags = [...new Set(A.items.map((i) => i.tag))]; const f = S.filter;
    const rows = items.map((it, i) => {
      const fb = A.items[i]; if (f !== "all" && fb.tag !== f) return "";
      const ans = (s.responses[i] || "").trim();
      let prompt = s.test === "tat" ? (it.blank ? "Blank slide (own picture)" : `Picture ${i + 1}`) : s.test === "wat" ? esc(it.w).toUpperCase() : esc(it.t);
      const pic = s.test === "tat" && !it.blank ? tatPic(it.id) : null;
      const cls = /Positive|Good/.test(fb.tag) ? "good" : /Neutral|Average/.test(fb.tag) ? "warn" : "bad";
      return `<div class="resp"><div class="idx num">${pad(i + 1)}</div><div>
        <div class="row" style="gap:8px;justify-content:space-between"><span class="prompt">${prompt}</span><span class="pill ${cls}">${esc(fb.tag)} · ${r1(fb.score)}</span></div>
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


  /* ---------- feedback (early-stage testing) ---------- */
  const FB_EMAIL = (window.SSB_CONFIG || {}).feedbackEmail || "";
  const snoozeKey = () => "ssbpb:fbSnooze:" + (S.user ? S.user.id : "");
  function feedbackBanner() {
    const old = $("#fbBar"); if (old) old.remove();
    if (!S.user || RUN || !S.sessions.length || S.fbCount > 0) return;
    let snoozedAt = -1; try { snoozedAt = +(localStorage.getItem(snoozeKey()) ?? -1); } catch (e) {}
    if (S.sessions.length <= snoozedAt) return;       // "Not now" waits until the next test
    const bar = document.createElement("div"); bar.id = "fbBar"; bar.className = "fbbar"; bar.setAttribute("role", "region"); bar.setAttribute("aria-label", "Feedback request");
    bar.innerHTML = `<div><b>You're one of our first candidates.</b> <span class="muted">Tell us what worked and what didn't. It takes a minute and shapes what we build next.</span></div>
      <div class="row" style="gap:8px;flex-wrap:nowrap"><button class="btn quiet" id="fbLater">Not now</button><button class="btn" id="fbGo">Give feedback</button></div>`;
    document.body.appendChild(bar);
    $("#fbLater").onclick = () => { try { localStorage.setItem(snoozeKey(), String(S.sessions.length)); } catch (e) {} bar.remove(); };
    $("#fbGo").onclick = openFeedback;
  }
  function openFeedback() {
    const last = S.sessions[S.sessions.length - 1];
    const lastTxt = last ? `${TESTS[last.test].code} (${last.count} items) on day ${last.day}, score ${r1(last.assessment && last.assessment.overall)}` : "none yet";
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
    let rating = 0;
    m.querySelectorAll("#fbRate button").forEach((b) => b.onclick = () => { rating = +b.dataset.r; m.querySelectorAll("#fbRate button").forEach((x) => { const on = +x.dataset.r === rating; x.setAttribute("aria-pressed", on); x.setAttribute("aria-checked", on); }); });
    $("#fbCancel", m).onclick = closeModal;
    $("#fbForm", m).addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = { rating: rating || null, recommend: $("#fbRec", m).value, liked: $("#fbLiked", m).value.trim(), improve: $("#fbImprove", m).value.trim(), issues: $("#fbIssues", m).value.trim() };
      if (!f.rating && !f.liked && !f.improve && !f.issues) { $("#fbErr", m).textContent = "Pick a rating or write a line before sending."; return; }
      const btn = $("#fbSend", m); btn.disabled = true; btn.textContent = "Sending…";
      const meta = { chest_no: S.user.chest, tests_taken: S.sessions.length, last_test: lastTxt, device: navigator.userAgent.slice(0, 180) };
      let emailed = false;
      if (FB_EMAIL) {
        try {
          const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 12000);
          const r = await fetch(`https://formsubmit.co/ajax/${FB_EMAIL}`, { method: "POST", signal: ctl.signal, headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ _subject: `SSB Psych Lab feedback · Chest ${S.user.chest} · ${f.rating || "-"}/5`, _template: "table", _captcha: "false", _replyto: S.user.email || "",
              Name: S.user.name, "Chest No": S.user.chest, Email: S.user.email || "", Entry: S.user.entry, Rating: f.rating ? f.rating + " / 5" : "-", Recommend: f.recommend || "-",
              "What worked": f.liked || "-", "Improve": f.improve || "-", "Broken / confusing": f.issues || "-", "Tests taken": meta.tests_taken, "Last test": meta.last_test, Device: meta.device }) });
          clearTimeout(t); emailed = r.ok;
        } catch (err) { emailed = false; }
      }
      let saved = false;
      try { await Store.saveFeedback(S.user.id, { ...f, ...meta, emailed }); saved = true; } catch (err) {}
      if (!emailed && !saved) { btn.disabled = false; btn.textContent = "Send feedback"; $("#fbErr", m).textContent = "Couldn't send right now. Check your connection and try again."; return; }
      S.fbCount = (S.fbCount || 0) + 1; closeModal(); const bar = $("#fbBar"); if (bar) bar.remove();
      const ok = modal(`<h2 style="font-size:24px">Thank you!</h2><p style="margin:0">Your feedback reached the team. It goes straight into the next update.</p><div class="row" style="justify-content:flex-end"><button class="btn" id="fbOk">Close</button></div>`);
      $("#fbOk", ok).onclick = closeModal;
    });
  }

  /* ---------- test environment ---------- */
  let RUN = null;
  function envShell(title) {
    $("#layer").innerHTML = `<div class="env" role="dialog" aria-label="${title} test"><div class="env-top"><div><div class="env-title">${title}</div><div class="eyebrow" id="envSub"></div></div><div class="row" style="gap:14px"><div class="clock num" id="clock">--:--</div><button class="btn quiet" id="envExit" style="padding:6px 12px">Exit</button></div></div><div class="progressbar"><b id="pbar" style="width:0"></b></div><div class="env-body"><div class="env-in" id="envIn"></div></div></div>`;
    $("#envExit").onclick = async () => { const was = RUN && RUN.paused; if (RUN) RUN.paused = true; const ok = await confirmBox("Leave this test?", "Your answers so far will be thrown away. At the board the test doesn't stop, so try to finish it.", "Leave test", true); if (ok) endRun(); else if (RUN) RUN.paused = was; };
  }
  function endRun() { if (RUN && RUN.timer) clearInterval(RUN.timer); RUN = null; $("#layer").innerHTML = ""; render(); }
  function startTest(test, count) {
    const n = dayNum(), set = setNum(n);
    RUN = { test, count, set, day: n, items: itemsFor(test, set, count), title: TESTS[test].code, paused: false, i: 0 };
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
    const s = { id: "s" + Date.now().toString(36), test: RUN.test, count: RUN.count, set: RUN.set, day: RUN.day, date: today(), createdAt: Date.now(),
      responses: RUN.responses.map((x) => x || ""), timeUsed: Math.round((Date.now() - RUN.started) / 1000), assessment: stored };
    S.sessions.push(s);
    let saveErr = null;
    try { await Store.saveSession(S.user.id, s); } catch (e) { saveErr = e; }
    RUN = null; $("#layer").innerHTML = ""; S.filter = "all"; setView("report", s.id);
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
  $("#feedbackBtn").addEventListener("click", openFeedback);
  $("#chest").addEventListener("click", () => { if (S.user) openProfile(); });
  $("#logoutBtn").addEventListener("click", async () => { if (await confirmBox("Log out?", "Your progress stays saved for when you log in again.", "Log out")) { Store.logout(); S.user = null; S.sessions = []; S.overall = null; S.authMode = "login"; render(); } });
  (async function boot() {
    readHash();
    $("#main").innerHTML = `<div class="loading"><div class="spinner"></div><div class="muted">Opening your file…</div></div>`;
    try { await Store.init(); S.user = await Store.currentUser(); if (S.user) await loadUser(); }
    catch (e) { S.user = null; }
    if (!S.user) S.authMode = Store.kind === "local" && !localStorage.getItem("ssbpb:users") ? "register" : "login";
    readHash(); render();
  })();
})();
