import 'multer'

import * as AWS from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { Inject, Injectable, Logger } from '@nestjs/common'
import sharp from 'sharp'
import { Readable } from 'stream'
import { v4 as generateUuidV4 } from 'uuid'

import { parseMetaArgs } from '../../../shared/utils/parse-meta-args.util'
import { PrismaService } from '../../prisma'
import { FILES_CONFIG, type FilesConfig } from '../files.config'
import { UploadFileDto } from '../interfaces/files.interfaces'

@Injectable()
export class FilesService {
    private logger = new Logger()
    private s3Client: AWS.S3

    constructor(
        @Inject(FILES_CONFIG)
        private readonly config: FilesConfig,
        private readonly prisma: PrismaService,
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

    async getFile(payload: { id: string }) {
        const file = await this.prisma.file.findUniqueOrThrow({
            where: {
                id: payload.id,
            },
        })

        return file
    }

    async getFiles(payload: {
        userId: string
        curPage?: number
        perPage?: number
        orderBy?: {
            createdAt?: 'asc' | 'desc'
        }
    }) {
        const { skip, take, curPage, perPage } = parseMetaArgs({
            curPage: payload.curPage,
            perPage: payload.perPage,
            defaults: {
                curPage: 1,
                perPage: 20,
            },
        })

        const total = await this.prisma.file.count({
            where: {
                userId: payload.userId,
            },
        })

        const files = await this.prisma.file.findMany({
            where: {
                userId: payload.userId,
            },
            orderBy: {
                createdAt: payload.orderBy?.createdAt,
            },
            skip,
            take,
        })

        return {
            meta: {
                total,
                curPage,
                perPage,
            },
            data: files,
        }
    }

    async deleteFile(payload: { id: string }) {
        const file = await this.prisma.file.findUniqueOrThrow({
            where: {
                id: payload.id,
            },
        })

        await this.s3Client.deleteObject({
            Bucket: this.config.s3BucketName,
            Key: file.id,
        })

        await this.prisma.file.delete({
            where: {
                id: payload.id,
            },
        })
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

    async uploadFileGraphql(file: Promise<UploadFileDto>, userId: string) {
        const { filename, mimetype, createReadStream } = await file

        try {
            const key = generateUuidV4()
            const body = await FilesService.streamToBuffer(createReadStream())

            const uploadResult = await this.s3Client.putObject({
                ACL: this.config.s3Acl,
                Bucket: this.config.s3BucketName,
                Key: key,
                ContentType: mimetype,
                Body: body,
                BucketKeyEnabled: false,
            })

            const locationEndpoint = this.getPublicEndpoint(true)

            const savedFileData = await this.prisma.file.create({
                data: {
                    originalName: filename,
                    mimeType: mimetype,
                    size: body.byteLength,
                    bucket: this.config.s3BucketName,
                    id: key,
                    eTag: uploadResult.ETag,
                    location: `${locationEndpoint}/${key}`,
                    userId,
                },
            })

            this.logger.log(`File uploaded: ${JSON.stringify(savedFileData)}`)

            return savedFileData.id
        } catch (error) {
            this.logger.error(error)
            throw error
        }
    }

    async uploadFileRest(
        file: Express.Multer.File,
        userId: string,
        options?: { compress?: boolean },
    ) {
        try {
            const key = generateUuidV4()
            const shouldCompress =
                options?.compress !== false &&
                this.isImageType(file.mimetype) &&
                this.isCompressibleImage(file.mimetype)

            let processedBuffer = file.buffer
            let processedMimeType = file.mimetype
            let processedSize = file.size

            if (shouldCompress) {
                const compressionResult = await this.compressImage(
                    file.buffer,
                    file.mimetype,
                )
                processedBuffer = compressionResult.buffer
                processedMimeType = compressionResult.mimeType
                processedSize = compressionResult.size
            }

            const uploadResult = await this.s3Client.putObject({
                ACL: this.config.s3Acl,
                Bucket: this.config.s3BucketName,
                Key: key,
                ContentType: processedMimeType,
                Body: processedBuffer,
                BucketKeyEnabled: false,
            })

            const locationEndpoint = this.getPublicEndpoint(true)

            const savedFileData = await this.prisma.file.create({
                data: {
                    id: key,
                    originalName: file.originalname,
                    mimeType: processedMimeType,
                    size: processedSize,
                    bucket: this.config.s3BucketName,
                    eTag: uploadResult.ETag,
                    location: `${locationEndpoint}/${key}`,
                    userId,
                },
            })

            this.logger.log(`File uploaded: ${JSON.stringify(savedFileData)}`)

            return {
                id: savedFileData.id,
                key: savedFileData.id,
            }
        } catch (error) {
            this.logger.error(error)
            throw error
        }
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

    private isImageType(mimeType: string): boolean {
        return mimeType.startsWith('image/')
    }

    private isCompressibleImage(mimeType: string): boolean {
        return (
            mimeType === 'image/jpeg' ||
            mimeType === 'image/jpg' ||
            mimeType === 'image/png' ||
            mimeType === 'image/webp'
        )
    }

    private async compressImage(
        buffer: Buffer,
        mimeType: string,
    ): Promise<{ buffer: Buffer; mimeType: string; size: number }> {
        try {
            let sharpInstance = sharp(buffer)

            sharpInstance = sharpInstance.resize(2048, 2048, {
                fit: 'inside',
                withoutEnlargement: true,
            })

            if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
                const compressedBuffer = await sharpInstance
                    .rotate()
                    .jpeg({
                        quality: 85,
                        progressive: true,
                        mozjpeg: true,
                    })
                    .toBuffer()

                return {
                    buffer: compressedBuffer,
                    mimeType: 'image/jpeg',
                    size: compressedBuffer.length,
                }
            } else if (mimeType === 'image/png') {
                const compressedBuffer = await sharpInstance
                    .rotate()
                    .png({
                        quality: 85,
                        compressionLevel: 9,
                    })
                    .toBuffer()

                return {
                    buffer: compressedBuffer,
                    mimeType: 'image/png',
                    size: compressedBuffer.length,
                }
            } else if (mimeType === 'image/webp') {
                const compressedBuffer = await sharpInstance
                    .rotate()
                    .webp({
                        quality: 85,
                        effort: 6,
                    })
                    .toBuffer()

                return {
                    buffer: compressedBuffer,
                    mimeType: 'image/webp',
                    size: compressedBuffer.length,
                }
            }

            return {
                buffer,
                mimeType,
                size: buffer.length,
            }
        } catch (error) {
            this.logger.warn(
                `Failed to compress image: ${error}. Using original.`,
            )
            return {
                buffer,
                mimeType,
                size: buffer.length,
            }
        }
    }
}
