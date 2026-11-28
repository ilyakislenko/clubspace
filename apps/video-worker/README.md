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
job, never the transcode. The job downloads the upload again and runs
`src/video-text.ts`: first the transcript and automatic subtitles (see
[Transcripts and subtitles](#transcripts-and-subtitles)), then the chapter
chain: the technique titles burned into the picture (lower-third captions
like «SLX Toe Hold», `source = 'ocr'`), vetted by the chat model when one is
configured, and only when fewer than two hold up — and the video still has
no chapters — what the instructor says (`source = 'speech'`, see
[Chapters from speech](#chapters-from-speech)). The upload is downloaded at
most once per job, and only when a step needs it.

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

Staff's «Пересоздать главы/субтитры» on the admin video page queues the same
job with `{ regenerate: true }` (job id `chapters-regen-<videoId>`). The
server first deletes the automatic chapters (only when the video has no
manual ones) and clears the stamp, and/or deletes the automatic subtitle
tracks; the job then ignores the stamp, makes chapters only if the stamp is
clear, and remakes the missing tracks from the stored transcript.

After every chapters job (and with `backfill-techniques` for all ready
videos) the lesson's «Техники» mentions are rebuilt: the techniques of the
club sport's glossary (`libs/sport-glossary`) named in its chapter titles,
transcript and Russian translation, stored as `VideoTechniqueMention` rows.

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

For videos without titles on screen. The video's transcript (see
[Transcripts and subtitles](#transcripts-and-subtitles): Whisper, technique
names snapped to the glossary, hallucinations dropped) goes as `[mm:ss] text`
to a chat model behind any OpenAI-compatible `/chat/completions` endpoint,
which splits it into chapters named after techniques, positions or concepts
(2–7 words, in the language the instructor speaks, an introduction allowed
first; JSON mode). The prompt carries the video's titles and up to 80 of the
sport's terms, and tells the model that a word sounding like one of them is
that technique, without inventing techniques. `src/speech-chapters.ts`
then checks the answer:

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
| `WHISPER_MODEL_PATH` | ggml model, e.g. `ggml-small.bin` (multilingual). **Unset: no transcripts, so no subtitles or speech chapters** |
| `CHAPTERS_LLM_BASE_URL` | OpenAI-compatible API root (…`/v1`). Unset: off |
| `CHAPTERS_LLM_MODEL` | model name at that API. Unset: off |
| `CHAPTERS_LLM_API_KEY` | sent as `Authorization: Bearer …`; optional (local servers) |

Without `WHISPER_*` there are no transcripts; with only the `CHAPTERS_LLM_*`
variables the model still reviews OCR titles. The worker logs at startup
what is on (`chaptersLlm`, `whisper`).

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

**Docker:** build the image with `--build-arg WITH_WHISPER=1` (compose:
`WITH_WHISPER=1` in the env file) to compile a pinned whisper.cpp release in —
a portable CPU build that picks the best code path for the CPU at run time;
`whisper-cli` lands on `PATH`. The default build ships no whisper, and no
image ships a model (≈ 0.5 GB for `small`): `deploy/whisper-model.sh` (the
`whisper-model` compose service) downloads a pinned, checksummed one into the
`whisper_models` volume, mounted read-only at `/models`. Step by step:
`deploy/README.md`, «Расшифровка речи (Whisper)».

### Glossary

Technique names are snapped to their spelling in a glossary
(`src/term-snap.ts`) in OCR titles, in the transcript before the model reads
it, and in the model's titles: «Komura»/«Camorra»/«Khmer» → «Kimura»,
«Inside Sankakuh»/«Inside Sankal» → «Inside Sankaku», «Omaplata» →
«Omoplata», «Darcy choke» → «Darce choke», «Комура» → «Кимура» (keeping the
Russian case ending: «комуру» → «кимуру»). Known mishearings too short to
snap by spelling are replaced by a per-sport list (`SPORT_MISHEARINGS`:
«ghee» → «gi», «no ghee» → «no-gi»). The log line carries them:
`snapped: ["Komura→Kimura ×2"]`.

- **Terms:** the sport's list for the club's `WorkspaceType`
  (`libs/sport-glossary/src/glossary.ts`: 230 grappling terms, 49 of them Russian;
  short lists for fitness, yoga, dance; none for custom clubs), plus the
  club's own words — uncommon words of its course and video titles, and its
  staff's chapter titles (`source = 'manual'`; up to 3 words as a phrase).
  Automatic chapters are never used, so a misreading cannot confirm itself.
- **Match:** a span of 1–3 words against a term of as many words, in the same
  script — one changed letter from 5 letters up (one added or dropped from
  6), two edits from 7, or the same consonant skeleton (Cyrillic
  transliterated) from 6 letters with at most 60% of the letters different.
- **Never changed:** ordinary words — the ~10k most common English words
  (`src/common-english-words.ts`, generated from SCOWL size 10 + 20 via the
  `wordlist-english` package) and a hand-written list of common Russian ones
  — so «camera», «comma», «guard», «drill» stay; glossary words themselves;
  words under 4 letters; an English term with an ending («Kimuras»,
  «sprawled»); a Russian term declined («кимуру»).
- **Whisper's prompt** holds only terms relevant to the titles: with the 45
  commonest grappling terms it wrote the Kimura of «Octopus 2.0 · Vol 4 ·
  часть 3» as «commuter» — an ordinary word nothing may correct afterwards.

Rescan videos to apply it to existing automatic chapters (see Backfill).

### Backfill

For videos the worker has not scanned (from before chapters, or whose scan
failed): runs the same chain over the stored upload of every `ready` video
with `chaptersScannedAt` null, one at a time. A video that already has
chapters is only stamped, not downloaded. Idempotent — a finished scan stamps
the video, so a re-run only revisits failures. Prints a summary (created
from titles / from speech, no chapters, kept existing, failed) and exits
non-zero if any video failed. Same environment as the worker. Like the job,
it transcribes and subtitles a video that has no transcript yet.

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

## Transcripts and subtitles

Every video gets a transcript once, and every video with speech (a
transcript of 40 words or more) gets automatic subtitles — in the spoken
language and in Russian, the members' language. Both are made by the
`video-chapters` job (before the chapter chain, which reuses the transcript)
and by `backfill-transcripts`.

- **Transcript:** ffmpeg extracts the audio (16 kHz mono, same input vetting
  as the transcode), [whisper.cpp](https://github.com/ggml-org/whisper.cpp)'s
  `whisper-cli` transcribes it (language auto-detected; `--prompt` with the
  words of the video's and courses' titles plus the glossary terms sharing a
  word with them, ≈ 200 tokens at most — see [Glossary](#glossary)).
  Segments that repeat the one before word for word, or consist only of
  prompt words, are Whisper hallucinating over music and are dropped;
  technique names are snapped to the glossary. Stored as `VideoTranscript`
  (`language`, `segments: [{ from, to, text }]` in seconds) — also for a
  silent video or one without audio (empty, language `und`), so it is never
  downloaded again for it. A stored transcript is read back, not redone.
- **Cues** (`src/subtitles.ts`): a segment shorter than 1 s or 3 words joins
  the one before (within 1 s, while the two fit 84 characters); a segment is
  cut into cues of at most two lines of 42 characters and about 6 s — but
  never into cues under 5 words — each timed by its share of the letters.
  WebVTT, `HH:MM:SS.mmm`, two balanced lines; `-->` and `<`/`>` cannot
  appear in a cue. The app's parser (`apps/mobile/src/features/video/subtitle-vtt.ts`)
  reads them back cue for cue (`src/subtitles.spec.ts`).
- **Russian:** when the speech is not Russian, the chat model
  (`CHAPTERS_LLM_*`) translates whole sentences — segments joined up to a
  full stop, at most 300 characters; Whisper often cuts mid-sentence, and a
  7B model given half-sentences merged them and shifted every later line —
  15 per request, as JSON `{"cues":[{"id","text"}]}` by id. The prompt asks
  for natural spoken Russian, as a Russian-speaking coach would say it, short
  enough to read; the sport's terms the way Russian-speaking athletes say
  them — each request lists the terms its phrases say from the bilingual
  glossary (`SPORT_RUSSIAN_TERMS` in `libs/sport-glossary/src/glossary.ts`, per
  `WorkspaceType`; grappling: gi → ги, crossface → кроссфейс, crucifix →
  крусификс, octopus guard → октопус-гард, half guard → полугард, …) —
  other names kept in Latin letters as the instructor says them; each phrase
  on its own, nothing added or dropped. The answer is then put right where
  the English said a term: its known mistranslations («крестный захват»,
  «крест», «осьминог», «гее», with case endings) and the term left in Latin
  letters become the glossary's form (`fixTerminology`; an ending after a
  preposition is carried over: «перекрёстным захватом» → «кроссфейсом»). An
  answer that is not JSON is asked again once with the shape spelled out;
  phrases an answer left out are asked for again in lists of 3, twice; still
  missing → no Russian track (never a track with holes). Each sentence's
  translation is spread over its cues by their share of the letters, so the
  times stay those of the speech. The
  translated cues are also stored as `VideoTranscript.translations`
  (`{ "ru": [{ from, to, text }] }`) for search inside videos.
- **Tracks:** uploaded like a staff upload (`subtitles/<videoId>/<lang>/<uuid>.vtt`,
  the anonymously readable prefix) and stored as `VideoSubtitle` rows with
  `source = 'auto'`, labelled «English (авто)», «Русский (авто)» (the
  language's own name). A language that has a track is left alone; staff's
  tracks (`source = 'manual'`, every upload through the admin) are never
  replaced, and an upload replaces an automatic track. The Russian track
  becomes the default only when the video has no default track.
- **Never fails the job:** a failed or unusable step is logged
  (`subtitles: { en: 'created', ru: 'translation unusable' }`) and the
  chapter chain runs on.

The worker's storage account needs write access to `subtitles/*`
(`deploy/minio-init.sh`); re-run `minio-init` after upgrading an existing
install. It cannot delete there, so a redone automatic track leaves its old
file behind (unreferenced).

### Backfill

For videos from before transcripts: every `ready` video without a
`VideoTranscript`, one at a time — transcribed from the stored upload, then
subtitled. Chapters are left to `backfill-chapters`. Idempotent: a re-run only
revisits videos whose transcript failed. Prints a summary and exits non-zero
if any video failed. Same environment as the worker; needs `WHISPER_*`.

`--redo-auto-subtitles` rebuilds the automatic tracks of transcribed videos
from their stored transcript, without a download — after a better chat model
or prompt. Staff's tracks stay. `--video <id>` (repeatable, or
comma-separated) limits either mode to those videos.

```bash
# dev (reads the root .env, like `nx serve`)
npx nx run @clubspace/video-worker:backfill-transcripts
npx nx run @clubspace/video-worker:backfill-transcripts -- --video=<id>,<id>
npx nx run @clubspace/video-worker:backfill-transcripts -- --redo-auto-subtitles

# production, inside the running worker container
docker compose -f docker-compose.prod.yml --env-file .env.production \
  exec video-worker node apps/video-worker/scripts/backfill-transcripts.js [--redo-auto-subtitles] [--video <id>]
```
