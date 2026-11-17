/* =====================================================================
   SSB Psych Lab · HQ — admin dashboard
   Reads aggregated stats from Supabase RPCs (admin_overview, admin_users,
   admin_user_detail). Only accounts listed in private.admins can call them.
   Charts are hand-drawn SVG: no chart library, nothing external to load.
   ===================================================================== */
(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (n) => (n == null ? "—" : Number(n).toLocaleString("en-IN"));
  const r1 = (n) => (n == null || isNaN(n) ? "—" : (Math.round(n * 10) / 10).toFixed(1));
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const IST = { timeZone: "Asia/Kolkata" };
  const fmtDay = (d) => new Date(d + (d.length === 10 ? "T00:00:00+05:30" : "")).toLocaleDateString("en-IN", { ...IST, day: "numeric", month: "short" });
  const fmtDT = (d) => (d ? new Date(d).toLocaleString("en-IN", { ...IST, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
  const ago = (d) => {
    if (!d) return "never"; const s = (Date.now() - new Date(d)) / 1000;
    if (s < 60) return "just now"; if (s < 3600) return Math.floor(s / 60) + "m ago"; if (s < 86400) return Math.floor(s / 3600) + "h ago";
    const days = Math.floor(s / 86400); return days === 1 ? "yesterday" : days + "d ago";
  };
  const TESTS = [{ k: "tat", code: "TAT", c: "var(--s1)" }, { k: "wat", code: "WAT", c: "var(--s2)" }, { k: "srt", code: "SRT", c: "var(--s3)" }, { k: "sd", code: "SD", c: "var(--s4)" }];
  const TEST = Object.fromEntries(TESTS.map((t) => [t.k, t]));
  const FACTORS = [
    ["I", ["Effective Intelligence", "Reasoning Ability", "Organising Ability", "Power of Expression"]],
    ["II", ["Social Adaptability", "Cooperation", "Sense of Responsibility"]],
    ["III", ["Initiative", "Self Confidence", "Speed of Decision", "Ability to Influence the Group", "Liveliness"]],
    ["IV", ["Determination", "Courage", "Stamina"]],
  ];
  const OLQS = FACTORS.flatMap((f) => f[1]);
  const SHORT = { "Effective Intelligence": "Eff. Intelligence", "Reasoning Ability": "Reasoning", "Organising Ability": "Organising", "Power of Expression": "Expression", "Social Adaptability": "Social Adapt.", "Cooperation": "Cooperation", "Sense of Responsibility": "Responsibility", "Initiative": "Initiative", "Self Confidence": "Self Confidence", "Speed of Decision": "Speed of Decision", "Ability to Influence the Group": "Influence", "Liveliness": "Liveliness", "Determination": "Determination", "Courage": "Courage", "Stamina": "Stamina" };
  const AV = ["#4c5b2a", "#2a78d6", "#9a6e1f", "#1baf7a", "#6250d6", "#b23a2e", "#c36a2d", "#3b6e8f"];
  const avatar = (u) => `<span class="av" style="background:${AV[(u.chest_no || 0) % AV.length]}" aria-hidden="true">${esc((u.name || "?").trim().charAt(0).toUpperCase())}</span>`;
  const scoreCls = (v) => (v == null ? "neutral" : v >= 7 ? "good" : v >= 5 ? "warn" : "bad");

  const S = { days: 30, tab: "overview", ov: null, users: null, detail: {}, sort: { k: "chest_no", dir: 1 }, q: "", filter: "all", loading: false };

  /* ---------- tooltip (delegated) ---------- */
  const tip = $("#tip");
  document.addEventListener("mousemove", (e) => {
    const t = e.target.closest && e.target.closest("[data-tip]");
    if (!t) { tip.classList.remove("on"); return; }
    tip.innerHTML = t.getAttribute("data-tip"); tip.style.left = e.clientX + "px"; tip.style.top = e.clientY + "px"; tip.classList.add("on");
  });
  document.addEventListener("scroll", () => tip.classList.remove("on"), true);

  /* =================== charts =================== */
  const W = (el) => Math.max(280, Math.round(el.clientWidth || 600));
  const niceMax = (v) => { if (v <= 4) return 4; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; };

  function spark(vals, color = "var(--olive)") {
    if (!vals || vals.length < 2 || !vals.some((v) => v > 0)) return "";
    const w = 84, h = 30, m = Math.max(...vals, 1), step = w / (vals.length - 1);
    const pts = vals.map((v, i) => [i * step, h - 3 - (v / m) * (h - 6)]);
    const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d} L${w} ${h} L0 ${h}Z" fill="${color}" opacity=".12"/><path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${pts[pts.length - 1][0]}" cy="${pts[pts.length - 1][1]}" r="2.6" fill="${color}"/></svg>`;
  }

  function lineChart(el, { labels, series, height = 240, yMax, ref, fmtX = fmtDay }) {
    const w = W(el), h = height, L = 34, R = 14, T = 14, B = 26;
    const max = yMax || niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
    const x = (i) => (labels.length === 1 ? L + (w - L - R) / 2 : L + (i * (w - L - R)) / (labels.length - 1));
    const y = (v) => T + (1 - v / max) * (h - T - B);
    let g = ""; for (let i = 0; i <= 4; i++) { const v = (max / 4) * i; g += `<line class="gl" x1="${L}" x2="${w - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${Number.isInteger(v) ? v : v.toFixed(1)}</text>`; }
    const step = Math.ceil(labels.length / Math.max(2, Math.floor((w - L - R) / 70)));
    const xl = labels.map((l, i) => (i % step === 0 || i === labels.length - 1 ? `<text x="${x(i)}" y="${h - 6}" text-anchor="middle">${esc(fmtX(l))}</text>` : "")).join("");
    let paths = "";
    series.forEach((s, si) => {
      const pts = s.values.map((v, i) => [x(i), y(v)]);
      const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
      if (si === 0 && pts.length > 1) paths += `<path d="${d} L${pts[pts.length - 1][0]} ${y(0)} L${pts[0][0]} ${y(0)}Z" fill="${s.color}" opacity=".12"/>`;
      paths += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"${s.dash ? ' stroke-dasharray="5 4"' : ""}/>`;
      const lp = pts[pts.length - 1]; if (lp) paths += `<circle cx="${lp[0]}" cy="${lp[1]}" r="4.5" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>`;
      if (pts.length <= 40) pts.forEach((p) => (paths += `<circle cx="${p[0]}" cy="${p[1]}" r="2.6" fill="${s.color}" opacity=".85"/>`));
    });
    const refLine = ref != null ? `<line x1="${L}" x2="${w - R}" y1="${y(ref)}" y2="${y(ref)}" stroke="var(--brass)" stroke-dasharray="4 4" stroke-width="1.5"/><text x="${w - R}" y="${y(ref) - 5}" text-anchor="end" style="fill:var(--brass)">${ref}</text>` : "";
    const colW = labels.length > 1 ? (w - L - R) / (labels.length - 1) : w - L - R;
    const hits = labels.map((l, i) => `<rect class="hit" x="${x(i) - colW / 2}" y="${T}" width="${colW}" height="${h - T - B}" data-tip="${esc(`<b>${esc(fmtX(l))}</b><br>` + series.map((s) => `<span style="color:${s.tipColor || "#fff"}">●</span> ${esc(s.name)}: <b>${s.fmt ? s.fmt(s.values[i]) : num(s.values[i])}</b>`).join("<br>"))}"/>`).join("");
    el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(series.map((s) => s.name).join(", "))} over time">${g}${refLine}${paths}${xl}${hits}</svg>`;
  }

  function stackedBars(el, { labels, series, height = 240 }) {
    const w = W(el), h = height, L = 34, R = 10, T = 12, B = 26;
    const totals = labels.map((_, i) => series.reduce((a, s) => a + s.values[i], 0));
    const max = niceMax(Math.max(1, ...totals));
    const y = (v) => T + (1 - v / max) * (h - T - B);
    const bw = (w - L - R) / labels.length, gap = Math.min(4, bw * 0.25), barW = Math.max(2, bw - gap);
    let g = ""; for (let i = 0; i <= 4; i++) { const v = (max / 4) * i; g += `<line class="gl" x1="${L}" x2="${w - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`; }
    let bars = "";
    labels.forEach((l, i) => {
      let acc = 0; const x0 = L + i * bw + gap / 2;
      series.forEach((s, si) => {
        const v = s.values[i]; if (!v) return;
        const y1 = y(acc + v), y0 = y(acc); acc += v;
        const top = series.slice(si + 1).every((t) => !t.values[i]);
        const hgt = Math.max(1, y0 - y1 - (top ? 0 : 2));
        bars += top ? `<path d="M${x0} ${y0} V${y1 + Math.min(4, hgt)} Q${x0} ${y1} ${x0 + Math.min(4, barW / 2)} ${y1} H${x0 + barW - Math.min(4, barW / 2)} Q${x0 + barW} ${y1} ${x0 + barW} ${y1 + Math.min(4, hgt)} V${y0}Z" fill="${s.color}"/>` : `<rect x="${x0}" y="${y1}" width="${barW}" height="${hgt}" fill="${s.color}"/>`;
      });
      bars += `<rect class="hit" x="${L + i * bw}" y="${T}" width="${bw}" height="${h - T - B}" data-tip="${esc(`<b>${esc(fmtDay(l))}</b> · ${totals[i]} test${totals[i] === 1 ? "" : "s"}<br>` + series.filter((s) => s.values[i]).map((s) => `${esc(s.name)}: <b>${s.values[i]}</b>`).join(" · "))}"/>`;
    });
    const step = Math.ceil(labels.length / Math.max(2, Math.floor((w - L - R) / 60)));
    const xl = labels.map((l, i) => (i % step === 0 || i === labels.length - 1 ? `<text x="${L + i * bw + bw / 2}" y="${h - 6}" text-anchor="middle">${esc(fmtDay(l))}</text>` : "")).join("");
    el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Tests per day by test type">${g}${bars}${xl}</svg>`;
  }

  function donut(el, items, center) {
    const total = items.reduce((a, b) => a + b.value, 0);
    const size = 170, r = 70, sw = 24, C = 2 * Math.PI * r;
    let off = 0, arcs = "";
    if (!total) arcs = `<circle cx="85" cy="85" r="${r}" fill="none" stroke="var(--grid)" stroke-width="${sw}"/>`;
    items.forEach((it) => {
      if (!it.value) return;
      const len = (it.value / total) * C, gapLen = items.filter((x) => x.value).length > 1 ? 2 : 0;
      arcs += `<circle cx="85" cy="85" r="${r}" fill="none" stroke="${it.color}" stroke-width="${sw}" stroke-dasharray="${Math.max(0.5, len - gapLen)} ${C}" stroke-dashoffset="${-off}" transform="rotate(-90 85 85)" data-tip="${esc(`${esc(it.label)}: <b>${num(it.value)}</b> (${pct(it.value, total)}%)`)}" style="cursor:pointer"/>`;
      off += len;
    });
    const list = items.map((it) => `<div><i style="background:${it.color}"></i><span>${esc(it.label)}</span><span class="n">${num(it.value)}</span><span class="p">${total ? pct(it.value, total) + "%" : "—"}</span></div>`).join("");
    el.innerHTML = `<div class="donutwrap"><div class="viz"><svg viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(center ? center.label : "Breakdown")}">${arcs}<text x="85" y="84" text-anchor="middle" style="font-family:var(--display);font-size:30px;font-weight:700;fill:var(--ink)">${center ? esc(center.value) : num(total)}</text><text x="85" y="104" text-anchor="middle">${esc(center ? center.label : "total")}</text></svg></div><div class="dlist">${list}</div></div>`;
  }

  function vbars(el, items, { height = 200, color = "var(--olive)", fmt = num } = {}) {
    const w = W(el), h = height, L = 30, R = 8, T = 18, B = 34;
    const max = niceMax(Math.max(1, ...items.map((i) => i.value)));
    const y = (v) => T + (1 - v / max) * (h - T - B);
    const bw = (w - L - R) / items.length, barW = Math.min(64, bw * 0.62);
    let g = ""; for (let i = 0; i <= 4; i++) { const v = (max / 4) * i; g += `<line class="gl" x1="${L}" x2="${w - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${Number.isInteger(v) ? v : v.toFixed(1)}</text>`; }
    const bars = items.map((it, i) => {
      const cx = L + i * bw + bw / 2, x0 = cx - barW / 2, top = y(it.value), base = y(0), rr = Math.min(4, (base - top) / 2);
      const shape = it.value > 0 ? `<path d="M${x0} ${base} V${top + rr} Q${x0} ${top} ${x0 + rr} ${top} H${x0 + barW - rr} Q${x0 + barW} ${top} ${x0 + barW} ${top + rr} V${base}Z" fill="${it.color || color}"/>` : "";
      return `${shape}<text x="${cx}" y="${top - 5}" text-anchor="middle" style="fill:var(--ink);font-weight:700">${it.value ? fmt(it.value) : ""}</text><text x="${cx}" y="${h - 14}" text-anchor="middle">${esc(it.label)}</text>${it.sub ? `<text x="${cx}" y="${h - 2}" text-anchor="middle" style="font-size:10px">${esc(it.sub)}</text>` : ""}<rect class="hit" x="${L + i * bw}" y="${T}" width="${bw}" height="${h - T - B}" data-tip="${esc(`${esc(it.tip || it.label)}: <b>${fmt(it.value)}</b>`)}"/>`;
    }).join("");
    el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Bar chart">${g}${bars}</svg>`;
  }

  function hbars(el, items, { color = "var(--olive)", max } = {}) {
    const m = max || Math.max(1, ...items.map((i) => i.value));
    el.innerHTML = `<div class="funnel">${items.map((it) => `<div class="frow" data-tip="${esc(`${esc(it.label)}: <b>${num(it.value)}</b>`)}"><span>${esc(it.label)}</span><span class="fbar"><b style="width:${(it.value / m) * 100}%;background:${it.color || color}"></b></span><span class="fn">${num(it.value)}</span></div>`).join("")}</div>`;
  }

  function radar(el, vals, compare) {
    const VW = 560, VH = 420, cx = 280, cy = 208, R = 138, n = OLQS.length;
    const pt = (i, v) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / n; return [cx + Math.cos(a) * R * (v / 10), cy + Math.sin(a) * R * (v / 10)]; };
    let rings = ""; [2, 4, 6, 8, 10].forEach((v) => (rings += `<polygon points="${OLQS.map((_, i) => pt(i, v).join(",")).join(" ")}" fill="none" stroke="var(--grid)"/>`));
    rings += `<polygon points="${OLQS.map((_, i) => pt(i, 7).join(",")).join(" ")}" fill="none" stroke="var(--brass)" stroke-dasharray="4 4" stroke-width="1.5"/>`;
    const spokes = OLQS.map((_, i) => { const p = pt(i, 10); return `<line x1="${cx}" y1="${cy}" x2="${p[0]}" y2="${p[1]}" stroke="var(--grid)"/>`; }).join("");
    const labels = OLQS.map((o, i) => { const p = pt(i, 11.6); const anchor = Math.abs(p[0] - cx) < 12 ? "middle" : p[0] > cx ? "start" : "end"; return `<text x="${p[0]}" y="${p[1] + 4}" text-anchor="${anchor}" style="font-size:10.5px">${esc(SHORT[o])}</text>`; }).join("");
    const poly = (v, color, fill, dash) => { const has = OLQS.some((o) => v[o] != null); if (!has) return ""; return `<polygon points="${OLQS.map((o, i) => pt(i, v[o] || 0).join(",")).join(" ")}" fill="${fill}" stroke="${color}" stroke-width="2" stroke-linejoin="round"${dash ? ' stroke-dasharray="5 4"' : ""}/>`; };
    const dots = OLQS.map((o, i) => { if (vals[o] == null) return ""; const p = pt(i, vals[o]); return `<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="var(--olive)" stroke="var(--surface)" stroke-width="2"/><circle cx="${p[0]}" cy="${p[1]}" r="12" class="hit" data-tip="${esc(`${esc(o)}: <b>${r1(vals[o])}</b>${compare && compare[o] != null ? ` · all candidates ${r1(compare[o])}` : ""}`)}"/>`; }).join("");
    el.innerHTML = `<svg viewBox="0 0 ${VW} ${VH}" style="max-width:560px;margin:0 auto" role="img" aria-label="OLQ radar chart">${rings}${spokes}${compare ? poly(compare, "var(--muted)", "none", true) : ""}${poly(vals, "var(--olive)", "color-mix(in srgb, var(--olive) 22%, transparent)")}${dots}${labels}</svg>`;
  }

  function heatmap(el, cells) {
    const grid = {}; let max = 0; cells.forEach((c) => { grid[c.dow + "-" + c.hour] = c.n; max = Math.max(max, c.n); });
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    let h = `<div></div>${Array.from({ length: 24 }, (_, i) => `<div class="hh">${i % 3 === 0 ? i : ""}</div>`).join("")}`;
    days.forEach((d, di) => {
      h += `<div class="hl">${d}</div>`;
      for (let hr = 0; hr < 24; hr++) { const n = grid[di + 1 + "-" + hr] || 0; const a = n ? 0.18 + 0.82 * (n / max) : 0;
        h += `<div class="c" style="${n ? `background:color-mix(in srgb, var(--olive) ${Math.round(a * 100)}%, var(--grid))` : ""}" data-tip="${esc(`${d} ${String(hr).padStart(2, "0")}:00–${String(hr + 1).padStart(2, "0")}:00 IST · <b>${n}</b> test${n === 1 ? "" : "s"}`)}"></div>`; }
    });
    el.innerHTML = `<div class="heat" role="img" aria-label="Tests by weekday and hour">${h}</div>`;
  }

  /* =================== data =================== */
  async function loadOverview() { S.ov = await Store.rpc("admin_overview", { days: S.days }); }
  async function loadUsers() { S.users = await Store.rpc("admin_users"); }
  async function loadDetail(id) { if (!S.detail[id]) S.detail[id] = await Store.rpc("admin_user_detail", { uid: id }); return S.detail[id]; }

  /* =================== views =================== */
  function tiles(t, daily) {
    const d = (k) => daily.map((x) => x[k]);
    const tests = daily.map((x) => x.tat + x.wat + x.srt + x.sd);
    const T = [
      { lbl: "Impressions", val: num(t.views), meta: `<b>${num(t.views_today)}</b> today · ${num(t.visitors)} unique visitors`, sp: spark(d("views")) },
      { lbl: "Candidates", val: num(t.candidates), meta: `<b>+${num(t.new_7d)}</b> in the last 7 days`, sp: spark(d("signups"), "var(--s1)") },
      { lbl: "Active", val: num(t.active_7d), meta: `<b>${num(t.active_today)}</b> today · last 7 days` },
      { lbl: "Tests taken", val: num(t.tests), meta: `<b>${num(t.tests_today)}</b> today · ${num(t.minutes)} min practised`, sp: spark(tests, "var(--s2)") },
      { lbl: "Avg OLQ score", val: r1(t.avg_score), meta: `${t.completion ?? "—"}% of items answered` },
      { lbl: "Feedback", val: t.avg_rating != null ? `${Number(t.avg_rating).toFixed(1)}<small style="font-size:18px;color:var(--muted)">/5</small>` : "—", meta: `${num(t.feedback)} responses` },
    ];
    return `<section class="tiles" aria-label="Key numbers">${T.map((x, i) => `<div class="tile ${i === 0 ? "accent" : ""}" style="animation-delay:${i * 40}ms"><span class="lbl">${x.lbl}</span><span class="val">${x.val}</span><span class="meta">${x.meta}</span>${x.sp || ""}</div>`).join("")}</section>`;
  }
  const panel = (id, title, sub, cls, extra = "") => `<section class="panel ${cls}"><div class="panel-h"><h3>${title}</h3>${extra}</div>${sub ? `<div class="sub">${sub}</div>` : ""}<div id="${id}" class="viz"></div></section>`;

  function viewOverview() {
    const o = S.ov; if (!o) return `<div class="empty">Loading…</div>`;
    return `${tiles(o.totals, o.daily)}
    <div class="hqgrid">
      ${panel("cImp", "Site impressions", `Page views and unique visitors per day · last ${S.days} days`, "span-8", `<div class="legend"><span><i style="background:var(--olive)"></i>Page views</span><span><i style="background:var(--s1)"></i>Unique visitors</span></div>`)}
      ${panel("cMix", "Tests by type", "All tests taken so far", "span-4")}
      ${panel("cDaily", "Tests per day", `Stacked by test type · last ${S.days} days`, "span-8", `<div class="legend">${TESTS.map((t) => `<span><i style="background:${t.c}"></i>${t.code}</span>`).join("")}</div>`)}
      ${panel("cFunnel", "Candidate journey", "From first visit to regular practice", "span-4")}
      ${panel("cRadar", "Average OLQ profile", "All candidates · dashed brass ring = 7.0 (recommendable)", "span-6")}
      <section class="panel span-6"><div class="panel-h"><h3>Score distribution</h3></div><div class="sub">Every test's overall score, by band</div><div id="cBuckets" class="viz"></div>
        <div class="panel-h" style="margin-top:6px"><h3 style="font-size:15px">Average score by test</h3></div><div id="cByTest" class="viz"></div></section>
      ${panel("cHeat", "When candidates practise", "Tests started, by weekday and hour (IST)", "span-6")}
      ${panel("cWeak", "Weakest OLQs across candidates", "Lowest average first, where coaching matters most", "span-6")}
      ${panel("cDev", "Devices", "Unique visitors", "span-4")}
      ${panel("cEntry", "Entry type", "Registered candidates", "span-4")}
      ${panel("cPages", "Pages viewed", "Impressions by screen", "span-4")}
    </div>`;
  }
  function drawOverview() {
    const o = S.ov; if (!o) return;
    const labels = o.daily.map((d) => d.date);
    lineChart($("#cImp"), { labels, series: [{ name: "Page views", color: "var(--olive)", tipColor: "#a3b66c", values: o.daily.map((d) => d.views) }, { name: "Unique visitors", color: "var(--s1)", tipColor: "#7fb2ee", values: o.daily.map((d) => d.visitors) }] });
    donut($("#cMix"), TESTS.map((t) => ({ label: t.code, value: (o.by_test[t.k] || {}).n || 0, color: t.c })), { value: num(o.totals.tests), label: "tests" });
    stackedBars($("#cDaily"), { labels, series: TESTS.map((t) => ({ name: t.code, color: t.c, values: o.daily.map((d) => d[t.k]) })) });
    const f = o.funnel;
    hbars($("#cFunnel"), [{ label: "Visitors", value: f.visitors }, { label: "Registered", value: f.registered }, { label: "Took 1+ test", value: f.took_1 }, { label: "Took 5+ tests", value: f.took_5 }, { label: "Active 3+ days", value: f.active_3d }], { max: Math.max(f.visitors, f.registered, 1) });
    radar($("#cRadar"), o.olq);
    const B = ["Weak", "Below average", "Average", "Recommendable", "Strong"], BC = ["color-mix(in srgb, var(--olive) 30%, var(--grid))", "color-mix(in srgb, var(--olive) 50%, var(--grid))", "color-mix(in srgb, var(--olive) 70%, var(--grid))", "color-mix(in srgb, var(--olive) 88%, var(--grid))", "var(--olive)"];
    vbars($("#cBuckets"), B.map((b, i) => ({ label: b === "Below average" ? "Below avg" : b === "Recommendable" ? "Recomm." : b, sub: ["<4", "4–5.4", "5.5–6.9", "7–7.9", "8+"][i], tip: b, value: o.score_buckets[b] || 0, color: BC[i] })), { height: 190 });
    vbars($("#cByTest"), TESTS.map((t) => ({ label: t.code, value: (o.by_test[t.k] || {}).avg || 0, color: t.c, sub: `${(o.by_test[t.k] || {}).n || 0} tests` })), { height: 170, fmt: (v) => r1(v) });
    heatmap($("#cHeat"), o.heatmap);
    const weak = OLQS.filter((q) => o.olq[q] != null).sort((a, b) => o.olq[a] - o.olq[b]).slice(0, 6);
    if (weak.length) hbars($("#cWeak"), weak.map((q) => ({ label: SHORT[q], value: o.olq[q] })), { max: 10, color: "var(--brass)" }); else $("#cWeak").innerHTML = `<div class="empty">Appears after the first tests.</div>`;
    const devC = { mobile: "var(--s1)", desktop: "var(--s2)", tablet: "var(--s3)", unknown: "var(--grid)" };
    donut($("#cDev"), Object.entries(o.devices).map(([k, v]) => ({ label: k[0].toUpperCase() + k.slice(1), value: v, color: devC[k] || "var(--s4)" })), { value: num(o.totals.visitors), label: "visitors" });
    const EC = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)"]; const ent = Object.entries(o.entries).sort((a, b) => b[1] - a[1]);
    const entItems = ent.slice(0, 3).map(([k, v], i) => ({ label: k, value: v, color: EC[i] })); const rest = ent.slice(3).reduce((a, b) => a + b[1], 0); if (rest) entItems.push({ label: "Other", value: rest, color: EC[3] });
    donut($("#cEntry"), entItems, { value: num(o.totals.candidates), label: "candidates" });
    const PN = { today: "Today", progress: "Progress", report: "Reports", interview: "Interview", auth: "Login / register" };
    const pages = Object.entries(o.views_by_page).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: PN[k] || k, value: v }));
    if (pages.length) hbars($("#cPages"), pages); else $("#cPages").innerHTML = `<div class="empty">Impressions start recording from this update.</div>`;
  }

  function viewCandidates() {
    if (!S.users) return `<div class="empty">Loading candidates…</div>`;
    const now = Date.now();
    let list = S.users.filter((u) => {
      const q = S.q.trim().toLowerCase();
      if (q && !(`${u.name} ${u.email} ${u.chest_no} ${u.entry}`.toLowerCase().includes(q))) return false;
      const last = u.last_test ? new Date(u.last_test).getTime() : 0;
      if (S.filter === "active" && now - last > 7 * 864e5) return false;
      if (S.filter === "inactive" && (u.tests === 0 || now - last <= 3 * 864e5)) return false;
      if (S.filter === "new" && u.tests > 0) return false;
      return true;
    });
    const k = S.sort.k, dir = S.sort.dir;
    list.sort((a, b) => { const va = a[k], vb = b[k]; if (va == null && vb == null) return 0; if (va == null) return 1; if (vb == null) return -1; return (va > vb ? 1 : va < vb ? -1 : 0) * dir; });
    const cnt = (f) => S.users.filter(f).length;
    const th = (key, label) => `<th scope="col" data-sort="${key}" aria-sort="${S.sort.k === key ? (S.sort.dir > 0 ? "ascending" : "descending") : "none"}">${label}</th>`;
    const rows = list.map((u) => {
      const tot = u.tests || 0; const mix = TESTS.map((t) => (u[t.k] ? `<i style="width:${(u[t.k] / tot) * 100}%;background:${t.c}" title="${t.code}: ${u[t.k]}"></i>` : "")).join("");
      const last = u.last_test ? new Date(u.last_test).getTime() : 0; const live = last && now - last < 864e5 ? "var(--good)" : last && now - last < 3 * 864e5 ? "var(--warn)" : "var(--line)";
      return `<tr class="crow" data-uid="${u.id}" tabindex="0"><td><span class="chip">#${u.chest_no}</span></td>
        <td><div class="who">${avatar(u)}<div><b>${esc(u.name || "—")}</b><small>${esc(u.email || "")}</small></div></div></td>
        <td>${esc(u.entry)}</td><td>${num(tot)}</td><td><div class="mix" data-tip="${esc(TESTS.map((t) => `${t.code}: <b>${u[t.k] || 0}</b>`).join(" · "))}">${mix}</div></td>
        <td>${u.avg != null ? `<span class="pill ${scoreCls(u.avg)}">${r1(u.avg)}</span>` : "—"}</td><td>${u.best != null ? r1(u.best) : "—"}</td>
        <td>${num(u.days_active)}</td><td><span class="dot" style="background:${live}"></span>${ago(u.last_test)}</td><td>${u.rating != null ? `<span class="stars">★</span> ${r1(u.rating)}` : "—"}</td></tr>`;
    }).join("");
    return `<section class="panel" style="gap:14px">
      <div class="panel-h"><h3>Candidates</h3><span class="updated">${S.users.length} registered</span></div>
      <div class="toolbar"><input class="search" id="q" type="search" placeholder="Search name, email, chest no. or entry" value="${esc(S.q)}" aria-label="Search candidates">
        <div class="filters" role="group" aria-label="Filter">${[["all", "All", S.users.length], ["active", "Active 7d", cnt((u) => u.last_test && now - new Date(u.last_test) < 7 * 864e5)], ["inactive", "Gone quiet 3d+", cnt((u) => u.tests > 0 && now - new Date(u.last_test) > 3 * 864e5)], ["new", "No test yet", cnt((u) => !u.tests)]].map(([k, l, n]) => `<button class="chipbtn" data-filter="${k}" aria-pressed="${S.filter === k}">${l} (${n})</button>`).join("")}</div></div>
      <div class="tablewrap"><table class="ctable"><thead><tr>${th("chest_no", "Chest")}${th("name", "Candidate")}${th("entry", "Entry")}${th("tests", "Tests")}<th>Mix</th>${th("avg", "Avg")}${th("best", "Best")}${th("days_active", "Days")}${th("last_test", "Last test")}${th("rating", "Rating")}</tr></thead>
      <tbody>${rows || `<tr><td colspan="10"><div class="empty">No candidates match.</div></td></tr>`}</tbody></table></div>
      <div class="note">Click a candidate for their full profile. Green dot = practised in the last 24 h, amber = last 3 days.</div></section>`;
  }

  function viewFeedback() {
    const o = S.ov; if (!o) return `<div class="empty">Loading…</div>`;
    const rec = o.recommend || {}; const recTotal = Object.values(rec).reduce((a, b) => a + b, 0);
    return `<section class="tiles"><div class="tile accent"><span class="lbl">Responses</span><span class="val">${num(o.totals.feedback)}</span></div>
      <div class="tile"><span class="lbl">Average rating</span><span class="val">${o.totals.avg_rating != null ? Number(o.totals.avg_rating).toFixed(1) : "—"}<small style="font-size:18px;color:var(--muted)">/5</small></span></div>
      <div class="tile"><span class="lbl">Would recommend</span><span class="val">${recTotal ? pct(rec.Yes || 0, recTotal) + "%" : "—"}</span><span class="meta">answered "Yes"</span></div></section>
    <div class="hqgrid">${panel("cRat", "Ratings", "How useful candidates found it", "span-6")}${panel("cRec", "Would recommend", "To a friend preparing for SSB", "span-6")}
      <section class="panel span-12"><div class="panel-h"><h3>Latest feedback</h3><span class="updated">newest first · last 12</span></div>
        ${o.latest_feedback.length ? o.latest_feedback.map(fbCard).join("") : `<div class="empty">No feedback yet.</div>`}</section></div>`;
  }
  const fbCard = (f) => `<div class="fbcard"><div class="h">${f.chest_no != null ? `<span class="chip">#${f.chest_no}</span>` : ""}<b style="color:var(--ink)">${esc(f.name || "")}</b>${f.rating ? `<span class="stars">${"★".repeat(f.rating)}${"☆".repeat(5 - f.rating)}</span>` : ""}${f.recommend ? `<span>Recommend: ${esc(f.recommend)}</span>` : ""}<span>${fmtDT(f.created_at)}</span></div>
    ${f.liked ? `<div><b>Worked:</b> ${esc(f.liked)}</div>` : ""}${f.improve ? `<div><b>Improve:</b> ${esc(f.improve)}</div>` : ""}${f.issues ? `<div><b>Issues:</b> ${esc(f.issues)}</div>` : ""}${!f.liked && !f.improve && !f.issues ? `<div class="muted">Rating only</div>` : ""}</div>`;
  function drawFeedback() {
    const o = S.ov; if (!o) return;
    vbars($("#cRat"), [1, 2, 3, 4, 5].map((n) => ({ label: "★".repeat(n), value: o.ratings[n] || 0, color: n >= 4 ? "var(--olive)" : n === 3 ? "var(--brass)" : "var(--bad)", tip: `${n} star${n > 1 ? "s" : ""}` })), { height: 200 });
    const RC = { Yes: "var(--s3)", Maybe: "var(--s4)", No: "var(--s2)" };
    donut($("#cRec"), ["Yes", "Maybe", "No"].map((k) => ({ label: k, value: (o.recommend || {})[k] || 0, color: RC[k] })), { value: num(Object.values(o.recommend || {}).reduce((a, b) => a + b, 0)), label: "answers" });
  }

  /* ---------- per-candidate drawer ---------- */
  async function openUser(id) {
    const u = (S.users || []).find((x) => x.id === id); if (!u) return;
    const dr = $("#drawer"); $("#scrim").hidden = false; dr.classList.add("open"); dr.setAttribute("aria-hidden", "false");
    dr.innerHTML = `<div class="dh">${avatar(u)}<div style="flex:1;min-width:0"><div class="eyebrow">Chest No. ${u.chest_no} · ${esc(u.entry)}</div><h2>${esc(u.name)}</h2><div class="note">${esc(u.email)}</div></div><button class="btn quiet" id="drClose" aria-label="Close">✕</button></div><div class="db"><div class="empty">Loading…</div></div>`;
    $("#drClose").onclick = closeUser; $("#drClose").focus();
    let d; try { d = await loadDetail(id); } catch (e) { $(".db", dr).innerHTML = `<div class="empty">Couldn't load this candidate: ${esc(e.message)}</div>`; return; }
    const ss = d.sessions;
    $(".db", dr).innerHTML = `
      <div class="tiles">
        <div class="tile accent"><span class="lbl">Tests</span><span class="val">${num(u.tests)}</span><span class="meta">${num(u.minutes)} min practised</span></div>
        <div class="tile"><span class="lbl">Avg score</span><span class="val">${r1(u.avg)}</span><span class="meta">best ${u.best != null ? r1(u.best) : "—"}</span></div>
        <div class="tile"><span class="lbl">Days active</span><span class="val">${num(u.days_active)}</span><span class="meta">joined ${fmtDT(u.joined)}</span></div>
        <div class="tile"><span class="lbl">Last seen</span><span class="val" style="font-size:24px;padding-top:8px">${ago(u.last_test || u.last_sign_in)}</span><span class="meta">${num(d.views)} page views</span></div>
      </div>
      <section class="panel"><div class="panel-h"><h3>Score per test</h3><div class="legend">${TESTS.map((t) => `<span><i style="background:${t.c}"></i>${t.code}</span>`).join("")}</div></div><div class="sub">Overall score of each test in order · dashed = 7.0</div><div id="uTrend" class="viz"></div></section>
      <div class="hqgrid">
        <section class="panel span-7"><div class="panel-h"><h3>OLQ profile</h3><div class="legend"><span><i style="background:var(--olive)"></i>${esc(u.name.split(" ")[0])}</span><span><i style="background:var(--muted)"></i>All candidates</span></div></div><div id="uRadar" class="viz"></div></section>
        <section class="panel span-5"><h3>Test mix</h3><div id="uMix" class="viz"></div><h3 style="font-size:15px;margin-top:6px">Recurring weak areas</h3><div id="uImp" class="viz"></div></section>
      </div>
      <section class="panel"><h3>All tests</h3><div class="tablewrap" style="max-height:none"><table class="ctable"><thead><tr><th>Date</th><th>Day</th><th>Test</th><th>Answered</th><th>Score</th><th>Grade</th><th>Time</th></tr></thead><tbody>
        ${ss.slice().reverse().map((s) => `<tr><td>${fmtDT(s.created_at)}</td><td>D${s.day} · set ${s.set}</td><td><span class="dot" style="background:${TEST[s.test].c}"></span>${TEST[s.test].code}</td><td>${s.answered}/${s.count} <span class="note">(${pct(s.answered, s.count)}%)</span></td><td><span class="pill ${scoreCls(s.overall)}">${r1(s.overall)}</span></td><td>${esc(s.grade || "")}</td><td>${Math.floor(s.time_used / 60)}:${String(s.time_used % 60).padStart(2, "0")}</td></tr>`).join("") || `<tr><td colspan="7"><div class="empty">No tests yet.</div></td></tr>`}</tbody></table></div></section>
      <section class="panel"><h3>Feedback</h3>${d.feedback.length ? d.feedback.map((f) => fbCard({ ...f, name: "" })).join("") : `<div class="empty">No feedback from this candidate.</div>`}</section>`;
    if (ss.length) {
      const el = $("#uTrend"); const w = W(el), h = 220, L = 34, R = 14, T = 14, B = 26;
      const x = (i) => (ss.length === 1 ? L + (w - L - R) / 2 : L + (i * (w - L - R)) / (ss.length - 1)), y = (v) => T + (1 - v / 10) * (h - T - B);
      let g = ""; [0, 2, 4, 6, 8, 10].forEach((v) => (g += `<line class="gl" x1="${L}" x2="${w - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`));
      const pts = ss.map((s, i) => [x(i), y(+s.overall || 0)]);
      const path = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
      const step = Math.ceil(ss.length / 8);
      el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Score per test">${g}<line x1="${L}" x2="${w - R}" y1="${y(7)}" y2="${y(7)}" stroke="var(--brass)" stroke-dasharray="4 4" stroke-width="1.5"/><path d="${path}" fill="none" stroke="var(--muted)" stroke-width="1.5" opacity=".6"/>${pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="5.5" fill="${TEST[ss[i].test].c}" stroke="var(--surface)" stroke-width="2"/><circle class="hit" cx="${p[0]}" cy="${p[1]}" r="13" data-tip="${esc(`<b>${TEST[ss[i].test].code}</b> · ${fmtDT(ss[i].created_at)}<br>Score <b>${r1(ss[i].overall)}</b> · ${ss[i].answered}/${ss[i].count} answered`)}"/>`).join("")}${ss.map((s, i) => (i % step === 0 || i === ss.length - 1 ? `<text x="${x(i)}" y="${h - 6}" text-anchor="middle">#${i + 1}</text>` : "")).join("")}</svg>`;
    } else $("#uTrend").innerHTML = `<div class="empty">No tests yet.</div>`;
    radar($("#uRadar"), d.olq, S.ov ? S.ov.olq : null);
    donut($("#uMix"), TESTS.map((t) => ({ label: t.code, value: u[t.k] || 0, color: t.c })), { value: num(u.tests), label: "tests" });
    const imp = Object.entries(d.improvements).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (imp.length) hbars($("#uImp"), imp.map(([k, v]) => ({ label: SHORT[k] || k, value: v })), { color: "var(--brass)" }); else $("#uImp").innerHTML = `<div class="empty">None yet.</div>`;
  }
  function closeUser() { const dr = $("#drawer"); dr.classList.remove("open"); dr.setAttribute("aria-hidden", "true"); $("#scrim").hidden = true; }
  $("#scrim").addEventListener("click", closeUser);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeUser(); });

  /* =================== shell =================== */
  function render() {
    document.querySelectorAll("#hqNav .tab").forEach((b) => b.setAttribute("aria-current", b.dataset.tab === S.tab ? "page" : "false"));
    $("#range").style.visibility = S.tab === "candidates" ? "hidden" : "visible";
    const m = $("#hq");
    const stamp = S.ov ? `<div class="updated">Updated ${fmtDT(S.ov.generated_at)} · all times IST</div>` : "";
    m.innerHTML = (S.tab === "overview" ? viewOverview() : S.tab === "candidates" ? viewCandidates() : viewFeedback()) + stamp;
    if (S.tab === "overview") drawOverview();
    if (S.tab === "feedback") drawFeedback();
    if (S.tab === "candidates") bindCandidates();
  }
  function bindCandidates() {
    const q = $("#q"); if (q) q.addEventListener("input", () => { S.q = q.value; const pos = q.selectionStart; render(); const nq = $("#q"); nq.focus(); nq.setSelectionRange(pos, pos); });
    document.querySelectorAll("[data-filter]").forEach((b) => (b.onclick = () => { S.filter = b.dataset.filter; render(); }));
    document.querySelectorAll("th[data-sort]").forEach((th) => (th.onclick = () => { const k = th.dataset.sort; S.sort = { k, dir: S.sort.k === k ? -S.sort.dir : k === "name" || k === "chest_no" || k === "entry" ? 1 : -1 }; render(); }));
    document.querySelectorAll("tr[data-uid]").forEach((tr) => { tr.onclick = () => openUser(tr.dataset.uid); tr.onkeydown = (e) => { if (e.key === "Enter") openUser(tr.dataset.uid); }; });
  }
  async function refresh(all) {
    const btn = $("#refresh"); btn.disabled = true;
    try { await Promise.all([loadOverview(), all || !S.users ? loadUsers() : null]); S.detail = {}; render(); }
    catch (e) { $("#hq").innerHTML = `<div class="panel"><h3>Couldn't load the dashboard</h3><p class="muted" style="margin:0">${esc(e.message)}</p></div>`; }
    finally { btn.disabled = false; }
  }
  document.querySelectorAll("#hqNav .tab").forEach((b) => (b.onclick = () => { S.tab = b.dataset.tab; render(); window.scrollTo(0, 0); }));
  document.querySelectorAll("#range button").forEach((b) => (b.onclick = async () => { S.days = +b.dataset.days; document.querySelectorAll("#range button").forEach((x) => x.setAttribute("aria-pressed", x === b)); await loadOverview().catch(() => {}); render(); }));
  $("#refresh").onclick = () => refresh(true);
  let rz; window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { if (S.tab !== "candidates") render(); }, 150); });

  function showLogin(msg) {
    $("#hqActions").hidden = true; $("#hqNav").hidden = true;
    $("#hq").innerHTML = `<div class="loginbox"><div class="eyebrow">Restricted</div><h1 style="font-size:40px;text-transform:uppercase;letter-spacing:.06em">HQ login</h1>
      <p class="muted" style="margin:6px 0 14px">${msg || "Admin access only. Use your SSB Psych Lab admin account."}</p>
      <form class="card" id="lf" style="display:flex;flex-direction:column;gap:12px"><div class="field"><label for="le">Email</label><input id="le" type="email" required autocomplete="email"></div>
      <div class="field"><label for="lp">Password</label><input id="lp" type="password" required autocomplete="current-password"></div><div class="err" id="lerr" role="alert"></div><button class="btn" type="submit">Log in</button></form>
      <p class="note" style="margin-top:12px"><a href="./">← Back to SSB Psych Lab</a></p></div>`;
    $("#lf").addEventListener("submit", async (e) => {
      e.preventDefault(); $("#lerr").textContent = "";
      try { await Store.login($("#le").value, $("#lp").value); boot(); } catch (err) { $("#lerr").textContent = err.message; }
    });
  }
  async function boot() {
    if (Store.kind !== "supabase") { $("#hq").innerHTML = `<div class="panel"><h3>Supabase isn't configured</h3><p class="muted" style="margin:0">The admin dashboard reads live data from Supabase. Fill in js/config.js.</p></div>`; return; }
    await Store.init();
    const me = await Store.currentUser();
    if (!me) return showLogin();
    let ok = false; try { ok = await Store.rpc("is_admin"); } catch (e) {}
    if (!ok) { Store.logout(); return showLogin(`<b>${esc(me.email)}</b> isn't an admin account. Log in with the admin account.`); }
    $("#hqActions").hidden = false; $("#hqNav").hidden = false;
    $("#hq").innerHTML = `<div class="loading"><div class="spinner"></div><div class="muted">Loading HQ…</div></div>`;
    await refresh(true);
  }
  boot();
})();
