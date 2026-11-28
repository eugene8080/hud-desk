# Pictures on the glasses

Updated: 2026-11-28

Chat photos, mail pictures and pictures pasted into a Claude or Codex session open full screen on
the G2. The bridge decodes a picture once with ffmpeg (`bridge/image.mjs`) and draws each view as
576x288 panel levels; the app (`app/src/main.ts`, viewer near `imageViewTiles`) shows it in the
four image tiles with a caption box in the bottom-right corner.

A click cycles the views: Original Picture, Zoom, AI Readout, then AI Labels for charts (Eugene,
2026-11-28: "it should be original, zoom, ai readout, ai labels"). Outline (1 px edges only) was
removed on 2026-11-28 (Eugene: "remove the outline image option completely"); the bridge answers an
older app's Outline request with Original Picture. Swipe moves through Zoom sections or AI Readout
pages, then to the next picture; `n` toggles negative; double-click goes back.

| View | What it shows |
| --- | --- |
| Original Picture | The whole picture. Charts and screenshots in four flat tones; photos as thin bright edges over a dot pattern. |
| Zoom | At least twice the size, in sections. |
| AI Readout | The local Ollama vision model describes the picture as text (`READ_PROMPT`). |
| AI Labels | Charts only (see below). |

AI Labels and AI Readout need a vision-capable model in Ollama on the bridge PC (`visionModel` in
`bridge/config.local.json`, else the Chat translation model). The bridge reports `imageRead` and
`imageLabels` in `/api/capabilities`; the app offers AI Labels only when `imageLabels` is true
(bridges before AI Labels omit it).

## AI Labels (2026-11-27)

At 576x288 in 16 green levels most of a chart's text is unreadable. AI Labels takes the local AI's
reading of each printed line and draws it back where it was printed, in Scientifica 5x11
(`bridge/chart-labels.mjs`, `app/src/fine-text.ts` `placeLabels`/`labelTiles`).

Place in the cycle: last, after AI Readout (2026-11-28; it came right after Original Picture in
1.0.96 and 1.0.97). It is offered only for pictures that Original Picture draws in flat tones
(`pictureStyle` = graphic). A photo asked for AI Labels (after a swipe from a chart) answers as
Original Picture and the view switches to it.

How it works:

1. **Words from the model.** The labels question is the second turn of the AI Readout
   conversation (`LABELS_CALL` in `bridge/chart-labels.mjs`), with a JSON schema (`format`):
   every printed line of text, its role (title, subtitle, legend, axis title, x tick, y tick,
   annotation, data label, source, other) and the centre point of the line in 0-1000
   coordinates. Ollama reuses the processed picture from the first turn. The picture goes to the
   model as a PNG of at most 1600 px, scaled with Lanczos (AI Readout too since 2026-11-28, so
   both turns send the same picture). Readout and labels are cached per picture content (sha256 of
   the bytes), so a negative toggle or a second visit does not call the model again. Until
   2026-11-28 it was a call of its own with a box per line (`LABELS_BOX_CALL`, still in the
   code and the tests).
2. **Positions from the picture.** The model's boxes are not accurate enough to place text next to
   tick marks (measurements below). The bridge finds the printed words itself: connected
   components of ink in the full-resolution decode, grouped into words and rows. Each model line
   gets the run of words that fits it best in position and shape (with a centre point: the run
   showing all the text's letters, not part of them). Unambiguous lines go first. Their offsets
   then correct the rest: a line along each axis for the tick rows, and an offset for everything
   else.
3. **Roles from geometry.** Three or more short lines on one row are x ticks, three in a column y
   ticks; a "tick" alone in its row is the axis title. A column of y ticks keeps the edge it
   shares; a line whose first letters touch a series line keeps its intact edge.
4. **Screen.** The Original Picture rendering with the matched words' pixels (and punctuation that
   hangs below them) cleared to the background level. Lines, gridlines, dashed reference lines,
   markers and legend swatches keep their pixels. Labels go to the app in screen coordinates
   (`text`, `role`, `align`, `x`, `y`).
