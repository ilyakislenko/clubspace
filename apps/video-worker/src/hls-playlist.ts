import { posix } from 'path'

// Reading back the worker's own HLS output, so a cover can be cut from one
// short segment instead of downloading a multi-gigabyte source again. The
// playlists are the ones ffmpeg wrote for this video; URIs outside its prefix
// are refused all the same, so a bad row can never point the download at
// another club's objects.

/**
 * The object key a playlist URI refers to, resolved against the key of the
 * playlist that lists it. Null for anything that is not a plain relative path
 * below that playlist's directory.
 */
export const resolvePlaylistUri = (playlistKey: string, uri: string): string | null => {
    if (uri.includes('://') || uri.startsWith('/') || uri.split('/').includes('..')) {
        return null
    }
    return posix.join(posix.dirname(playlistKey), uri)
}

/** The media playlist of the highest-bandwidth variant in a master playlist. */
export const pickBestVariant = (master: string): string | null => {
    const lines = master.split(/\r?\n/).map((line) => line.trim())
    let bestUri: string | null = null
    let bestBandwidth = -1
    for (let idx = 0; idx < lines.length; idx += 1) {
        const uri = lines[idx + 1]
        if (!lines[idx].startsWith('#EXT-X-STREAM-INF:') || !uri || uri.startsWith('#')) {
            continue
        }
        // Anchored: AVERAGE-BANDWIDTH must not be read as BANDWIDTH.
        const bandwidth = Number(/[:,]BANDWIDTH=(\d+)/.exec(lines[idx])?.[1] ?? 0)
        if (bandwidth > bestBandwidth) {
            bestUri = uri
            bestBandwidth = bandwidth
        }
    }
    return bestUri
}

/**
 * The segment that holds `atSec` of a media playlist, and where in it that
 * moment is. A moment past the end (a stale duration) falls back to the start
 * of the last segment.
 */
export const pickSegment = (
    playlist: string,
    atSec: number,
): { uri: string; offsetSec: number } | null => {
    const lines = playlist.split(/\r?\n/).map((line) => line.trim())
    let startSec = 0
    let last: { uri: string; offsetSec: number } | null = null
    for (let idx = 0; idx < lines.length; idx += 1) {
        const match = /^#EXTINF:([\d.]+)/.exec(lines[idx])
        const uri = lines[idx + 1]
        if (!match || !uri || uri.startsWith('#')) continue
        const durationSec = Number(match[1])
        if (atSec < startSec + durationSec) {
            return { uri, offsetSec: Math.max(0, atSec - startSec) }
        }
        last = { uri, offsetSec: 0 }
        startSec += durationSec
    }
    return last
}
