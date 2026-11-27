// Public URLs of the objects the worker stores (thumbnails, subtitles, the HLS
// master playlist). Pure, so it is unit-tested; clients.ts binds it to the env.

/**
 * Virtual-host style (https://<bucket>.s3.example.com) only when the host name
 * starts with "<bucket>.". A substring test also matched origins that merely
 * contain the bucket name — https://media.clubspace.space with bucket
 * "clubspace" — and dropped the bucket from every public URL. The server's
 * FilesService applies the same rule.
 */
export const isVirtualHostEndpoint = (endpoint: string, bucket: string): boolean =>
    new URL(endpoint).hostname.startsWith(`${bucket}.`)

export const publicObjectUrl = (uploadBucketUrl: string, bucket: string, key: string): string => {
    // Lose a trailing slash; the local fake-s3 host is reached as localhost.
    const host = uploadBucketUrl.replace('s3:', 'localhost:').replace(/\/$/, '')
    const baseUrl = isVirtualHostEndpoint(host, bucket) ? host : `${host}/${bucket}`
    return `${baseUrl}/${key}`
}
