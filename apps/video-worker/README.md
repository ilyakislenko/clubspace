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
