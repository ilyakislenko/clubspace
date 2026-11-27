import { S3 } from '@aws-sdk/client-s3'
import ffmpegStaticPath from 'ffmpeg-static'
import { createWriteStream, promises as fs } from 'fs'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'

import { PrismaClient } from '@clubspace/prisma-client'
import { PrismaPg } from '@prisma/adapter-pg'
import { environment } from './environment.js'
import { assertInputSize, assertTranscodable, probeVideo, restrictedInputArgs } from './probe.js'
import { isVirtualHostEndpoint, publicObjectUrl } from './storage-url.js'
import type { SubtitleStore } from './subtitles.js'
import type { ThumbnailStore } from './thumbnail.js'
import type { ChapterSourceFile } from './video-text.js'

// Connections and storage helpers shared by the worker (main.ts) and its
// maintenance scripts (scripts/). Opens clients on import, so — like main.ts —
// it is left out of the unit tests and their coverage.

export const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: environment.databaseUrl }),
})

export const s3Client = new S3({
    endpoint: environment.s3Storage.s3InternalUrl ?? getEndpoint(),
    credentials: {
        accessKeyId: environment.s3Storage.s3AccessKeyId,
        secretAccessKey: environment.s3Storage.s3SecretAccessKey,
    },
    region: environment.s3Storage.s3Region,
    forcePathStyle: environment.s3Storage.s3ForcePathStyle,
})

export const ffmpegBinary =
    environment.ffmpegPath ?? (ffmpegStaticPath as unknown as string | null) ?? 'ffmpeg'

// Covers go to the default bucket, where the server puts the ones coaches
// upload.
export const thumbnailStore: ThumbnailStore = {
    upload: (key, filePath) =>
        uploadFile(environment.s3Storage.s3BucketName, key, filePath, 'image/jpeg'),
    publicUrl: (key) => getPublicObjectUrl(environment.s3Storage.s3BucketName, key),
}

// Automatic subtitles too: under subtitles/, beside the ones staff upload,
// and served from the same public URL.
export const subtitleStore: SubtitleStore = {
    upload: async (key, body) => {
        await s3Client.putObject({
            Bucket: environment.s3Storage.s3BucketName,
            Key: key,
            Body: body,
            ContentType: 'text/vtt; charset=utf-8',
        })
    },
    publicUrl: (key) => getPublicObjectUrl(environment.s3Storage.s3BucketName, key),
}

export async function downloadToFile(bucket: string, key: string, filePath: string) {
    const response = await s3Client.getObject({ Bucket: bucket, Key: key })
    if (!response.Body) {
        throw new Error('Empty S3 response body')
    }
    // Refuse before a single byte lands on disk: the size is in the headers.
    try {
        assertInputSize(response.ContentLength, environment)
    } catch (error) {
        ;(response.Body as Readable).destroy()
        throw error
    }
    await pipeline(response.Body as NodeJS.ReadableStream, createWriteStream(filePath))
}

/**
 * A video's stored upload on disk, vetted exactly like the transcode does:
 * what the chapter passes read (the `video-chapters` job and the backfill).
 */
export async function downloadVettedSource(
    video: { rawBucket: string | null; rawKey: string | null },
    inputPath: string,
): Promise<ChapterSourceFile> {
    if (!video.rawKey) throw new Error('no stored upload')
    await downloadToFile(
        video.rawBucket || environment.s3Storage.s3BucketName,
        video.rawKey,
        inputPath,
    )
    const probe = await probeVideo(inputPath, {
        binary: environment.ffprobePath,
        timeoutMs: 60_000,
    })
    return {
        inputPath,
        inputArgs: restrictedInputArgs(assertTranscodable(probe, environment)),
        durationSec: probe.durationSec,
        hasAudio: probe.hasAudio,
    }
}

export async function downloadText(bucket: string, key: string) {
    const response = await s3Client.getObject({ Bucket: bucket, Key: key })
    if (!response.Body) {
        throw new Error('Empty S3 response body')
    }
    return response.Body.transformToString()
}

export async function uploadFile(
    bucket: string,
    key: string,
    filePath: string,
    contentType = key.endsWith('.m3u8')
        ? 'application/vnd.apple.mpegurl'
        : key.endsWith('.ts')
        ? 'video/mp2t'
        : undefined,
) {
    await s3Client.putObject({
        Bucket: bucket,
        Key: key,
        Body: await fs.readFile(filePath),
        ContentType: contentType,
    })
}

export function getEndpoint() {
    if (environment.s3Storage.s3AccelerateUrl) {
        return environment.s3Storage.s3AccelerateUrl
    }

    if (
        environment.s3Storage.s3BucketName &&
        isVirtualHostEndpoint(
            environment.s3Storage.s3UploadBucketUrl,
            environment.s3Storage.s3BucketName,
        )
    ) {
        return undefined
    }

    return environment.s3Storage.s3UploadBucketUrl
}

export function getPublicObjectUrl(bucket: string, key: string) {
    return publicObjectUrl(environment.s3Storage.s3UploadBucketUrl, bucket, key)
}
