import { BadRequestError } from '../../../shared/errors/shared.errors'

// S3 numbers parts 1..10 000; a file needing more cannot be uploaded in parts.
export const S3_MAX_PARTS = 10_000

// Presigned part URLs are used one after another for as long as the whole
// upload runs — hours for a large file on a slow line — so they outlive it.
// Matches MinIO's default expiry of an unfinished multipart upload (24 h).
export const UPLOAD_PART_URL_TTL_SECONDS = 24 * 60 * 60

export type UploadPartPlan = { partNumber: number; contentLength: number }

export type CompletedUploadPart = { partNumber: number; etag: string }

// A file is uploaded in parts only when it is bigger than one part; smaller
// files, and clients that declare no size, keep the single presigned PUT.
export const isMultipartUpload = (
    sizeBytes: number | undefined,
    partBytes: number,
): sizeBytes is number => sizeBytes !== undefined && sizeBytes > partBytes

// The parts a file of `sizeBytes` goes up in: `partBytes` each, the last one
// shorter. Each length is signed into its URL, so storage refuses any other.
export const planUploadParts = (
    sizeBytes: number,
    partBytes: number,
): UploadPartPlan[] => {
    const count = Math.ceil(sizeBytes / partBytes)
    if (count > S3_MAX_PARTS) {
        throw new BadRequestError({
            message: 'Файл слишком большой для загрузки по частям',
        })
    }
    return Array.from({ length: count }, (_, i) => ({
        partNumber: i + 1,
        contentLength: Math.min(partBytes, sizeBytes - i * partBytes),
    }))
}

// The parts as CompleteMultipartUpload wants them: ascending, each number
// once, 1..n with no gap — a missing or repeated part means the client did
// not upload the whole file.
export const orderCompletedParts = (
    parts: CompletedUploadPart[],
): CompletedUploadPart[] => {
    const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber)
    ordered.forEach((part, i) => {
        if (part.partNumber !== i + 1) {
            throw new BadRequestError({
                message: 'Загружены не все части файла. Загрузите видео ещё раз.',
            })
        }
    })
    return ordered
}
