# video-worker

Consumes the `video-transcode` queue: downloads a coach's upload from `raw/`,
vets it with ffprobe (`src/probe.ts`), encodes the HLS ladder to `hls/<videoId>/`,
marks the video `ready` and hands it to the `video-ready` queue. Runs as
`npx nx serve @clubspace/video-worker` (dev, `scripts/dev.sh`) or the
`video-worker` compose service.

## Covers

After a successful transcode the worker cuts one JPEG frame from the source
(`src/thumbnail.ts`) and stores it as the video's cover — only while
`Video.thumbnailUrl` is still null, so a cover a coach uploaded is never
replaced. A failed cover is logged (and sent to Sentry) but never fails the job.

- **Frame:** 10% into the video, clamped to 3–60 s; the middle for clips shorter
  than 3 s; 3 s when the length is unknown; the first frame if the chosen moment
  yields nothing. Scaled to 640 px wide (never upscaled).
- **Key:** `thumbnails/<videoId>/<uuid>` in the default bucket, the same shape
  the server issues for uploaded covers; `thumbnails/` is the anonymously
  readable prefix, so the public URL works unsigned.

Courses without a cover show their first lesson's (by course order) in the
course list and course page; that fallback lives in the server's
`PlaylistService`.

### Backfill

For videos transcoded before covers existed: makes one for every `ready`
video with no cover, from the HLS rendition (one segment) or, failing that, the
stored upload. Idempotent — videos that have a cover are skipped, so a re-run
only retries failures. Prints a summary and exits non-zero if any video failed.
Same environment as the worker.

```bash
# dev (reads the root .env, like `nx serve`)
npx nx run @clubspace/video-worker:backfill-thumbnails

# production, inside the running worker container
docker compose -f docker-compose.prod.yml --env-file .env.production \
  exec video-worker node apps/video-worker/scripts/backfill-thumbnails.js
```

In production the worker's storage account needs write access to
`thumbnails/*` and read access to `hls/*` (`deploy/minio-init.sh`); re-run
`minio-init` after upgrading an existing install.

## Chapters

