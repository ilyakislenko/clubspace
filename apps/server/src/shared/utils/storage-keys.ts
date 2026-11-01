import { randomUUID } from 'crypto'

// Object keys the API hands out for client uploads, and the checks that a key
// (or a public URL) coming back from a client is one of them. Builders and
// validators live together so the two cannot drift apart: the bucket is
// shared by every club, and a client-supplied key that is later deleted or
// served must never reach another club's `raw/` or `hls/` objects.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Same rule as the subtitle DTOs' `language` field (a BCP-47-ish tag).
export const SUBTITLE_LANGUAGE = /^[a-zA-Z][a-zA-Z0-9-]*$/

// Language goes in the path so a re-upload of "ru" replaces the previous
// Russian track instead of orphaning files.
export const buildSubtitleKey = (videoId: string, language: string) =>
    `subtitles/${videoId}/${language}/${randomUUID()}.vtt`

/**
 * True only for a key `buildSubtitleKey(videoId, language)` could have
 * produced. Without `language`, any track language of that video is accepted
 * (the re-check before deleting a stored key).
 */
export const isSubtitleKey = (
    key: string,
    videoId: string,
    language?: string,
): boolean => {
    const parts = key.split('/')
    if (parts.length !== 4) return false
    const [root, keyVideoId, keyLanguage, file] = parts
    return (
        root === 'subtitles' &&
        keyVideoId === videoId &&
        SUBTITLE_LANGUAGE.test(keyLanguage) &&
        (language === undefined || keyLanguage === language) &&
        file.endsWith('.vtt') &&
        UUID.test(file.slice(0, -'.vtt'.length))
    )
}

export const buildVideoThumbnailKey = (videoId: string) =>
    `thumbnails/${videoId}/${randomUUID()}`

export const isVideoThumbnailKey = (key: string, videoId: string): boolean => {
    const parts = key.split('/')
    return (
        parts.length === 3 &&
        parts[0] === 'thumbnails' &&
        parts[1] === videoId &&
        UUID.test(parts[2])
    )
}

// Under thumbnails/: one of the two anonymously readable prefixes (the bucket
// is private), so the unsigned public URL works for covers.
export const buildPlaylistThumbnailKey = (playlistId: string) =>
    `thumbnails/playlists/${playlistId}/${randomUUID()}`

export const isPlaylistThumbnailKey = (
    key: string,
    playlistId: string,
): boolean => {
    const parts = key.split('/')
    return (
        parts.length === 4 &&
        parts[0] === 'thumbnails' &&
        parts[1] === 'playlists' &&
        parts[2] === playlistId &&
        UUID.test(parts[3])
    )
}

/**
 * The object key behind a public URL of our own bucket, or null when the URL
 * points anywhere else. `publicBaseUrl` is `getPublicObjectUrl({ bucket,
 * key: '' })`, i.e. the bucket's public base with a trailing slash.
 */
export const keyFromPublicUrl = (
    url: string,
    publicBaseUrl: string,
): string | null =>
    url.startsWith(publicBaseUrl) && url.length > publicBaseUrl.length
        ? url.slice(publicBaseUrl.length)
        : null
