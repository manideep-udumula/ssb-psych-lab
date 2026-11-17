# SSB Psych Lab

A 30-day SSB psychology practice app: TAT, WAT, SRT and SD in real SSB timings, with an
instant OLQ assessment by a built-in, rule-based psychologist. No AI calls, so it costs nothing to run.

## Run it

- **Online (Supabase):** `js/config.js` points at the Supabase project `ssb-psych-board` (SSB Psych Lab). Accounts, chest numbers,
  tests and reports are stored there, so candidates can log in from any device.
- **Offline:** set both values in `js/config.js` to `""` and the app falls back to browser storage.

Open `index.html` directly, or serve the folder (`npx serve .`). It is a static site, so GitHub Pages hosts it as-is.

## What's inside

```
index.html            app shell
css/style.css         styles (light + dark)
js/engine.js          the rule-based psychologist (OLQ scoring, tags, tips)
js/config.js          Supabase URL + anon key (public by design; RLS protects data)
js/store.js           storage layer: Supabase (Auth + REST) or localStorage fallback
supabase/schema.sql   tables, triggers, Row Level Security
js/app.js             screens: register/login, today, test runner, reports, progress
data/wat.js           30 days x 60 words   (1,800 unique words, tagged pos/neg/neu/def)
data/srt.js           30 days x 60 situations (1,800 unique, 12 categories x 5 per day)
data/tat.js           54-picture bank with scene descriptions + 30-day schedule (11 + blank per day)
assets/tat/           TAT pictures (grayscale JPEG)
```

## How the program works

- **Registration** gives every candidate the next chest number automatically (1, 2, 3 …). Users can't edit it.
- **Day N** of the program uses **set N** of the content. After day 30 the sets repeat.
- The candidate picks which tests to take each day and how long (e.g. WAT 20/40/60).
- Each submitted test is scored instantly against the 15 OLQs, with tags on every response
  (Positive, Negative, Blank, Preachy, Escapist, Unrealistic, Half solution, …), improvement areas,
  and an ideal approach for weak SRT answers.
- **Progress** shows the trend, average OLQ profile, recurring weak areas, a 30-day log and a
  generated overall assessment with a 7-day plan.

## How the psychologist scores

`js/engine.js` turns each response into signals (completion, positivity, concrete actions,
involving others, planning words, owning the problem, escapist or unrealistic language,
story structure, positive outcomes, stamina across the set). Each OLQ is a weighted mix of
these signals, mapped to a 1–10 scale where about 5 is a typical candidate and 7 is the
recommended level. Word lists and weights are all at the top of the file, so you can tune them.

It is a practice tool: it measures habits the board looks for, not the meaning of a story the way
a human psychologist would. Use the reports for patterns, not as a verdict.

## Database (Supabase)

`supabase/schema.sql` creates:

- `profiles`: one row per candidate, created automatically on sign-up; `chest_no` comes from a sequence and users can't change it
- `sessions`: one row per test (responses + scores); detailed feedback is regenerated from the responses when a report opens
- `olq_scores`: 15 rows per test, filled by a trigger, for fast stats
- `overall_reports`: the latest overall assessment per candidate
- `feedback`: feedback from candidates (also emailed to the address in `js/config.js` via formsubmit.co)
- `candidate_summary`: an admin view (chest no, name, tests taken, average score), readable from the Supabase dashboard

Row Level Security limits every candidate to their own rows.

### After deploying

In Supabase → Authentication → URL Configuration, set **Site URL** to the GitHub Pages address, so the
email-confirmation link brings candidates back to the site. (Or turn off "Confirm email" under
Authentication → Sign In / Providers → Email if you don't want confirmation.)

## Admin dashboard (HQ)

Open `admin.html` (the site shows an **HQ** button to admin accounts). It shows site impressions, candidates,
tests, score distributions, the average OLQ profile, practice heatmap, feedback, and a full profile for each
candidate. Data comes from admin-only database functions (`supabase/admin.sql`, `supabase/admin_overview.sql`).

## TAT pictures

Pictures 1–49 come from the supplied `ALL_TAT.pdf`, 50–54 from the supplied screenshots.
Before publishing the site publicly, make sure you have permission to use them; you can add
more by dropping JPEGs into `assets/tat/` and adding entries to `data/tat.js`.
