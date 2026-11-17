/* =====================================================================
   SSB Psych Lab — rule-based psychologist (no AI, runs fully offline)
   Scores WAT / SRT / TAT / SD responses against the 15 OLQs.
   Everything here is deterministic: same answers -> same report.
   ===================================================================== */
(function () {
  "use strict";

  const FACTORS = [
    { id: "I", name: "Planning & Organising", olqs: ["Effective Intelligence", "Reasoning Ability", "Organising Ability", "Power of Expression"] },
    { id: "II", name: "Social Adjustment", olqs: ["Social Adaptability", "Cooperation", "Sense of Responsibility"] },
    { id: "III", name: "Social Effectiveness", olqs: ["Initiative", "Self Confidence", "Speed of Decision", "Ability to Influence the Group", "Liveliness"] },
    { id: "IV", name: "Dynamic", olqs: ["Determination", "Courage", "Stamina"] },
  ];
  const OLQS = FACTORS.flatMap((f) => f.olqs);

  /* ---------- word lists (stems; matched at word start) ---------- */
  const L = {
    pos: "help save success achiev win won solv overcom improv confiden courag brave hope positiv happy happi proud respect trust honest cooperat team together support care protect serv duty disciplin effort determin dedicat learn lesson strength progress motivat inspir unit peace honour honor sincer organis organiz prepar hard work smil enjoy grow build creat develop excel achiev victor glad thank grate kind gentle calm patien wise skill train practi strong healthy fit safe secur succeed better best great good".split(" "),
    neg: "fear afraid scare fail die died death dead kill suicid cry cried sad depress hate angry anger reveng cheat lie lied liar steal stole hopeless helpless useless worr nervous panic lonely defeat lost loss evil cruel weak coward disgrac shame curse regret quit ran away escap punish jealous terribl horribl pain suffer misery miserab worst bad ugly stupid".split(" "),
    action: "inform call took take rush gave give arrang organis organiz help report contact went go asked ask explain convinc collect carri carry shift appli apply start stop pull jump threw provid bandag admit divid plan discuss motivat consol guid return refus hand dial put kept keep made make built build repair clean search used use manag complet continu prepar request persuad warn alert evacuat rescu save saved treat reach lift drove drive ran climb swam swim brought bring fetch cover tied tie push switch arrang talk spoke speak approach enquir inquir check fix solv lead led train teach taught donat raise rais start set".split(" "),
    help: "police ambulance hospital doctor first aid 100 108 112 101 fire brigade authorit teacher principal warden elder villager friend family parent helpline nearby people crowd team senior officer panchayat ngo station master tte driver conductor commander jawan men troops neighbour neighbor guard security owner manager boss".split(" "),
    escape: ["ignor", "wait", "waited", "left it", "ran away", "avoid", "did nothing", "nothing", "cannot", "can't", "could not", "couldn't", "someone else", "not my", "would not", "didn't", "did not", "will not", "won't", "panick", "hid", "hide", "gave up", "give up", "quit", "complain", "blam", "shout", "fought", "slapp", "beat him", "abus"],
    unreal: ["single-handed", "single handed", "killed all", "superman", "magic", "miracle", "god help", "overpower", "fought ten", "caught all", "all alone defeated", "flew", "superpower", "within seconds"],
    preachy: ["should", "must", "ought", "never", "always"],
    self: ["i", "me", "my", "myself", "mine"],
    social: "friend team together group villager people societ famil colleague everyone others communit cooperat nation country class mates teammate member comrade neighbour neighbor public all of us we".split(" "),
    planning: ["plan", "decid", "organis", "organiz", "arrang", "prepar", "divid", "discuss", "first", "then", "after that", "finally", "next", "step", "schedule", "priorit", "strategy", "method"],
    future: ["will", "later", "eventually", "finally", "became", "become", "future", "next year", "after some time", "soon", "went on", "years later", "from then", "since then"],
    past: ["was", "were", "had", "used to", "earlier", "once", "previous", "since childhood", "always wanted", "ago", "since"],
    present: ["is", "are", "now", "decides", "decided", "at that moment", "suddenly", "today", "that day", "realised", "realized", "saw", "noticed"],
    outPos: "success saved recover won achiev selected clear happy prais appreciat reward solv complet improv proud thank safe cured rescued became got reached promoted honoured honored".split(" "),
    outNeg: ["died", "death", "failed", "lost", "cried", "suicide", "killed", "nothing could", "could not", "gave up", "ran away", "hopeless", "ruined", "arrested", "dead", "sad"],
    fantasy: ["magic", "miracle", "god appeared", "ghost", "superpower", "lottery", "suddenly a rich", "dream came true", "angel", "fairy"],
    example: ["for example", "for instance", "once", "when i", "last year", "in class", "during", "in my", "in school", "in college", "won", "secured", "captain", "represented"],
    weakness: ["but", "however", "sometimes", "need to", "improve", "weak", "lack", "work on", "short temper", "short-temper", "impatient", "shy", "hesitat", "nervous", "lazy", "careless", "stubborn", "overthink"],
    sdplan: ["daily", "practice", "practis", "practic", "working on", "trying", "plan to", "started", "every day", "regular", "reading", "joined", "will", "goal", "routine"],
  };
  const CAT_KEYS = {
    emergency: ["first aid", "bandag", "cpr", "ambulance", "108", "112", "101", "hospital", "doctor", "police", "fire brigade", "fire extinguisher", "extinguisher", "evacuat", "switch off", "water", "rope", "pull", "rescu", "inform", "call"],
    moral: ["refus", "return", "honest", "report", "inform", "police", "principal", "truth", "explain", "convinc", "advis", "counsel", "denied", "owner", "authorit", "warden", "teacher", "wrong"],
    leadership: ["discuss", "plan", "divid", "motivat", "convinc", "organis", "organiz", "assign", "lead", "example", "team", "meeting", "together", "responsib", "task", "resource"],
    family: ["explain", "convinc", "talk", "discuss", "support", "help", "arrang", "manag", "consult", "care", "comfort", "earn", "part-time", "doctor", "parents", "father", "mother", "family"],
    social: ["organis", "organiz", "awareness", "villager", "panchayat", "authorit", "complain", "camp", "volunteer", "clean", "campaign", "meeting", "youth", "ngo", "municipal", "collector", "police", "people"],
    travel: ["map", "ask", "enquir", "inquir", "police", "station master", "nearest", "call", "inform", "walk", "help", "hotel", "tte", "authorit", "alternat", "bus", "taxi", "phone", "local"],
    study: ["prepar", "study", "practi", "teacher", "plan", "revis", "time table", "timetable", "consult", "extra", "library", "ask", "improv", "schedul", "focus", "hard work", "notes"],
    work: ["discuss", "explain", "plan", "team", "boss", "manager", "report", "solv", "priorit", "schedul", "meeting", "honest", "improv", "train", "senior", "client"],
    defence: ["discuss", "example", "disciplin", "motivat", "train", "inform", "command", "radio", "position", "cover", "plan", "evacuat", "first aid", "alert", "fire", "search", "cordon", "report", "senior", "team", "men", "troops", "section", "officer"],
    sports: ["practi", "train", "coach", "team", "motivat", "plan", "strateg", "calm", "focus", "improv", "fair", "respect", "apolog", "first aid", "captain"],
    personal: ["practi", "improv", "daily", "plan", "exercis", "read", "work on", "confiden", "learn", "join", "routine", "disciplin", "habit", "seek", "guidance", "prepar"],
    peers: ["talk", "explain", "help", "support", "advis", "convinc", "counsel", "parents", "teacher", "warden", "honest", "refus", "consol", "doctor", "together", "friend"],
  };
  const SRT_IDEAL = {
    emergency: "Act at once in a sensible order: make the place safe, give first aid, call 108/112 or the police, get the person to hospital, inform the family, then carry on with your own work.",
    moral: "Refuse politely but firmly, do the honest thing (return it / report it), and where possible help the other person correct course rather than just exposing him.",
    leadership: "Call the team together, find the cause, set a clear plan and divide the work by strengths, lead from the front and keep morale up until the task is done.",
    family: "Talk calmly with the family, understand their concern, take practical steps (arrange money, care, a doctor) and keep your own goal on track.",
    social: "Gather like-minded people, raise awareness, involve the panchayat or authorities, and start a practical drive yourself.",
    travel: "Stay calm, use local help (police, station master, locals), find an alternative route or transport, inform those waiting and still reach on time.",
    study: "Make a short focused plan, take help from a teacher or friend, revise the important parts and give your best.",
    work: "Find the root cause, discuss with the people concerned, propose a practical plan, own your part and deliver.",
    defence: "Alert the post and seniors, take position and cover, use the men and resources sensibly, act as per orders and look after the injured.",
    sports: "Stay calm, rethink the strategy with the team, keep playing fair and give it your best till the end.",
    personal: "Accept it honestly, make a daily plan to improve, seek guidance where needed and keep at it.",
    peers: "Talk to him frankly, help in a practical way, involve parents/teachers if needed, and stay honest yourself.",
  };
  const OLQ_TIPS = {
    "Effective Intelligence": "Before writing, picture the practical solution first; aim for answers that actually solve the problem with what is available.",
    "Reasoning Ability": "Cover every part of the situation. Ask: what is the problem, what is the cause, what is the most sensible order of actions?",
    "Organising Ability": "Write actions in sequence (first, then, finally) and mention how you would use people and resources.",
    "Power of Expression": "Keep WAT to 4-8 words and SRT to one or two complete sentences; read your responses aloud to check they are clear.",
    "Social Adaptability": "Show the hero working with and caring about others: friends, villagers, team mates, strangers.",
    "Cooperation": "Bring in the group: 'with the help of villagers', 'along with my friends'. Avoid lone-wolf solutions.",
    "Sense of Responsibility": "Own the problem in every answer. Inform the right authority, help the affected person and finish what you start.",
    "Initiative": "Start every SRT reaction with your own first action (a verb), not waiting for others to act.",
    "Self Confidence": "Remove words like fear, worry, cannot. Write as a person who knows he can handle it.",
    "Speed of Decision": "Do daily timed sets: 20 WAT words at 15 s each and 20 SRTs in 10 minutes. Never leave a blank; write the first sensible action.",
    "Ability to Influence the Group": "Show the hero convincing and motivating others, not just doing everything himself.",
    "Liveliness": "Keep a cheerful, hopeful tone. Turn negative words into constructive thoughts.",
    "Determination": "Let the hero face a setback and keep going: 'he practised daily for six months and cleared it the next year'.",
    "Courage": "In danger situations act sensibly but without hesitation, and take a calculated risk to help others.",
    "Stamina": "Train to finish full sets. Your last 20 answers should be as good as your first 20.",
  };
  /* metric -> OLQ weights */
  const MAP = {
    "Effective Intelligence": { quality: 0.4, coverage: 0.3, completion: 0.3 },
    "Reasoning Ability": { coverage: 0.4, realism: 0.3, quality: 0.3 },
    "Organising Ability": { planning: 0.5, structure: 0.2, quality: 0.3 },
    "Power of Expression": { expression: 0.6, quality: 0.4 },
    "Social Adaptability": { social: 0.5, positivity: 0.3, notPreachy: 0.2 },
    "Cooperation": { social: 0.6, escapeFree: 0.4 },
    "Sense of Responsibility": { responsibility: 0.6, escapeFree: 0.4 },
    "Initiative": { action: 0.7, escapeFree: 0.3 },
    "Self Confidence": { positivity: 0.5, selfFocus: 0.2, escapeFree: 0.3 },
    "Speed of Decision": { completion: 0.7, quality: 0.3 },
    "Ability to Influence the Group": { action: 0.3, social: 0.3, planning: 0.2, positivity: 0.2 },
    "Liveliness": { positivity: 0.7, outcome: 0.3 },
    "Determination": { endurance: 0.4, outcome: 0.3, escapeFree: 0.3 },
    "Courage": { escapeFree: 0.4, positivity: 0.3, action: 0.3 },
    "Stamina": { endurance: 0.5, completion: 0.5 },
  };
  const METRIC_LABEL = {
    completion: "responses completed", quality: "overall answer quality", positivity: "positive, constructive tone",
    action: "concrete actions taken", social: "involving and caring for others", planning: "planned, sequenced thinking",
    responsibility: "owning the problem and getting the right help", escapeFree: "no escaping or blaming",
    realism: "practical, realistic solutions", expression: "clear length and expression", endurance: "keeping quality up to the end",
    coverage: "addressing every part of the situation", structure: "story structure (past, present, outcome)",
    outcome: "positive, realistic outcomes", selfFocus: "outward-looking (not self-centred)", notPreachy: "no preaching",
    hero: "a clear, active hero",
  };

  /* ---------- text helpers ---------- */
  const norm = (s) => " " + String(s || "").toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' -]+/g, " ").replace(/\s+/g, " ").trim() + " ";
  const tokens = (s) => norm(s).trim().split(" ").filter(Boolean);
  const wc = (s) => tokens(s).length;
  function hits(text, list) {
    const t = norm(text); let n = 0; const found = [];
    for (const w of list) {
      const re = w.includes(" ") ? (" " + w) : (" " + w);
      if (t.includes(re)) { n++; found.push(w.trim()); }
    }
    return { n, found };
  }
  function hasWord(text, list) { // exact word match (for self, preachy)
    const tk = tokens(text); return list.reduce((a, w) => a + tk.filter((x) => x === w).length, 0);
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const r1 = (v) => Math.round(v * 10) / 10;

  /* ---------- per-item scoring ---------- */
  function scoreWAT(item, resp) {
    const a = (resp || "").trim();
    if (!a) return { score: 0, tag: "Blank", note: "No response within 15 seconds.", better: tipWAT(item, "Blank"), f: {} };
    const n = wc(a);
    const pos = hits(a, L.pos).n, neg = hits(a, L.neg).n;
    const preach = hasWord(a, ["should", "must", "ought"]);
    const self = hasWord(a, L.self);
    const def = new RegExp("^\\s*(a |an |the )?" + item.w + "\\s+(is|means|are)\\b", "i").test(a);
    const social = hits(a, L.social).n > 0;
    let lenS = n <= 1 ? 3 : n === 2 ? 5 : n <= 9 ? 8 : n <= 12 ? 6.5 : 4.5;
    let s = lenS + (pos ? 1.5 : 0) + (social ? 0.5 : 0);
    const negOnly = neg > 0 && pos === 0;
    if (negOnly) s -= 3.5;
    if (preach) s -= 1.5;
    if (self >= 2 || /^\s*i\b/i.test(a)) s -= 1;
    if (def) s -= 1.5;
    s = clamp(s, 0, 10);
    let tag = "Neutral", note = "";
    if (negOnly) { tag = "Negative"; note = "Negative or fearful thought with no constructive turn."; }
    else if (preach) { tag = "Preachy"; note = "Advice/sermon style ('should/must'); the board reads this as an idealised, not real, response."; }
    else if (def) { tag = "Definition"; note = "Defines the word instead of giving a spontaneous thought."; }
    else if (self >= 2 || /^\s*i\b/i.test(a)) { tag = "Self-centred"; note = "Starts with or repeats 'I'; write about action and people, not yourself."; }
    else if (n <= 2) { tag = "Too short"; note = "One or two words show little of your thinking; make it a short sentence."; }
    else if (n > 12) { tag = "Too long"; note = "Over 12 words is hard to write in 15 seconds; keep it crisp."; }
    else if (s >= 8) { tag = "Positive"; note = "Spontaneous and constructive."; }
    return { score: s, tag, note, better: tipWAT(item, tag),
      f: { pos: !negOnly && !preach, social, action: hits(a, L.action).n > 0, plan: false, resp: hits(a, ["duty", "responsib", "help", "serve", "protect"]).n > 0, escape: false, unreal: false, preach: !!preach, self: self >= 2, len: lenS / 8 } };
  }
  function tipWAT(item, tag) {
    // every word in data/wat.js carries a hand-written model response (item.i)
    if (item.i) return item.i;
    const w = item.w;
    if (item.c === "neg") return `Turn "${w}" constructive: show how a capable person handles it.`;
    return `A short, natural sentence linking "${w}" to action or people (4-8 words).`;
  }
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  function scoreSRT(item, resp) {
    const a = (resp || "").trim();
    const ideal = SRT_IDEAL[item.c] || SRT_IDEAL.personal;
    if (!a) return { score: 0, tag: "Blank", note: "Not attempted.", better: ideal, f: {} };
    const n = wc(a);
    const act = hits(a, L.action).n, help = hits(a, L.help).n, esc = hits(a, L.escape).n, unr = hits(a, L.unreal).n;
    const keys = CAT_KEYS[item.c] || CAT_KEYS.personal; const kh = hits(a, keys).n;
    const seq = (a.match(/,| and | then | after | finally /gi) || []).length;
    const social = hits(a, L.social).n > 0;
    const cov = clamp(kh / 3, 0, 1);
    let s = 2 + clamp(act, 0, 4) * 1.0 + cov * 2.5 + (help ? 0.8 : 0) + clamp(seq, 0, 3) * 0.4 + (social ? 0.4 : 0);
    if (n < 4) s -= 2; else if (n > 45) s -= 1;
    if (esc) s -= 2.2; if (unr) s -= 2.2;
    s = clamp(s, 0, 10);
    let tag = "Good", note = "";
    if (unr) { tag = "Unrealistic"; note = "Heroic or impossible action; the board looks for practical solutions."; }
    else if (esc && act < 2) { tag = "Escapist"; note = "Avoids, waits, blames or gives up instead of acting."; }
    else if (n < 4 || act === 0) { tag = "Incomplete"; note = "No clear action; say what exactly you did."; }
    else if (cov < 0.34 && s < 6.5) { tag = "Half solution"; note = "Misses key parts of the situation."; }
    else if (s >= 7.5) { tag = "Good"; note = "Practical, complete action."; }
    else { tag = "Average"; note = "Acceptable, but add the missing steps."; }
    return { score: s, tag, note, better: tag === "Good" ? "" : ideal,
      f: { pos: !esc, social, action: act > 0, plan: seq >= 1 || hits(a, L.planning).n > 0, resp: help > 0 || kh > 0, escape: esc > 0, unreal: unr > 0, cov, len: n >= 6 && n <= 40 ? 1 : n >= 4 ? 0.6 : 0.2 } };
  }

  function scoreTAT(item, resp, pic) {
    const a = (resp || "").trim();
    const base = "Structure it as: what led to the scene, who the hero is (age/role), what he thinks and plans, what he does with others, and a realistic positive ending.";
    if (!a) return { score: 0, tag: "Blank", note: "No story written.", better: base, f: {} };
    const n = wc(a);
    const sentences = a.split(/[.!?]+/).map((x) => x.trim()).filter(Boolean);
    const last = sentences.slice(-2).join(". ");
    const past = hits(a, L.past).n > 0, fut = hits(a, L.future).n > 0, pres = hits(a, L.present).n > 0;
    const act = hits(a, L.action).n, social = hits(a, L.social).n > 0, plan = hits(a, L.planning).n > 0;
    const outP = hits(last, L.outPos).n, outN = hits(last, L.outNeg).n;
    const fant = hits(a, L.fantasy).n;
    const hero = /\b([A-Z][a-z]{2,})\b/.test(a.replace(/^[A-Z]/, "x")) || /\b(he|she) (was|is|decided|saw|wanted|had)\b/i.test(a);
    const percept = pic ? clamp(hits(a, pic.kw).n / 2, 0, 1) : 0.6;
    const structure = (past ? 1 : 0) + (pres ? 1 : 0) + (fut || outP ? 1 : 0);
    let lenS = n < 30 ? 2 : n < 60 ? 5 : n <= 200 ? 8 : 6.5;
    let s = lenS * 0.35 + structure * 0.8 + clamp(act, 0, 5) * 0.35 + (social ? 0.6 : 0) + (plan ? 0.5 : 0) + (outP ? 1 : 0) + (hero ? 0.6 : 0) + percept * 0.8;
    if (outN && !outP) s -= 2; if (fant) s -= 2;
    s = clamp(s, 0, 10);
    const missing = [];
    if (!hero) missing.push("a clear hero"); if (!past) missing.push("what led to the scene");
    if (act < 2) missing.push("the hero's concrete actions"); if (!outP) missing.push("a positive, realistic ending");
    if (percept < 0.5 && pic) missing.push("link to what the picture shows");
    let tag = "Good", note = "";
    if (fant) { tag = "Unrealistic"; note = "Miracle or fantasy turn; keep it real."; }
    else if (outN && !outP) { tag = "Negative ending"; note = "Ends in failure or tragedy without a resolution."; }
    else if (n < 45) { tag = "Incomplete"; note = `Only ${n} words; a full story is about 100-170 words.`; }
    else if (s >= 7) { tag = "Good"; note = "Clear hero, action and outcome."; }
    else { tag = "Average"; note = missing.length ? "Missing: " + missing.join(", ") + "." : "Develop the actions and outcome further."; }
    return { score: s, tag, note, better: tag === "Good" ? "" : base,
      f: { pos: !(outN && !outP), social, action: act >= 2, plan, resp: act >= 2 && hero, escape: outN > 0 && !outP, unreal: fant > 0, cov: percept, structure: structure / 3, outcome: outP > 0 ? 1 : 0, hero, len: lenS / 8 } };
  }

  function scoreSD(item, resp, idx) {
    const a = (resp || "").trim();
    const base = ["Mention two or three qualities your parents see, with a short real example for one.",
      "What teachers/employers noticed: discipline, responsibility, a project you handled.",
      "How friends describe you, with an example of helping or leading them.",
      "An honest view of yourself: strengths and one or two weaknesses.",
      "Concrete qualities to develop and what you are already doing about them (e.g. daily reading, running)."][idx] || "";
    if (!a) return { score: 0, tag: "Blank", note: "Paragraph left empty.", better: base, f: {} };
    const n = wc(a);
    const ex = hits(a, L.example).n + (/\d/.test(a) ? 1 : 0);
    const weak = hits(a, L.weakness).n, pl = hits(a, L.sdplan).n;
    const adjList = (a.match(/,/g) || []).length;
    let s = (n < 20 ? 2 : n < 40 ? 5 : n <= 140 ? 7.5 : 6.5) + clamp(ex, 0, 2) * 0.9 + (idx >= 3 && weak ? 0.8 : 0) + (idx === 4 && pl ? 1 : 0);
    if (adjList >= 5 && ex === 0) s -= 1.5;
    s = clamp(s, 0, 10);
    let tag = "Good", note = "";
    if (n < 20) { tag = "Too short"; note = "A sentence or two gives the board nothing to work with."; }
    else if (adjList >= 5 && ex === 0) { tag = "Adjective list"; note = "A list of qualities without examples reads as generic."; }
    else if (idx === 3 && !weak) { tag = "One-sided"; note = "No weaknesses mentioned; honest balance is valued."; }
    else if (idx === 4 && !pl) { tag = "No plan"; note = "Says what to develop but not how."; }
    else if (ex === 0) { tag = "Generic"; note = "Add a real example."; }
    else if (s >= 7.5) { tag = "Good"; note = "Specific and honest."; }
    else tag = "Average";
    return { score: s, tag, note, better: tag === "Good" ? "" : base,
      f: { pos: true, social: hits(a, L.social).n > 0, action: hits(a, L.action).n > 0, plan: pl > 0, resp: hits(a, ["responsib", "duty", "help", "care"]).n > 0, escape: false, unreal: false, len: n >= 40 && n <= 140 ? 1 : 0.5, cov: ex ? 1 : 0.3 } };
  }

  /* ---------- session assessment ---------- */
  function assess(session, ctx) {
    const { test, items, responses } = session;
    const res = items.map((it, i) => {
      if (test === "wat") return scoreWAT(it, responses[i]);
      if (test === "srt") return scoreSRT(it, responses[i]);
      if (test === "tat") return scoreTAT(it, responses[i], it.blank ? null : (ctx.tatBank || []).find((p) => p.id === it.id));
      return scoreSD(it, responses[i], i);
    });
    const answered = res.filter((r) => r.tag !== "Blank");
    const N = items.length, A = answered.length || 1;
    const share = (k) => answered.filter((r) => r.f[k]).length / N;           // blanks count against every quality
    const shareA = (k) => answered.filter((r) => r.f[k]).length / A;        // for negatives (escape, unreal, self, preach)
    const third = Math.max(1, Math.floor(N / 3));
    const q = (arr) => avg(arr.map((r) => r.score)) || 0;
    const firstQ = q(res.slice(0, third)), lastQ = q(res.slice(-third));
    const m = {
      completion: answered.length / N,
      quality: (avg(res.map((r) => r.score)) || 0) / 10,
      positivity: share("pos"),
      social: Math.min(1, share("social") * (test === "wat" ? 1.6 : 1.3)),
      escapeFree: 1 - shareA("escape"),
      realism: 1 - shareA("unreal"),
      expression: (avg(answered.map((r) => r.f.len || 0)) || 0) * (answered.length / N),
      endurance: answered.length ? clamp(lastQ / Math.max(firstQ, 0.1), 0, 1) * (0.4 + 0.6 * ((avg(res.map((r) => r.score)) || 0) / 10)) : 0,
    };
    if (test !== "wat") { m.action = share("action"); m.planning = Math.min(1, share("plan") * 1.3); m.responsibility = share("resp"); m.coverage = avg(answered.map((r) => r.f.cov || 0)) || 0; }
    else { m.action = Math.min(1, share("action") * 2); m.responsibility = Math.min(1, (share("resp") + share("pos")) / 1.6); m.selfFocus = 1 - shareA("self"); m.notPreachy = 1 - shareA("preach"); m.coverage = m.quality; m.escapeFree = m.positivity * m.completion; m.realism = m.quality; }
    if (test === "tat") { m.structure = avg(answered.map((r) => r.f.structure || 0)) || 0; m.outcome = avg(answered.map((r) => r.f.outcome || 0)) || 0; m.hero = share("hero"); }
    if (test === "srt") m.outcome = m.escapeFree;
    if (test === "sd") { m.endurance = m.completion; m.outcome = m.positivity; }
    for (const k in m) m[k] = clamp(m[k], 0, 1);

    const olq = {};
    for (const o of OLQS) {
      let sw = 0, sv = 0;
      for (const [k, w] of Object.entries(MAP[o])) if (m[k] != null) { sw += w; sv += w * m[k]; }
      olq[o] = sw ? r1(clamp(1 + 9 * Math.pow(sv / sw, 1.6), 1, 9.5)) : 5;
    }
    const overall = r1(avg(Object.values(olq)));

    /* tags & evidence */
    const tagCount = {}; res.forEach((r) => (tagCount[r.tag] = (tagCount[r.tag] || 0) + 1));
    const idxOf = (tag) => res.map((r, i) => (r.tag === tag ? i + 1 : 0)).filter(Boolean);
    const list = (arr) => (arr.length > 6 ? arr.slice(0, 6).join(", ") + ` and ${arr.length - 6} more` : arr.join(", "));
    const issueFor = (o) => {
      const metrics = Object.keys(MAP[o]).filter((k) => m[k] != null).sort((a, b) => m[a] - m[b]);
      const k = metrics[0]; const pct = Math.round(m[k] * 100);
      const ev = {
        completion: idxOf("Blank").length ? `Items left blank: ${list(idxOf("Blank"))}.` : "",
        positivity: idxOf("Negative").length ? `Negative responses at ${list(idxOf("Negative"))}.` : idxOf("Negative ending").length ? `Negative endings in stories ${list(idxOf("Negative ending"))}.` : "",
        escapeFree: idxOf("Escapist").length ? `Escapist reactions at ${list(idxOf("Escapist"))}.` : "",
        realism: idxOf("Unrealistic").length ? `Unrealistic answers at ${list(idxOf("Unrealistic"))}.` : "",
        action: idxOf("Incomplete").length ? `No clear action at ${list(idxOf("Incomplete"))}.` : "",
        coverage: idxOf("Half solution").length ? `Half solutions at ${list(idxOf("Half solution"))}.` : "",
        notPreachy: idxOf("Preachy").length ? `Preachy responses at ${list(idxOf("Preachy"))}.` : "",
        selfFocus: idxOf("Self-centred").length ? `'I'-centred responses at ${list(idxOf("Self-centred"))}.` : "",
        endurance: lastQ < firstQ ? `Quality fell from ${r1(firstQ)} in the first third to ${r1(lastQ)} in the last third.` : "",
      }[k] || "";
      return `Weakest signal: ${METRIC_LABEL[k]} (${pct}%). ${ev}`.trim();
    };
    const sortedOlq = OLQS.slice().sort((a, b) => olq[a] - olq[b]);
    const nImp = overall < 5 ? 5 : overall < 6.5 ? 4 : 3;
    const improvements = sortedOlq.slice(0, nImp).map((o) => ({ olq: o, issue: issueFor(o), action: OLQ_TIPS[o] }));
    const strongMetrics = Object.keys(m).filter((k) => METRIC_LABEL[k]).sort((a, b) => m[b] - m[a]).slice(0, 3).filter((k) => m[k] >= 0.55);
    const strengths = strongMetrics.map((k) => `Good on ${METRIC_LABEL[k]} (${Math.round(m[k] * 100)}%).`);
    if (!strengths.length) strengths.push("You attempted the test under real timing, which is the first step. Repeat it daily and compare your stats.");
    const topTag = Object.entries(tagCount).filter(([t]) => !["Good", "Positive", "Neutral", "Average"].includes(t)).sort((a, b) => b[1] - a[1])[0];
    const pattern = topTag ? `Most common issue: ${topTag[0]} (${topTag[1]} of ${N}).` : "No recurring problem pattern in this set.";
    const grade = overall >= 8 ? "Strong" : overall >= 7 ? "Recommendable" : overall >= 5.5 ? "Average" : overall >= 4 ? "Below average" : "Weak";
    const summary = summarise(test, m, overall, answered.length, N, sortedOlq);

    return {
      engine: "rules-v1", overall, grade, summary, olq, strengths, improvements, pattern,
      metrics: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Math.round(v * 100) / 100])),
      items: res.map((r, i) => ({ i, tag: r.tag, note: r.note, better: r.better, score: r1(r.score) })),
      at: Date.now(),
    };
  }
  function summarise(test, m, overall, ans, N, sorted) {
    const parts = [];
    parts.push(`You completed ${ans} of ${N} ${({ wat: "words", srt: "situations", tat: "stories", sd: "paragraphs" })[test]} (${Math.round(m.completion * 100)}%).`);
    if (m.positivity >= 0.8) parts.push("Your responses read as positive and constructive.");
    else if (m.positivity < 0.6) parts.push("A noticeable share of responses were negative or escapist, which the board reads as low confidence.");
    if (test !== "wat" && m.action != null) parts.push(m.action >= 0.7 ? "You usually take concrete action yourself." : "Many answers lack a clear action by you; start with a verb.");
    if (test === "wat" && m.notPreachy < 0.8) parts.push("Several responses preach with 'should/must'; write observations instead.");
    if (m.endurance < 0.8) parts.push("Your quality dropped towards the end of the set.");
    parts.push(`Focus next on ${sorted[0]} and ${sorted[1]}.`);
    return parts.join(" ");
  }

  window.PsychEngine = { FACTORS, OLQS, assess, OLQ_TIPS, SRT_IDEAL };
})();
