import type { CompletedUploadPart, VideoUploadTarget } from "./api/videos"
import { putToPresignedUrl, type PutToPresignedUrlOptions } from "./upload-to-s3"

// Parts in flight at once, and tries per part before the upload fails.
export const PART_CONCURRENCY = 3
export const PART_ATTEMPTS = 3

export type PartRange = {
  partNumber: number
  url: string
  start: number
  end: number
}

type PutPart = (
  url: string,
  body: Blob,
  options: PutToPresignedUrlOptions,
) => Promise<{ etag: string | null }>

// Byte ranges of the parts the server signed: `partSize` each, the last one
// shorter — the lengths the server signed into the URLs.
export const planPartRanges = (
  fileSize: number,
  partSize: number,
  parts: Array<{ partNumber: number; url: string }>,
): PartRange[] =>
  [...parts]
    .sort((a, b) => a.partNumber - b.partNumber)
    .map(({ partNumber, url }) => {
      const start = (partNumber - 1) * partSize
      return { partNumber, url, start, end: Math.min(start + partSize, fileSize) }
    })

// Whole-file percent from the bytes sent of each part so far.
export const combinedPercent = (
  sentByPart: ReadonlyMap<number, number>,
  total: number,
): number => {
  if (total <= 0) return 0
  let sent = 0
  for (const bytes of sentByPart.values()) sent += bytes
  return Math.min(100, Math.round((sent / total) * 100))
}

const abortError = () => new DOMException("Upload aborted", "AbortError")

// Without the header the upload cannot be completed, and trying again will
// not change storage's CORS — fail at once with what to fix.
class MissingEtagError extends Error {
  constructor() {
    super(
      "Хранилище не отдаёт заголовок ETag: в CORS хранилища нужен ExposeHeaders: ETag.",
    )
  }
}

const wait = (ms: number, signal: AbortSignal) => {
  const { promise, resolve, reject } = Promise.withResolvers<void>()
  const timer = setTimeout(() => {
    signal.removeEventListener("abort", onAbort)
    resolve()
  }, ms)
  const onAbort = () => {
    clearTimeout(timer)
    reject(abortError())
  }
  signal.addEventListener("abort", onAbort, { once: true })
  return promise
}

/**
 * Uploads `file` in the parts the server signed: PART_CONCURRENCY at a time,
 * each tried up to PART_ATTEMPTS times, with one percent across the whole
 * file. Resolves with every part's ETag in part order (what complete-upload
 * takes). Rejects with an AbortError when `signal` aborts; any part failing
 * for good stops the others.
 */
export async function uploadInParts(options: {
  file: Blob
  partSize: number
  parts: Array<{ partNumber: number; url: string }>
  signal?: AbortSignal
  onProgress?: (percent: number) => void
  put?: PutPart
  retryDelayMs?: number
}): Promise<CompletedUploadPart[]> {
  const {
    file,
    signal,
    onProgress,
    put = putToPresignedUrl,
    retryDelayMs = 1000,
  } = options
  const plan = planPartRanges(file.size, options.partSize, options.parts)
  const sent = new Map<number, number>()
  const report = () => onProgress?.(combinedPercent(sent, file.size))

  // Aborted by the caller's signal, or by this function once a part fails
  // for good, so the parts still in flight stop too.
  const stop = new AbortController()
  const onOuterAbort = () => stop.abort()
  if (signal?.aborted) stop.abort()
  signal?.addEventListener("abort", onOuterAbort, { once: true })

  const uploadPart = async (part: PartRange): Promise<CompletedUploadPart> => {
    for (let attempt = 1; ; attempt++) {
      try {
        const { etag } = await put(part.url, file.slice(part.start, part.end), {
          signal: stop.signal,
          onProgress: ({ loaded }) => {
            sent.set(part.partNumber, loaded)
            report()
          },
        })
        if (!etag) throw new MissingEtagError()
        sent.set(part.partNumber, part.end - part.start)
        report()
        return { partNumber: part.partNumber, etag }
      } catch (error) {
        // A retried part starts from zero again.
        sent.set(part.partNumber, 0)
        report()
        if (
          stop.signal.aborted ||
          (error instanceof DOMException && error.name === "AbortError") ||
          error instanceof MissingEtagError ||
          attempt >= PART_ATTEMPTS
        ) {
          throw error
        }
        await wait(retryDelayMs * attempt, stop.signal)
      }
    }
  }

  const done: CompletedUploadPart[] = []
  let next = 0
  const worker = async () => {
    while (next < plan.length) {
      if (stop.signal.aborted) throw abortError()
      const part = plan[next++]
      done.push(await uploadPart(part))
    }
  }

  try {
    await Promise.all(
      Array.from({ length: Math.min(PART_CONCURRENCY, plan.length) }, worker),
    )
  } catch (error) {
    stop.abort()
    throw signal?.aborted ? abortError() : error
  } finally {
    signal?.removeEventListener("abort", onOuterAbort)
  }
  return done.sort((a, b) => a.partNumber - b.partNumber)
}

/**
 * Sends the video file the way create-upload asked: one presigned PUT, or in
 * parts. Resolves with the parts' ETags for a multipart upload (pass them to
 * completeVideoUpload), undefined for a single PUT.
 */
export async function uploadVideoFile(
  target: VideoUploadTarget,
  file: File,
  options: {
    contentType: string
    signal?: AbortSignal
    onProgress?: (percent: number) => void
  },
): Promise<CompletedUploadPart[] | undefined> {
  if (target.method === "MULTIPART" && target.parts && target.partSize) {
    return await uploadInParts({
      file,
      partSize: target.partSize,
      parts: target.parts,
      signal: options.signal,
      onProgress: options.onProgress,
    })
  }
  if (!target.url) throw new Error("Сервер не выдал адрес для загрузки файла")
  await putToPresignedUrl(target.url, file, {
    contentType: options.contentType,
    signal: options.signal,
    onProgress: ({ percent }) => options.onProgress?.(percent),
  })
  return undefined
}
