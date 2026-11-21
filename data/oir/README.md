# OIR booklets

Each booklet is one JSON file in this folder, named `booklet-NN.json` (for example `booklet-01.json`).
Copy `_template.json` to start one. After adding or changing a booklet, run:

    python3 tools/oir_index.py

That checks every file and rebuilds `index.json`, which is the list the site shows on the Today page.
Until `index.json` lists at least one booklet, the OIR card stays hidden.

## Format

- `no`: the booklet number shown to candidates.
- `title`: e.g. "OIR Booklet 01".
- `source`: where the questions come from. Only add questions you have permission to use.
- `booklets`: usually two, verbal then non-verbal, each with:
  - `name`, `minutes` (the time limit), and `questions`.
- Each question:
  - `q`: question text (can be empty for a purely visual question).
  - `options`: 2–8 options. Each is either text (`"42"`) or a figure (`{ "img": "img/b01/q5-a.png" }`, optionally with `"text"`).
  - `answer`: the index of the correct option, counting from 0 (0 = A, 1 = B, 2 = C, 3 = D).
  - `img` (optional): a figure for the question. Put images under `data/oir/img/`; paths are relative to this folder.
  - `topic` (optional): e.g. "Coding-decoding". Used to show weak topics on the result page.
  - `explain` (optional): shown in the answer review.

## Scoring

One mark per correct answer, no negative marking. The share of questions right across both booklets gives the rating:

| Rating | Label | Correct |
|---|---|---|
| OIR 1 | Outstanding | 80% and above |
| OIR 2 | Excellent | 65–79% |
| OIR 3 | Above Average | 50–64% |
| OIR 4 | Average | 35–49% |
| OIR 5 | Below Average | below 35% |

DIPR doesn't publish its OIR cutoffs and grades relative to the batch, so these are practice bands.
They are set in `OIR_BANDS` in `js/app.js`.
