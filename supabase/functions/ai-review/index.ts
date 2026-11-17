// SSB Psych Lab — Psychologist Review (AI) for single tests and the full psych battery.
// Secrets: GROQ_API_KEY (required). Optional: GROQ_MODELS (comma list), AI_TOKEN_BUDGET (tokens/day, default 400000),
// AI_SINGLE_PER_DAY (default 3), AI_BATTERY_PER_DAY (default 1).
// Limits: per candidate per UTC day, plus a site-wide token budget (singles stop at 70% so batteries keep headroom).
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GROQ_KEY = Deno.env.get("GROQ_API_KEY") || "";
const MODELS = (Deno.env.get("GROQ_MODELS") || "openai/gpt-oss-120b,openai/gpt-oss-20b,qwen/qwen3-32b,llama-3.3-70b-versatile").split(",").map((s) => s.trim()).filter(Boolean);
const BUDGET = Number(Deno.env.get("AI_TOKEN_BUDGET") || 400000);
const SINGLE_MAX = Number(Deno.env.get("AI_SINGLE_PER_DAY") || 3);
const BATTERY_MAX = Number(Deno.env.get("AI_BATTERY_PER_DAY") || 1);
const OLQS = ["Effective Intelligence", "Reasoning Ability", "Organising Ability", "Power of Expression", "Social Adaptability", "Cooperation", "Sense of Responsibility", "Initiative", "Self Confidence", "Speed of Decision", "Ability to Influence the Group", "Liveliness", "Determination", "Courage", "Stamina"];
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const fail = (code: string, message: string, status = 400) => json({ error: code, message }, status);

