# Pictures on the glasses

Updated: 2026-11-28

Chat photos, mail pictures and pictures pasted into a Claude or Codex session open full screen on
the G2. The bridge decodes a picture once with ffmpeg (`bridge/image.mjs`) and draws each view as
576x288 panel levels; the app (`app/src/main.ts`, viewer near `imageViewTiles`) shows it in the
four image tiles with a caption box in the bottom-right corner.

A click cycles the views. Swipe moves through Zoom sections or AI Readout pages, then to the next
picture; `n` toggles negative; double-click goes back.

| View | What it shows |
| --- | --- |
| Original Picture | The whole picture. Charts and screenshots in four flat tones; photos as thin bright edges over a dot pattern. |
| AI Labels | Charts only (see below). |
| Zoom | At least twice the size, in sections. |
| Outline | 1 px edges only. |
| AI Readout | The local Ollama vision model describes the picture as text (`READ_PROMPT`). |

AI Labels and AI Readout need a vision-capable model in Ollama on the bridge PC (`visionModel` in
`bridge/config.local.json`, else the Chat translation model). The bridge reports `imageRead` and
`imageLabels` in `/api/capabilities`; the app offers AI Labels only when `imageLabels` is true
(bridges before AI Labels omit it).

## AI Labels (2026-11-27)

At 576x288 in 16 green levels most of a chart's text is unreadable. AI Labels takes the local AI's
reading of each printed line and draws it back where it was printed, in Scientifica 5x11
(`bridge/chart-labels.mjs`, `app/src/fine-text.ts` `placeLabels`/`labelTiles`).

Place in the cycle: Original Picture, AI Labels, Zoom, Outline, AI Readout. It is offered only for
pictures that Original Picture draws in flat tones (`pictureStyle` = graphic). A photo asked for
AI Labels (after a swipe from a chart) answers as Original Picture and the view switches to it.

How it works:

1. **Words from the model.** One Ollama call with a JSON schema (`format`): every printed line of
   text, its role (title, subtitle, legend, axis title, x tick, y tick, annotation, data label,
   source, other) and a box in 0-1000 coordinates. The picture goes to the model as a PNG of at most
   1600 px, scaled with Lanczos. The answer is cached per picture content (sha256 of the bytes),
   so a negative toggle or a second visit does not call the model again.
2. **Positions from the picture.** The model's boxes are not accurate enough to place text next to
   tick marks (measurements below). The bridge finds the printed words itself: connected
   components of ink in the full-resolution decode, grouped into words and rows. Each model line
   gets the run of words that fits it best in position and shape. Unambiguous lines go first. Their
   offsets then correct the rest: a line along each axis for the tick rows, and an offset for
   everything else.
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

### Open (2026-11-28)

- Not seen on G2 hardware yet: placement, halo and thinning were checked on rendered previews only.
- Not live: AI Labels needs this bridge code (a bridge restart, Eugene's approval) and a beta with
  the app part. Until then the app does not offer the view (no `imageLabels` capability).
- Changed-letter misreadings ("86" for "96") are not detected; only dropped letters are.
- Vertical text (a rotated axis title) is left as printed, not redrawn.
- AI Readout still sends the model a bicubic-scaled PNG (unchanged); the Lanczos scaling that fixed
  the title misreading is used for AI Labels only.
- The Japanese strings for the view (`imageViewLabels`, `imageLabelling`, `imageLabelsNone`) are
  the agent's translation.
