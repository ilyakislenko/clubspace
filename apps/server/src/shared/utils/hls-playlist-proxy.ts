import { HttpException, HttpStatus } from '@nestjs/common'

import type { FilesService } from '../../infrastructure/files/services/files.service'

/**
 * One playlist of a private HLS rendition, rewritten for the player: nested
 * playlists point back at the same proxy route (`manifest.m3u8?token&path`),
 * media segments become short-lived presigned URLs. Only keys under the
 * master playlist's own directory are served (fails closed). Shared by the
 * club video and the «Разбор видео» clip manifest routes, which do their own
 * token and access checks first.
 */
export async function proxyHlsPlaylist(
    files: Pick<FilesService, 'getObjectText' | 'getPresignedGetUrl'>,
    p: { bucket: string; masterKey: string; subPath: string | undefined; token: string },
): Promise<string> {
    const masterDir = p.masterKey.split('/').slice(0, -1).join('/')
    const allowedPrefix = masterDir ? `${masterDir}/` : ''

    let key = p.masterKey
    if (p.subPath) {
        const decoded = decodeURIComponent(p.subPath)
        // Fail CLOSED: if the prefix can't be derived (master key has no
        // directory), reject rather than serving an unrestricted key.
        // Otherwise only allow keys under this rendition's own prefix.
        if (!allowedPrefix || decoded.includes('..') || !decoded.startsWith(allowedPrefix)) {
            throw new HttpException('Invalid path', HttpStatus.BAD_REQUEST)
        }
        key = decoded
    }

    const manifest = await files.getObjectText({ bucket: p.bucket, key })
    const playlistDir = key.split('/').slice(0, -1).join('/')

    const lines = manifest.split(/\r?\n/)
    const rewritten = await Promise.all(
        lines.map(async (line) => {
            const trimmed = line.trim()
            if (!trimmed || trimmed.startsWith('#')) return line
            if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
                return line
            }

            const childKey = playlistDir ? `${playlistDir}/${trimmed}` : trimmed

            if (trimmed.endsWith('.m3u8')) {
                // Recurse through this same endpoint so we can sign segments
                // referenced inside the variant playlist as well.
                return `manifest.m3u8?token=${encodeURIComponent(p.token)}&path=${encodeURIComponent(childKey)}`
            }

            return await files.getPresignedGetUrl({ bucket: p.bucket, key: childKey })
        }),
    )

    return rewritten.join('\n')
}