5. **Drawing (app).** Scientifica 5x11 letters with a 1 px background halo. Labels are placed by
   priority: title, subtitle, annotation, axis title, legend, source, data label, then ticks. A
   note close under a tick row steps up to 4 px away from it. Colliding ticks are thinned (the
   last tick, often the full end date, is kept). A label wider than the screen is left out, never
   cut. Negative works as in the other views.

Truthfulness rules:

- Words and numbers come only from the model; the app never computes or fills in a value.
- A model line that matches no printed words (an invented value over empty space, a whole-image
  box) is left out.
- A line whose printed words show more letters than the model's text has is a misreading and is
  left out; its original pixels stay. (A changed letter, "86" for "96", cannot be detected this
  way.) Seen once on a real chart: a doubled letter of the title read once, with ffmpeg's default
  scaling; Lanczos scaling read it right.
- Text on its side (a vertical axis title) is left as printed.
- When nothing usable comes back, the picture is shown as Original Picture with the caption
  "AI Labels: no text read".

### Measurements (2026-11-27, qwen3.8:27b on the bridge PC, RTX 5090)

Synthetic charts with exact text boxes (`scripts/make-chart-fixtures.py`; fixtures and recorded
model answers in `tests/fixtures/charts/`):

| Chart | Lines | Model box error (screen px, median / max) | On the right words | Label anchor error (median / max) |
| --- | --- | --- | --- | --- |
| line-reference | 23 | 7.2 / 19.1 | 23 | 0.40 / 1.41 |
| bar-groups | 26 (1 vertical) | 4.2 / 14.4 | 25 (vertical left as printed) | 0.44 / 1.90 |
| right-axis-dark | 20 | 1.1 / 3.0 | 20 | 0.48 / 0.74 |

With the first prompt wording the model's own boxes were worse (median 14.4, max 24.3 on
line-reference: month ticks drawn on the axis line and drifting along it). A wording with the role
definitions before the box request returned [0, 0, 1000, 1000] for every line on two charts. Such
boxes are counted as unusable; when more than a third are, the bridge asks once more with the plain
wording.

Charts without exact boxes (checked by eye on previews): a real line chart from a mail newsletter
(27 lines, 27 on the right words, 26 drawn, one tick thinned; private, nothing from it is in the
repository) and the store's synthetic markets chart (22 lines, 22 matched, 21 drawn).

Time per picture, warm model: AI Labels 4.1-5.5 s (one model call; matching under 0.1 s); negative
toggle or revisit 0.02-0.07 s; AI Readout 0.8-1.8 s. The first call after the model was unloaded
took 10.8 s.

One model call for both views was tried: a `readout` field next to the label list. It took as
long as the labels call alone. AI Readout's text got worse: one paragraph instead of lines, the
per-day values dropped on one chart, and a wrong value on another. The two calls stay separate:
AI Labels is cached per picture content, AI Readout per picture as before.

## Speed: one conversation, centre points, reading in the background (2026-11-28)

Eugene asked (2026-11-28) whether AI Readout and AI Labels could share one reading, with AI Labels
last, and to measure instead of guessing. Measured on the bridge PC (qwen3.8:27b, RTX 5090, model
warm), with the three synthetic charts, the store's markets chart and a real newsletter chart
(private; nothing from it is in the repository). Each call was timed 3 times; medians below.
"Image new": every call came after a call on another picture, and Ollama's prompt time shows it
was processed in full (about 2,500 tokens/s); the only cache hits were the ones a variant is built
on (the second turn of a conversation) and one round of readouts that hit prompts Ollama still
held from the round before (those runs are not the medians).

Variants (time from the click, for the labels call; the readout is 1.1-2.0 s in all of them):

