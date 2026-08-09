import * as AWS from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { Inject, Injectable } from '@nestjs/common'
import { Readable } from 'stream'

import { FILES_CONFIG, type FilesConfig } from '../files.config'

// A thin S3 wrapper: presigned URLs, object reads/deletes, URL building. It
// owns no persistence — the `File` table is written by the feature slices that
// need it, so nothing here needs Prisma.
@Injectable()
export class FilesService {
    private s3Client: AWS.S3

    constructor(
        @Inject(FILES_CONFIG)
        private readonly config: FilesConfig,
    ) {
        const s3ClientConfig: AWS.S3ClientConfig = {
            endpoint: this.getEndpoint(),
            credentials: {
                accessKeyId: this.config.s3AccessKeyId,
                secretAccessKey: this.config.s3SecretAccessKey,
            },
            region: this.config.s3Region,
            forcePathStyle: this.config.s3ForcePathStyle,
        }

        this.s3Client = new AWS.S3(s3ClientConfig)
    }

    async deleteObject(payload: { bucket: string; key: string }) {
        await this.s3Client.deleteObject({
            Bucket: payload.bucket,
            Key: payload.key,
        })
    }

    async deleteObjectsByPrefix(payload: { bucket: string; prefix: string }) {
        let continuationToken: string | undefined

        do {
            const response = await this.s3Client.listObjectsV2({
                Bucket: payload.bucket,
                Prefix: payload.prefix,
                ContinuationToken: continuationToken,
            })

            const keys =
                response.Contents?.map((item) => item.Key).filter(
                    (key): key is string => Boolean(key),
                ) ?? []

            if (keys.length > 0) {
                await this.s3Client.deleteObjects({
                    Bucket: payload.bucket,
                    Delete: {
                        Objects: keys.map((key) => ({ Key: key })),
                    },
                })
            }

            continuationToken = response.NextContinuationToken
        } while (continuationToken)
    }

    getDefaultBucketName() {
        return this.config.s3BucketName
    }

    async getPresignedPutUrl(payload: {
        bucket: string
        key: string
        contentType: string
        expiresInSeconds?: number
    }) {
        const command = new AWS.PutObjectCommand({
            Bucket: payload.bucket,
            Key: payload.key,
            ContentType: payload.contentType,
        })

        const url = await getSignedUrl(this.s3Client, command, {
            expiresIn: payload.expiresInSeconds ?? 15 * 60,
        })

        return {
            url,
            method: 'PUT' as const,
        }
    }

    async getPresignedGetUrl(payload: {
        bucket: string
        key: string
        expiresInSeconds?: number
    }) {
        const command = new AWS.GetObjectCommand({
            Bucket: payload.bucket,
            Key: payload.key,
        })

        return await getSignedUrl(this.s3Client, command, {
            expiresIn: payload.expiresInSeconds ?? 4 * 60 * 60,
        })
    }

    async getObjectText(payload: { bucket: string; key: string }) {
        const result = await this.s3Client.getObject({
            Bucket: payload.bucket,
            Key: payload.key,
        })

        if (!result.Body) {
            throw new Error('Empty object body')
        }

        const stream = result.Body as Readable
        const buffer = await FilesService.streamToBuffer(stream)
        return buffer.toString('utf-8')
    }

    async objectExists(payload: { bucket: string; key: string }) {
        try {
            await this.s3Client.headObject({
                Bucket: payload.bucket,
                Key: payload.key,
            })
            return true
        } catch {
            return false
        }
    }

    getPublicObjectUrl(payload: { bucket: string; key: string }) {
        const baseUrl = this.getPublicEndpoint(true, payload.bucket)
        return `${baseUrl}/${payload.key}`
    }

    private getEndpoint() {
        if (this.config.s3AccelerateUrl) {
            return this.config.s3AccelerateUrl
        }

        // support old path-style S3 uploads and new virtual host uploads by
        // checking for the bucket name in the endpoint url.
        if (this.config.s3BucketName) {
            const url = new URL(this.config.s3UploadBucketUrl)
            if (url.hostname.startsWith(this.config.s3BucketName + '.')) {
                return undefined
            }
        }

        return this.config.s3UploadBucketUrl
    }

    private getPublicEndpoint(
        isServerUpload?: boolean,
        bucketName: string = this.config.s3BucketName,
    ) {
        if (this.config.s3AccelerateUrl) {
            return this.config.s3AccelerateUrl
        }

        // lose trailing slash if there is one and convert fake-s3 url to localhost
        // for access outside of docker containers in local development
        const isDocker = this.config.s3UploadBucketUrl.match(/http:\/\/s3:/)

        const host = this.config.s3UploadBucketUrl
            .replace('s3:', 'localhost:')
            .replace(/\/$/, '')

        // support old path-style S3 uploads and new virtual host uploads by checking
        // for the bucket name in the endpoint url before appending.
        const isVirtualHost = host.includes(bucketName)

        if (isVirtualHost) {
            return host
        }

        return `${host}/${isServerUpload && isDocker ? 's3/' : ''}${bucketName}`
    }

    private static async streamToBuffer(stream: Readable): Promise<Buffer> {
        const buffer: Uint8Array[] = []

        return new Promise((resolve, reject) =>
            stream
                .on('error', (error) => reject(error))
                .on('data', (data) => buffer.push(data))
                .on('end', () => resolve(Buffer.concat(buffer))),
        )
    }
}
