/* =====================================================================
   Storage layer.
   - If js/config.js has a Supabase URL + anon key, everything (accounts,
     chest numbers, tests, reports) is stored in Supabase.
   - Otherwise it falls back to this browser's localStorage, so the app
     still works offline / when opened as a local file.
   Supabase is used through its plain HTTP APIs (Auth + PostgREST), so no
   extra library has to be loaded.
   ===================================================================== */
(function () {
  "use strict";
  const CFG = window.SSB_CONFIG || {};
  const useSupabase = !!(CFG.supabaseUrl && CFG.supabaseAnonKey);
  const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  /* ---------- tiny localStorage helpers ---------- */
  const P = "ssbpb:";
  const mem = {};
  let lsOk = true;
  try { localStorage.setItem(P + "t", "1"); localStorage.removeItem(P + "t"); } catch (e) { lsOk = false; }
  const lget = (k, d) => { try { const v = lsOk ? localStorage.getItem(P + k) : mem[k]; return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const lset = (k, v) => { const s = JSON.stringify(v); if (lsOk) localStorage.setItem(P + k, s); else mem[k] = s; };
  const ldel = (k) => { if (lsOk) localStorage.removeItem(P + k); else delete mem[k]; };

  /* =================== Supabase backend =================== */
  function SupabaseBackend() {
    const URL_ = CFG.supabaseUrl.replace(/\/+$/, ""), KEY = CFG.supabaseAnonKey;
    let auth = lget("sb_auth", null); // {access_token, refresh_token, expires_at, user:{id,email}}

    const saveAuth = (a) => { auth = a; if (a) lset("sb_auth", a); else ldel("sb_auth"); };
    const fromTokenResponse = (j) => ({ access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in || 3600) * 1000, user: { id: j.user.id, email: j.user.email } });
    const msg = (j, fallback) => {
      const m = (j && (j.msg || j.message || j.error_description || j.error)) || fallback;
      if (/invalid login/i.test(m)) return "Email or password is wrong.";
      if (/already registered|already exists/i.test(m)) return "An account with this email already exists. Log in instead.";
      if (/not confirmed/i.test(m)) return "Confirm your email first: open the link we sent you, then log in.";
      return m;
    };

    async function authCall(path, body) {
      const r = await fetch(`${URL_}/auth/v1/${path}`, { method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(msg(j, "Couldn't reach the server. Check your connection."));
      return j;
    }
    async function refresh() {
      if (!auth || !auth.refresh_token) throw new Error("Session expired. Log in again.");
      try { saveAuth(fromTokenResponse(await authCall("token?grant_type=refresh_token", { refresh_token: auth.refresh_token }))); }
      catch (e) { saveAuth(null); throw new Error("Session expired. Log in again."); }
    }
    async function rest(path, opt = {}, retry = true) {
      if (auth && auth.expires_at - Date.now() < 60000) await refresh();
      const headers = { apikey: KEY, "Content-Type": "application/json", Authorization: `Bearer ${auth ? auth.access_token : KEY}`, ...(opt.headers || {}) };
      const r = await fetch(`${URL_}/rest/v1/${path}`, { ...opt, headers });
      if (r.status === 401 && retry && auth) { await refresh(); return rest(path, opt, false); }
      const text = await r.text(); const j = text ? JSON.parse(text) : null;
      if (!r.ok) throw new Error(msg(j, `Server error (${r.status}).`));
      return j;
    }
    const toUser = (p) => p && ({ id: p.id, chest: p.chest_no, name: p.name, email: p.email, entry: p.entry, startDate: p.start_date, createdAt: p.created_at });
    const toRow = (s, uid) => ({ id: s.id, user_id: uid, test: s.test, set_no: s.set, day: s.day, date: s.date, count: s.count, responses: s.responses, time_used: s.timeUsed, overall: s.assessment ? s.assessment.overall : null, assessment: s.assessment, created_at: new Date(s.createdAt).toISOString() });
    const fromRow = (r) => ({ id: r.id, test: r.test, set: r.set_no, day: r.day, date: r.date, count: r.count, responses: r.responses, timeUsed: r.time_used, assessment: r.assessment, createdAt: Date.parse(r.created_at) });
    async function profile() { const rows = await rest(`profiles?select=*&id=eq.${auth.user.id}`); return toUser(rows[0]); }

    return {
      kind: "supabase", persistent: true,
      async init() {
        // returning from an email-confirmation link: #access_token=...&refresh_token=...
        const h = location.hash.slice(1);
        if (h.includes("access_token=")) {
          const q = new URLSearchParams(h);
          const at = q.get("access_token"), rt = q.get("refresh_token");
          if (at && rt) {
            const r = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: KEY, Authorization: `Bearer ${at}` } });
            if (r.ok) { const u = await r.json(); saveAuth({ access_token: at, refresh_token: rt, expires_at: Date.now() + (+q.get("expires_in") || 3600) * 1000, user: { id: u.id, email: u.email } }); }
          }
          history.replaceState(null, "", location.pathname + "#today");
        }
      },
      async register({ name, email, entry, password }) {
        const j = await authCall("signup", { email: email.trim().toLowerCase(), password, data: { name: name.trim(), entry } });
        if (!j.access_token) return { needsConfirm: true };     // email confirmation is switched on in Supabase
        saveAuth(fromTokenResponse(j));
        return profile();
      },
      async login(email, password) {
        saveAuth(fromTokenResponse(await authCall("token?grant_type=password", { email: email.trim().toLowerCase(), password })));
        return profile();
      },
      logout() { if (auth) fetch(`${URL_}/auth/v1/logout`, { method: "POST", headers: { apikey: KEY, Authorization: `Bearer ${auth.access_token}` } }).catch(() => {}); saveAuth(null); },
      async currentUser() { if (!auth) return null; try { return await profile(); } catch (e) { saveAuth(null); return null; } },
      async updateUser(id, patch) {
        const body = {}; if ("name" in patch) body.name = patch.name; if ("entry" in patch) body.entry = patch.entry; if ("startDate" in patch) body.start_date = patch.startDate;
        const rows = await rest(`profiles?id=eq.${id}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(body) });
        return toUser(rows[0]);
      },
      async sessions() { return (await rest(`sessions?select=*&order=created_at.asc`)).map(fromRow); },
      async saveSession(uid, s) { await rest(`sessions`, { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(toRow(s, uid)) }); },
      async overall() { const r = await rest(`overall_reports?select=report`); return r[0] ? r[0].report : null; },
      async saveOverall(uid, o) { await rest(`overall_reports`, { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ user_id: uid, report: o, updated_at: new Date().toISOString() }) }); },
      async rpc(fn, args = {}) { return rest(`rpc/${fn}`, { method: "POST", body: JSON.stringify(args) }); },
      async ai(action, payload = {}) {
        // Psychologist Review: calls the ai-review Edge Function, which holds the AI key and enforces the limits
        if (auth && auth.expires_at - Date.now() < 60000) await refresh();
        const call = () => fetch(`${URL_}/functions/v1/ai-review`, { method: "POST", headers: { apikey: KEY, "Content-Type": "application/json", Authorization: `Bearer ${auth ? auth.access_token : KEY}` }, body: JSON.stringify({ action, ...payload }) });
        let r; try { r = await call(); } catch (e) { const er = new Error("Couldn't reach the psychologist. Check your connection."); er.code = "network"; throw er; }
        if (r.status === 401 && auth) { await refresh(); r = await call(); }
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { const er = new Error(j.message || `Server error (${r.status}).`); er.code = j.error || "http"; throw er; }
        return j;
      },
      async aiReviews() { return rest(`ai_reviews?select=id,kind,battery_id,session_id,test,date,day,status,result,created_at&order=created_at.desc&limit=200`); },
      isLoggedIn() { return !!auth; },
      logView(v) {
        // anonymous impression log for the admin dashboard; never blocks the page
        try {
          let vid = lget("vid", null); if (!vid) { vid = "v" + Math.random().toString(36).slice(2, 12) + Date.now().toString(36); lset("vid", vid); }
          const w = window.innerWidth, device = /Mobi|Android|iPhone/i.test(navigator.userAgent) || w < 640 ? "mobile" : w < 1024 ? "tablet" : "desktop";
          let referrer = ""; try { if (document.referrer) { const h = new URL(document.referrer).host; if (h && h !== location.host) referrer = h.slice(0, 120); } } catch (e) {}
          const go = () => fetch(`${URL_}/rest/v1/page_views`, { method: "POST", keepalive: true, headers: { apikey: KEY, "Content-Type": "application/json", Prefer: "return=minimal", Authorization: `Bearer ${auth && auth.expires_at > Date.now() + 30000 ? auth.access_token : KEY}` },
            body: JSON.stringify({ visitor_id: vid, view: String(v).slice(0, 30), device, referrer, ...(auth ? {} : { user_id: null }) }) }).catch(() => {});
          go();
        } catch (e) {}
      },
      async feedbackCount() { const r = await rest(`feedback?select=id`); return r.length; },
      async saveFeedback(uid, f) { const r = await rest(`feedback?select=id`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ user_id: uid, ...f }) }); return r && r[0] ? r[0].id : null; },
      async markFeedbackEmailed(id) { if (id) await rest(`feedback?id=eq.${id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ emailed: true }) }); },
    };
  }

  /* =================== localStorage backend =================== */
  function LocalBackend() {
    async function hash(pw, salt) {
      const text = salt + ":" + pw;
      try { const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)); return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join(""); }
      catch (e) { let h = 2166136261; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); } return "f" + (h >>> 0).toString(16); }
    }
    const pub = (u) => { const { pw, salt, ...rest } = u; return { ...rest }; };
    return {
      kind: "local", persistent: lsOk,
      async init() {},
      async register({ name, email, entry, password }) {
        const users = lget("users", []); const em = email.trim().toLowerCase();
        if (users.some((u) => u.email === em)) throw new Error("An account with this email already exists. Log in instead.");
        const chest = lget("chestCounter", 0) + 1; lset("chestCounter", chest);
        const id = "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), salt = Math.random().toString(36).slice(2);
        const user = { id, chest, name: name.trim(), email: em, entry, salt, pw: await hash(password, salt), startDate: localDate(), createdAt: Date.now() };
        users.push(user); lset("users", users); lset("current", id); return pub(user);
      },
      async login(email, password) {
        const u = lget("users", []).find((x) => x.email === email.trim().toLowerCase());
        if (!u || (await hash(password, u.salt)) !== u.pw) throw new Error("Email or password is wrong.");
        lset("current", u.id); return pub(u);
      },
      logout() { ldel("current"); },
      async currentUser() { const id = lget("current", null); const u = lget("users", []).find((x) => x.id === id); return u ? pub(u) : null; },
      async updateUser(id, patch) {
        const users = lget("users", []); const i = users.findIndex((u) => u.id === id); if (i < 0) return null;
        for (const k of ["name", "entry", "startDate"]) if (k in patch) users[i][k] = patch[k];
        lset("users", users); return pub(users[i]);
      },
      async sessions(uid) { return lget("u:" + uid + ":sessions", []); },
      async saveSession(uid, s) { const l = lget("u:" + uid + ":sessions", []); const i = l.findIndex((x) => x.id === s.id); if (i >= 0) l[i] = s; else l.push(s); lset("u:" + uid + ":sessions", l); },
      async overall(uid) { return lget("u:" + uid + ":overall", null); },
      async saveOverall(uid, o) { lset("u:" + uid + ":overall", o); },
      async feedbackCount(uid) { return lget("u:" + uid + ":feedback", []).length; },
      logView() {}, isLoggedIn() { return !!lget("current", null); }, async rpc() { throw new Error("Admin dashboard needs Supabase."); }, async ai() { const e = new Error("Psychologist Reviews need an online account."); e.code = "local"; throw e; }, async aiReviews() { return []; },
      async saveFeedback(uid, f) { const l = lget("u:" + uid + ":feedback", []); l.push({ ...f, created_at: new Date().toISOString() }); lset("u:" + uid + ":feedback", l); return l.length; },
      async markFeedbackEmailed() {},
    };
  }

  window.Store = useSupabase ? SupabaseBackend() : LocalBackend();
})();
