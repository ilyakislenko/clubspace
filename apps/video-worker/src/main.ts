import { S3 } from '@aws-sdk/client-s3'
import { Worker } from 'bullmq'
import { spawn } from 'child_process'
import { createWriteStream, promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { pipeline } from 'stream/promises'

import { PrismaClient } from '@bjj-academy/prisma-client'
import { PrismaPg } from '@prisma/adapter-pg'
import { environment } from './environment.js'

const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: environment.databaseUrl }),
})

const s3Client = new S3({
    endpoint: getEndpoint(),
    credentials: {
        accessKeyId: environment.s3Storage.s3AccessKeyId,
        secretAccessKey: environment.s3Storage.s3SecretAccessKey,
    },
    region: environment.s3Storage.s3Region,
    forcePathStyle: environment.s3Storage.s3ForcePathStyle,
})

const connection = {
    host: environment.redis.host,
    port: environment.redis.port,
    password: environment.redis.password,
    db: environment.redis.db,
}

console.log('[video-worker] starting...', {
    redis: {
      host: connection.host,
      port: connection.port,
      db: connection.db,
      hasPassword: Boolean(connection.password),
    },
    s3: {
      endpoint: getEndpoint() ?? '(default)',
      region: environment.s3Storage.s3Region,
      forcePathStyle: environment.s3Storage.s3ForcePathStyle,
      bucket: environment.s3Storage.s3BucketName,
    },
  })
  

const worker = new Worker(
    'video-transcode',
    async (job) => {
        const videoId = job.data?.videoId as string | undefined

        if (!videoId) {
            return
        }

        const video = await prisma.video.findUnique({
            where: { id: videoId },
        })

        if (!video || !video.rawKey) {
            return
        }

        const rawBucket = video.rawBucket || environment.s3Storage.s3BucketName
        const hlsBucket = video.hlsBucket || environment.s3Storage.s3BucketName

        const workdir = await fs.mkdtemp(join(tmpdir(), `video-${videoId}-`))
        const inputPath = join(workdir, 'source.mp4')
        const outputDir = join(workdir, 'hls')

        await prisma.video.update({
            where: { id: videoId },
            data: { status: 'processing', errorMessage: null },
        })

        try {
            await downloadToFile(rawBucket, video.rawKey, inputPath)

            await fs.mkdir(outputDir, { recursive: true })

            await runFfmpeg(inputPath, outputDir)

            const files = await fs.readdir(outputDir)
            const outputPrefix = `hls/${videoId}`

            for (const file of files) {
                const key = `${outputPrefix}/${file}`
                await uploadFile(hlsBucket, key, join(outputDir, file))
            }

            const masterKey = `${outputPrefix}/master.m3u8`

            await prisma.video.update({
                where: { id: videoId },
                data: {
                    status: 'ready',
                    hlsBucket,
                    hlsMasterKey: masterKey,
                    url: getPublicObjectUrl(hlsBucket, masterKey),
                },
            })
        } catch (error) {
            await prisma.video.update({
                where: { id: videoId },
                data: {
                    status: 'failed',
                    errorMessage: error instanceof Error ? error.message : String(error),
                },
            })
        } finally {
            await fs.rm(workdir, { recursive: true, force: true })
        }
    },
    { connection, concurrency: 1 },
)

worker.on('failed', (job, err) => {
    console.error('Video transcode failed', job?.id, err)
})

async function downloadToFile(bucket: string, key: string, filePath: string) {
    const response = await s3Client.getObject({ Bucket: bucket, Key: key })
    if (!response.Body) {
        throw new Error('Empty S3 response body')
    }
    await pipeline(response.Body as NodeJS.ReadableStream, createWriteStream(filePath))
}

async function uploadFile(bucket: string, key: string, filePath: string) {
    const contentType = key.endsWith('.m3u8')
        ? 'application/vnd.apple.mpegurl'
        : key.endsWith('.ts')
        ? 'video/mp2t'
        : undefined

    await s3Client.putObject({
        Bucket: bucket,
        Key: key,
        Body: await fs.readFile(filePath),
        ContentType: contentType,
    })
}

async function runFfmpeg(inputPath: string, outputDir: string) {
    await new Promise<void>((resolve, reject) => {
        const args = [
            '-y',
            '-i',
            inputPath,
            '-c:v',
            'h264',
            '-preset',
            'veryfast',
            '-crf',
            '23',
            '-c:a',
            'aac',
            '-b:a',
            '128k',
            '-hls_time',
            '4',
            '-hls_playlist_type',
            'vod',
            '-hls_flags',
            'independent_segments',
            '-hls_segment_filename',
            join(outputDir, 'seg_%05d.ts'),
            '-f',
            'hls',
            join(outputDir, 'master.m3u8'),
        ]

        const process = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] })
        let stderr = ''

        process.stderr.on('data', (chunk) => {
            stderr += chunk.toString()
            if (stderr.length > 5000) {
                stderr = stderr.slice(-5000)
            }
        })

        process.on('error', reject)
        process.on('close', (code) => {
            if (code === 0) {
                resolve()
            } else {
                reject(new Error(stderr || `ffmpeg exited with code ${code}`))
            }
        })
    })
}

function getEndpoint() {
    if (environment.s3Storage.s3AccelerateUrl) {
        return environment.s3Storage.s3AccelerateUrl
    }

    if (environment.s3Storage.s3BucketName) {
        const url = new URL(environment.s3Storage.s3UploadBucketUrl)
        if (url.hostname.startsWith(environment.s3Storage.s3BucketName + '.')) {
            return undefined
        }
    }

    return environment.s3Storage.s3UploadBucketUrl
}

function getPublicObjectUrl(bucket: string, key: string) {
    const host = environment.s3Storage.s3UploadBucketUrl
        .replace('s3:', 'localhost:')
        .replace(/\/$/, '')
    const isVirtualHost = host.includes(bucket)
    const baseUrl = isVirtualHost ? host : `${host}/${bucket}`
    return `${baseUrl}/${key}`
}

async function shutdown() {
    await worker.close()
    await prisma.$disconnect()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