| Variant | Labels call (s, median per chart) | Tokens written | On the right words | Readout |
| --- | --- | --- | --- | --- |
| V0: box per line, own call (1.0.96) | 4.4-5.8 | 760-1030 | all (bar chart once 20 of 25: model variation) | reference |
| V1: V0 with the readout text as context | 4.3-7.4 | 760-1610 | as V0 | as V0 |
| V2: text and role only, no position | 2.2-4.1 | 310-710 | 3, 16 and 3 lines on other values' words; 7-8 moved on the real charts | as V0 |
| V2b: centre point, own call | 3.4-4.6 | 570-770 | as V0 (real chart: 26 of 27 matched) | as V0 |
| V3: box per line, second turn of the readout | 3.7-4.9 | as V0 | as V0 | same text on PNG charts; on the JPEG chart (Lanczos instead of bicubic) one value closer to the chart, the unit dropped once |
| V3 + V2b: centre point, second turn (built) | 2.8-3.9 | 570-770 | as V0; anchors within 1.1 px | as V3 |
| V5: one JSON call, readout lines first, then centre points | readout part 1.4-2.5, all 5.7-7.7 | 1140-1500 | real charts: 25 of 27 and 22 of 22 matched | changed: per-day values dropped on 3 charts, Mar 44 and Apr 50 (data 45, 52), title word misread |
| V6: one plain-text call: readout, a divider line, then `role, x,y, text` lines | readout part 1.1-2.3, all 2.9-4.1 | 500-600 | real charts: 25 of 27 and 20 of 22 matched | changed: per-day values dropped on 3 charts, Apr 50 and Sep 54 (data 52, 55) |

- Writing the answer is most of the time (about 4.7 ms a token); the second turn saves only the
  picture's processing (0.2 s instead of 0.4-1.3 s).
- Without positions (V2), same-shape values ("40" and "50", the bar values) were put on each
  other's places: not used. A centre point is enough for the matcher.
- V1 was no faster and on one chart wrote 60 % more.
- One call for both answers (V5, V6; Eugene asked, 2026-11-28): with the labels instructions in the
  same prompt, the readout turned into summary prose and lost values, and fewer labels matched on
  the real charts. V6 was the fastest in total, but only V3 keeps today's readout word for word
  (it is today's call, alone in its turn), so V3 + V2b was built.

Reading in the background (V4, built): when a chart opens in Original Picture the bridge starts
its AI Readout and then its AI Labels reading (`prefetchFor` in `bridge/image.mjs`). The model
queue (`modelQueue`) keeps one call at a time and puts the view on screen before background work.
Any request for another picture stops the background work of the one left; the in-flight call is
aborted and Ollama stops generating. The app sends `POST /api/image/idle` when the viewer
closes. A view on screen that needs a background job joins it and is not stopped. The app paints
its "Loading" page or "Reading" note only when an answer takes over 0.3 s, so a ready answer costs
one repaint of the glasses.

What Eugene would feel in his order (Original, Zoom, AI Readout, AI Labels; 3 s on each view; each
chart a fresh copy no cache had seen; medians of 3 runs):

| Mode | Wait at AI Readout (s) | Wait at AI Labels (s) |
| --- | --- | --- |
| Today's calls, no background reading | 1.2-2.2 | 4.6-5.9 |
| New call (V3 + V2b), no background reading | 1.3-2.2 | 2.8-3.9 |
| Background reading, today's calls | 0.00 | 0.02-0.04 |
| Background reading, new call (built) | 0.00 | 0.01-0.04 |
| The same at 1 s on each view: today's calls | 0.00 | 2.4-4.3 |
| The same at 1 s on each view: new call (built) | 0.00 | 1.1-2.4 |

Every chart drew the same number of labels in every mode and run (23, 25, 20, 22, 27).

Cost of the background reading:

- Model busy per chart opened and left open: 5.0 s with the new call (6.4 s with today's calls).
- Model free 0.03 s after the viewer closes (the call in flight is aborted).
- A second chart opened 2 s after the first: its AI Readout in 1.3 s, because the first chart's
  reading is stopped (3.9 s when it is not stopped).

The background reading also runs for charts Eugene never reads further; it is stopped when he
opens another picture or closes the viewer. Chat translation uses Ollama outside this queue, so it
can share the GPU with a background reading.

### Open (2026-11-28)

- AI Labels was confirmed on G2 (1.0.96, Eugene: works great); the order, the call and the
  background reading of 2026-11-28 are not yet seen on G2.
- Changed-letter misreadings ("86" for "96") are not detected; only dropped letters are.
- Vertical text (a rotated axis title) is left as printed, not redrawn.
- The Japanese strings for the view (`imageViewLabels`, `imageLabelling`, `imageLabelsNone`) are
  the agent's translation.