async function db(path: string, opt: RequestInit = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...opt, headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...(opt.headers || {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error(`db ${r.status}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}
const clip = (s: unknown, n: number) => { const w = String(s || "").trim().split(/\s+/).filter(Boolean); return w.length > n ? w.slice(0, n).join(" ") + " …" : w.join(" "); };
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? Math.max(1, Math.min(10, Math.round(n * 10) / 10)) : null; };
const utcDayStart = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.toISOString(); };

const ROLE = `You are a senior SSB (Services Selection Board, India) psychologist. You assess candidates against the 15 Officer Like Qualities (OLQs): ${OLQS.join(", ")}.
Rate each OLQ 1-10 (5 = average candidate, 7 = recommendable, 9+ = rare). Judge only from evidence in the responses; blank, escapist, unrealistic or preachy answers lower scores. Be honest, specific and encouraging. Address the candidate as "you". Quote short fragments of the candidate's own words as evidence. Never invent responses that are not in the input.`;
const PER_TEST = `Reply ONLY with JSON: {"olq":{<each OLQ name>:number},"observations":[3-4 short strings about personality patterns],"strengths":[2-3 strings],"weaknesses":[2-3 strings],"examples":[up to 3 objects {"item":number,"quote":string,"comment":string,"better":string}]}`;
const SINGLE = `Reply ONLY with JSON: {"summary":"3-4 sentence assessment of the personality this test shows","grade":"one of: Strong / Promising / Average / Needs work","olq":{<each OLQ name>:number},"observations":[3-4 strings],"strengths":[2-3 strings],"improvements":[3 objects {"area":string,"why":string,"practice":string}],"examples":[3-5 objects {"item":number,"quote":string,"comment":string,"better":string}]}`;

const SD_Q = ["Parents' opinion", "Teachers/employer's opinion", "Friends' opinion", "Own opinion", "Qualities to develop"];
function testPrompt(test: string, stimuli: string[], resp: string[]) {
  const R = (i: number, n: number) => clip(resp[i], n) || "(blank)";
  if (test === "tat") return `TEST: Thematic Apperception Test. For each picture (description in brackets; a blank slide means the candidate imagined their own picture) the candidate wrote a story in 4 minutes. Judge the hero's thinking, feelings, actions, outcome, realism and maturity.\n` + stimuli.map((d, i) => `#${i + 1} [${clip(d, 25)}] ${R(i, 200)}`).join("\n");
  if (test === "wat") return `TEST: Word Association Test. 15 seconds per word; the first thought as a sentence. Judge positivity, maturity, spontaneity; penalise preaching, definitions and negativity.\n` + stimuli.map((w, i) => `#${i + 1} ${w}: ${R(i, 15)}`).join("\n");
  if (test === "srt") return `TEST: Situation Reaction Test. Situation => candidate's reaction (30 seconds each). Judge practicality, completeness, presence of mind, responsibility and social concern.\n` + stimuli.map((s, i) => `#${i + 1} ${clip(s, 30)} => ${R(i, 50)}`).join("\n");
  return `TEST: Self Description (15 minutes, five paragraphs). Judge self-awareness, honesty, balance of strengths and weaknesses, and real examples.\n` + SD_Q.map((q, i) => `${q}: ${R(i, 150)}`).join("\n");
}

const dead = new Set<string>();
let cursor = 0;
async function groq(system: string, user: string, maxTokens: number): Promise<{ data: any; model: string; tokens: number }> {
  let lastErr = "";
  for (let attempt = 0; attempt < MODELS.length * 2; attempt++) {
    const live = MODELS.filter((m) => !dead.has(m)); if (!live.length) break;
    const model = live[(cursor + attempt) % live.length];
    const body: any = { model, temperature: 0.3, max_completion_tokens: maxTokens, response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content: user }] };
    if (model.includes("gpt-oss")) body.reasoning_effort = "low";
    if (model.includes("qwen3")) body.reasoning_effort = "none";
    let r: Response;
    try { r = await fetch("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${GROQ_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
    catch (e) { lastErr = String(e); continue; }
    if (r.ok) {
      const j = await r.json(); const txt: string = j.choices?.[0]?.message?.content || "";
      try { const data = JSON.parse(txt.slice(txt.indexOf("{"), txt.lastIndexOf("}") + 1)); cursor = (cursor + attempt + 1) % Math.max(1, live.length); return { data, model, tokens: j.usage?.total_tokens || 0 }; }
      catch { lastErr = `bad JSON from ${model}`; continue; }
    }
    const t = await r.text(); lastErr = `${model} ${r.status}: ${t.slice(0, 160)}`;
    if (r.status === 401) throw new Error("Groq key rejected");
    if (r.status === 404 || /model_not_found|decommissioned|does not exist/i.test(t)) { dead.add(model); continue; }
    if (r.status === 400 && /reasoning_effort/i.test(t)) { dead.add(model); continue; }
    if (r.status === 429 && attempt >= live.length - 1) { const wait = Math.min(15, Number(r.headers.get("retry-after")) || 6); await new Promise((res) => setTimeout(res, wait * 1000)); }
  }
  throw new Error(lastErr || "AI unavailable");
}
function cleanOlq(o: any) { const out: Record<string, number> = {}; for (const q of OLQS) { const v = num(o?.[q]); if (v != null) out[q] = v; } return out; }
const mean = (o: Record<string, number>) => { const v = Object.values(o); return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null; };

async function usage(uid: string) {
  const since = utcDayStart();
  const all = await db(`ai_reviews?created_at=gte.${since}&select=user_id,kind,status,tokens`);
  const site = all.reduce((s: number, r: any) => s + (r.tokens || 0), 0);
  const mine = all.filter((r: any) => r.user_id === uid && r.status !== "error");
  return { site, single: mine.filter((r: any) => r.kind === "single").length, battery: mine.filter((r: any) => r.kind === "battery").length };
}
async function start(row: any, existing: any) {
  const base = { ...row, status: "processing", error: null, updated_at: new Date().toISOString() };
  if (existing) return (await db(`ai_reviews?id=eq.${existing.id}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(base) }))[0];
  return (await db(`ai_reviews`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(base) }))[0];
}
const finishRow = (id: number, patch: any) => db(`ai_reviews?id=eq.${id}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }) });
const busy = (e: any) => e && e.status === "processing" && Date.now() - Date.parse(e.updated_at) < 150000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return fail("method", "POST only", 405);
  try {
    const ur = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SERVICE, Authorization: req.headers.get("Authorization") || "" } });
    if (!ur.ok) return fail("auth", "Please log in again.", 401);
    const uid = (await ur.json()).id as string;
    const p = await req.json().catch(() => ({}));
    const action = String(p.action || "");

    if (action === "status") {
      const u = await usage(uid);
      return json({ configured: !!GROQ_KEY, limits: { single: SINGLE_MAX, battery: BATTERY_MAX }, used: { single: u.single, battery: u.battery }, open: u.site < BUDGET, singleOpen: u.site < BUDGET * 0.7 });
    }
    if (!GROQ_KEY) return fail("not_configured", "The psychologist is getting ready. Psychologist Reviews will open soon; your scored reports are ready meanwhile.", 503);

    /* ---------- single test ---------- */
    if (action === "single") {
      const sid = String(p.session_id || "").replace(/[^a-z0-9_-]/gi, "");
      const rows = await db(`sessions?user_id=eq.${uid}&id=eq.${sid}&select=id,test,date,day,count,responses`);
      const s = rows[0]; if (!s) return fail("not_found", "That test isn't in your file.", 404);
      const existing = (await db(`ai_reviews?user_id=eq.${uid}&kind=eq.single&session_id=eq.${sid}&select=*`))[0];
      if (existing?.status === "done") return json({ review: existing });
      if (busy(existing)) return fail("busy", "Your psychologist is already writing this review.", 409);
      const answered = (s.responses || []).filter((x: string) => String(x || "").trim()).length;
      if (!answered) return fail("empty", "This test has no answers to review.");
      const u = await usage(uid);
      if (u.single >= SINGLE_MAX) return fail("limit", `You've used today's ${SINGLE_MAX} single-test Psychologist Reviews. They reset daily; a full battery still gets its own review.`, 429);
      if (u.site >= BUDGET * 0.7) return fail("cap", "Today's Psychologist Reviews are fully booked. Try again tomorrow; your scored report is ready.", 429);
      const stim: string[] = Array.isArray(p.items) ? p.items.map((x: unknown) => String(x ?? "")).slice(0, 80) : [];
      const row = await start({ user_id: uid, kind: "single", session_id: sid, test: s.test, date: s.date, day: s.day }, existing);
      try {
        const g = await groq(ROLE, `${testPrompt(s.test, s.test === "sd" ? SD_Q : stim, s.responses || [])}\n\n${SINGLE}`, 1600);
        const olq = cleanOlq(g.data.olq);
        const result = { ...g.data, olq, overall: mean(olq), at: new Date().toISOString() };
        const done = await finishRow(row.id, { status: "done", result, models: g.model, tokens: g.tokens });
        return json({ review: done[0] });
      } catch (e) {
        await finishRow(row.id, { status: "error", error: String(e).slice(0, 300) });
        return fail("ai_failed", "Your psychologist is busy right now. Try again in a minute.", 502);
      }
    }

    /* ---------- full battery ---------- */
    if (action === "battery") {
      const bid = String(p.battery_id || "").replace(/[^a-z0-9_-]/gi, "");
      if (!bid) return fail("bad_request", "Missing battery.");
      const rows = await db(`sessions?user_id=eq.${uid}&assessment->>battery=eq.${bid}&select=id,test,date,day,count,responses,created_at&order=created_at.asc`);
      const sess: Record<string, any> = {}; rows.forEach((s: any) => (sess[s.test] = s));
      const missing = ["tat", "wat", "srt", "sd"].filter((t) => !sess[t]);
      if (missing.length) return fail("incomplete", `Finish the full battery first. Still to do: ${missing.map((m) => m.toUpperCase()).join(", ")}.`);
      const date = sess.tat.date;
      if (Object.values(sess).some((s: any) => s.date !== date)) return fail("incomplete", "All four tests must be taken on the same day.");
      const existing = (await db(`ai_reviews?user_id=eq.${uid}&kind=eq.battery&battery_id=eq.${bid}&select=*`))[0];
      if (existing?.status === "done") return json({ review: existing });
      if (busy(existing)) return fail("busy", "Your psychologist is already writing this review.", 409);
      const u = await usage(uid);
      if (u.battery >= BATTERY_MAX && !existing) return fail("limit", "You've had today's full Psychologist Review. Take the battery again tomorrow for a new one.", 429);
      if (u.site >= BUDGET) return fail("cap", "Today's Psychologist Reviews are fully booked. Try again tomorrow; your scored reports are ready.", 429);
      const it = p.items || {};
      const row = await start({ user_id: uid, kind: "battery", battery_id: bid, date, day: sess.tat.day }, existing);
      try {
        const per: Record<string, any> = {}; const used: string[] = []; let tokens = 0;
        for (const t of ["tat", "srt", "wat", "sd"]) {
          const stim = t === "sd" ? SD_Q : (Array.isArray(it[t]) ? it[t].map((x: unknown) => String(x ?? "")).slice(0, 80) : []);
          const g = await groq(ROLE, `${testPrompt(t, stim, sess[t].responses || [])}\n\n${PER_TEST}`, 1200);
          per[t] = { ...g.data, olq: cleanOlq(g.data.olq) }; used.push(g.model); tokens += g.tokens;
        }
        const w: Record<string, number> = { tat: 1.3, srt: 1.2, wat: 1, sd: 0.8 };
        const olq: Record<string, number> = {};
        for (const q of OLQS) { let s = 0, n = 0; for (const t in per) { const v = per[t].olq[q]; if (v != null) { s += v * w[t]; n += w[t]; } } if (n) olq[q] = Math.round((s / n) * 10) / 10; }
        const brief = Object.entries(per).map(([t, d]: [string, any]) => `${t.toUpperCase()}: observations ${JSON.stringify(d.observations || [])}; strengths ${JSON.stringify(d.strengths || [])}; weaknesses ${JSON.stringify(d.weaknesses || [])}`).join("\n");
        let synth: any = {};
        try {
          const g = await groq(ROLE, `Write the final psychological review of this candidate from the four test reports below.\nCombined OLQ ratings: ${JSON.stringify(olq)}\n${brief}\n\nReply ONLY with JSON: {"summary":"4-6 sentence personality profile","recommendation":"one of: Strongly recommended / Recommended / Borderline / Not yet recommended","consistency":"1-2 sentences on whether the four tests show one consistent personality","top_strengths":[3 strings],"priority_improvements":[3-4 objects {"area":string,"why":string,"practice":string}],"seven_day_plan":[7 short strings, one per day]}`, 1400);
          synth = g.data; used.push(g.model); tokens += g.tokens;
        } catch (_) { synth = {}; }
        const result = { overall: mean(olq), olq, ...synth, tests: per, at: new Date().toISOString() };
        const done = await finishRow(row.id, { status: "done", result, models: [...new Set(used)].join(","), tokens });
        return json({ review: done[0] });
      } catch (e) {
        await finishRow(row.id, { status: "error", error: String(e).slice(0, 300) });
        return fail("ai_failed", "Your psychologist is busy right now. Try again in a minute.", 502);
      }
    }
    return fail("bad_request", "Unknown action.");
  } catch (e) {
    return fail("server", "Something went wrong on our side. Try again shortly.", 500);
  }
});