After a transcode hands the video off as `ready`, it queues a
`video-chapters` job (job id `chapters-<videoId>`, so queuing twice adds
nothing). The worker runs those one at a time in the same process, apart from
the transcode: a restart while chapters are read re-runs only the chapter
job, never the transcode. The job downloads the upload again and runs the
chain in `src/make-chapters.ts`: first the technique titles burned into the
picture (lower-third captions like «SLX Toe Hold», `source = 'ocr'`), vetted
by the chat model when one is configured, and only when fewer than two hold
up — and the video still has no chapters — what the instructor says
(`source = 'speech'`, see [Chapters from speech](#chapters-from-speech)).

Chapters are stored at once as `VideoTimestamp` rows, only while the video
has no chapters, so a coach's chapters are never replaced or mixed with
automatic ones. A staff edit of a title or time turns a row `manual`. A
finished scan — chapters or not — stamps `Video.chaptersScannedAt`; the job
skips stamped videos and the backfill only picks unstamped ones, so chapters
staff delete are not generated again. A failure leaves the video unstamped,
is logged (and sent to Sentry; an unreachable or unpaid model only once per
process, a warning after that) and never touches the transcode. Each ffmpeg
or whisper-cli run may take a second per second of video, within 5 minutes
to an hour. The log line `[video-worker] chapters` carries the outcome, the
source and the time each step took (OCR: about 20 s for a 19-minute lesson).

### Titles on screen

OCR is [tesseract.js](https://github.com/naptha/tesseract.js) 5 (WebAssembly,
two worker threads) with the English LSTM model from the
`@tesseract.js-data/eng` package (`4.0.0_best_int`), read from
`node_modules` — nothing is downloaded at runtime. Frames are cut by ffmpeg
from the source with the same whitelists and pinned demuxer as the transcode,
scaled to 960 px wide. The heuristics live in `src/chapters.ts`:

- **Coarse pass:** a frame every 3 s of the whole video.
- **Noise:** lines under confidence 85, captions with fewer than 6 letters
  or more than 8 words (disclaimers, subtitles) are dropped, and so are
  lines that are mostly (≥ 25% of letters) *persistent* words — words seen
  in more than 15% of the coarse frames (read whole on at least 5), matched
  fuzzily so logo fragments («SAMURA», «MURAI») count too — plus anything set
  right against such a line (the logo's tagline), and captions that say the
  same thing twice (banners and prints: «JIU-JITSU | JIU-JITSU», «CLUB CLUE»).
  More than 2000 distinct words, or more fuzzy comparisons than 250 000,
  means slides or subtitles: no titles, straight to speech.
- **Merge:** sightings of similar text (edit-distance ratio ≥ 0.8, or a
  cut-off read of the start) up to 6 s apart are one title; the reading most
  frames support wins, a read cut off ≥ 3 characters short counting for the
  full one.
- **Refine pass:** around each title, a frame every 0.5 s from the coarse
  frame before it to the one after; the chapter starts at the first frame
  showing it (rounded down to the second). A title seen in fewer than 2 of
  those frames is dropped, and so is one that repeats an earlier title.
- **Result:** chapters only when at least 2 titles survive. More than
  max(10, 2 per minute) title candidates means burned-in subtitles or
  slides, and yields none.
- **Review** (with a chat model configured): the model gets the video's and
  its courses' titles and the numbered candidates with their times, and
  names those that are not chapter captions (banners, logos, brands, event
  names, prints, OCR garbage) as `{"reject":[…]}`. An answer without a list
  rejects nothing. Fewer than 2 left → the speech step. Asked for a keep-list
  instead, a 7B local model dropped 9 of the 14 real titles of a lesson.

### Chapters from speech

For videos without titles on screen. ffmpeg extracts the audio (16 kHz mono,
same input vetting as the transcode), [whisper.cpp](https://github.com/ggml-org/whisper.cpp)'s
`whisper-cli` transcribes it (language auto-detected; `--prompt` with the
words of the video's and courses' titles as a vocabulary list, so it spells
the techniques they name — it heard «Kimura» as «Camorra» without; whole
titles made it hallucinate «7. Octopus 2.0» over real speech), and a chat
model behind any OpenAI-compatible `/chat/completions` endpoint splits the
`[mm:ss] text` transcript into chapters named after techniques, positions or
concepts (2–7 words, in the language the instructor speaks, an introduction
allowed first; JSON mode). The prompt carries the same titles and tells the
model a transcript word sounding like a technique named there is that
technique, without inventing techniques. Transcript segments that repeat the
one before word for word, or consist only of prompt words, are Whisper
hallucinating over music and are dropped. `src/speech-chapters.ts` then
checks the answer:

- parsed leniently (a bare list, a Markdown code fence, text around the JSON;
  `start`/`time`/`timestamp` as `mm:ss`, `h:mm:ss` or seconds;
  `title`/`name`); numbering, quotes, Markdown emphasis and control/format
  characters (NUL, bidi overrides) stripped off titles; a JSON object without
  a list is an empty one; an answer that is not JSON at all gets one
  follow-up message with the required shape before it counts as none;
- titles longer than 10 words, numbered placeholders («Technique 7»,
  «Часть 2») and starts outside the video are dropped;
- each start snaps to the nearest transcript segment; then in order, without
  repeated titles or starts; a chapter shorter than 20 s gives way to the next
  one (a few seconds of «Introduction» before the first technique);
- the model is asked for at most max(3, one per minute) chapters; past 1.5 ×
  that, the shortest chapter is merged into its shorter neighbour (earlier
  start, the title with fewer words, else the longer part's) until it fits;
  fewer than 2 means none.

A transcript under 40 words (music, silence) gives no chapters, and so does
a video without an audio stream. An answer that fails the checks leaves the
video without chapters (scanned). An unreachable model, an HTTP error (402
when an OpenRouter account is out of credits) or a timeout (5 min) fails the
scan: the video stays unscanned and the backfill retries it.

| Variable | |
|---|---|
| `WHISPER_CLI_PATH` | whisper.cpp CLI, default `whisper-cli` (on `PATH`) |
| `WHISPER_MODEL_PATH` | ggml model, e.g. `ggml-small.bin` (multilingual). **Unset: the speech step is off** |
| `CHAPTERS_LLM_BASE_URL` | OpenAI-compatible API root (…`/v1`). Unset: off |
| `CHAPTERS_LLM_MODEL` | model name at that API. Unset: off |
| `CHAPTERS_LLM_API_KEY` | sent as `Authorization: Bearer …`; optional (local servers) |

Without `WHISPER_*` the speech step is off; with only the `CHAPTERS_LLM_*`
variables the model still reviews OCR titles. The worker logs at startup
what is on (`chaptersLlm`, `speechChapters`).

```bash
# OpenRouter
CHAPTERS_LLM_BASE_URL=https://openrouter.ai/api/v1
CHAPTERS_LLM_MODEL=openai/gpt-4.1-mini
CHAPTERS_LLM_API_KEY=sk-or-…

# Ollama on the same machine (no key). Its default context window (4096
# tokens) holds about 10 minutes of transcript; beyond that Ollama silently
# drops the start of the prompt, rules included, and the answer is rejected.
# Give the model a bigger window — `num_ctx` cannot be set through the
# OpenAI-compatible API, so either start Ollama with
# OLLAMA_CONTEXT_LENGTH=16384, or derive a model:
#   printf 'FROM qwen2.5:7b-instruct\nPARAMETER num_ctx 16384\n' > Modelfile
#   ollama create qwen2.5:7b-instruct-16k -f Modelfile
CHAPTERS_LLM_BASE_URL=http://127.0.0.1:11434/v1
CHAPTERS_LLM_MODEL=qwen2.5:7b-instruct-16k
```

Local (macOS): `brew install whisper-cpp`, then download a model, e.g.
`curl -L -o ~/.cache/whisper-cpp/ggml-small.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin`
and set `WHISPER_MODEL_PATH` to it.

**Docker:** the image ships neither `whisper-cli` nor a model (≈ 0.5 GB for
`small`), so the step is off there by default. To turn it on, mount a
`whisper-cli` built for Alpine (musl) and a model into the container and set
`WHISPER_CLI_PATH`/`WHISPER_MODEL_PATH` to them, or build an image `FROM` this
one that compiles whisper.cpp in. Alternatively run the backfill from a host
that has both.

### Backfill

For videos the worker has not scanned (from before chapters, or whose scan
failed): runs the same chain over the stored upload of every `ready` video
with `chaptersScannedAt` null, one at a time. A video that already has
chapters is only stamped, not downloaded. Idempotent — a finished scan stamps
the video, so a re-run only revisits failures. Prints a summary (created
from titles / from speech, no chapters, kept existing, failed) and exits
non-zero if any video failed. Same environment as the worker.

`--rescan-auto` scans again every `ready` video that has no manual chapter
— after switching to a better model (OpenRouter) or improving the prompts.
Per video it deletes the chapters still `ocr`/`speech`, clears the stamp and
runs the chain; a video with any `manual` chapter is skipped untouched. A
video whose rescan fails is left without chapters and unstamped, so a plain
run retries it.

`--video <id>` (repeatable, or comma-separated) limits either mode to those
videos.

```bash
# dev (reads the root .env, like `nx serve`)
npx nx run @clubspace/video-worker:backfill-chapters
npx nx run @clubspace/video-worker:backfill-chapters -- --rescan-auto
npx nx run @clubspace/video-worker:backfill-chapters -- --rescan-auto --video=<id>,<id>

# production, inside the running worker container
docker compose -f docker-compose.prod.yml --env-file .env.production \
  exec video-worker node apps/video-worker/scripts/backfill-chapters.js [--rescan-auto] [--video <id>]
```
