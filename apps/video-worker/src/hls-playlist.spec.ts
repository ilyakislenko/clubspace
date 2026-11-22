import { pickBestVariant, pickSegment, resolvePlaylistUri } from './hls-playlist'

// What ffmpeg writes for the two-rung ladder in main.ts.
const MASTER = [
    '#EXTM3U',
    '#EXT-X-VERSION:6',
    '#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=9000000,BANDWIDTH=1166400,RESOLUTION=854x480,CODECS="avc1.64001f,mp4a.40.2"',
    'v0/playlist.m3u8',
    '',
    '#EXT-X-STREAM-INF:BANDWIDTH=2780800,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"',
    'v1/playlist.m3u8',
    '',
].join('\n')

const MEDIA = [
    '#EXTM3U',
    '#EXT-X-VERSION:6',
    '#EXT-X-TARGETDURATION:4',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    '#EXT-X-INDEPENDENT-SEGMENTS',
    '#EXTINF:4.000000,',
    'seg_00000.ts',
    '#EXTINF:4.000000,',
    'seg_00001.ts',
    '#EXTINF:2.500000,',
    'seg_00002.ts',
    '#EXT-X-ENDLIST',
].join('\r\n')

describe('pickBestVariant', () => {
    it('picks the highest-bandwidth rendition', () => {
        expect(pickBestVariant(MASTER)).toBe('v1/playlist.m3u8')
    })

    it('copes with a variant without BANDWIDTH and with no variants', () => {
        expect(pickBestVariant('#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=1x1\nv0/playlist.m3u8')).toBe(
            'v0/playlist.m3u8',
        )
        expect(pickBestVariant('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n#EXT-X-ENDLIST')).toBeNull()
        expect(pickBestVariant('')).toBeNull()
    })
})

describe('pickSegment', () => {
    it('finds the segment holding the moment and the offset within it', () => {
        expect(pickSegment(MEDIA, 0)).toEqual({ uri: 'seg_00000.ts', offsetSec: 0 })
        expect(pickSegment(MEDIA, 5)).toEqual({ uri: 'seg_00001.ts', offsetSec: 1 })
        expect(pickSegment(MEDIA, 9)).toEqual({ uri: 'seg_00002.ts', offsetSec: 1 })
    })

    it('falls back to the start of the last segment past the end', () => {
        expect(pickSegment(MEDIA, 60)).toEqual({ uri: 'seg_00002.ts', offsetSec: 0 })
    })

    it('finds nothing in a playlist without segments', () => {
        expect(pickSegment('#EXTM3U\n#EXTINF:4.0,\n#EXT-X-ENDLIST', 3)).toBeNull()
    })
})

describe('resolvePlaylistUri', () => {
    it('resolves a relative URI next to the playlist that lists it', () => {
        expect(resolvePlaylistUri('hls/vid-1/master.m3u8', 'v1/playlist.m3u8')).toBe(
            'hls/vid-1/v1/playlist.m3u8',
        )
        expect(resolvePlaylistUri('hls/vid-1/v1/playlist.m3u8', 'seg_00003.ts')).toBe(
            'hls/vid-1/v1/seg_00003.ts',
        )
    })

    it.each(['https://evil.example/seg.ts', '/hls/other/seg.ts', '../../other/v1/seg.ts'])(
        'refuses %s',
        (uri) => {
            expect(resolvePlaylistUri('hls/vid-1/v1/playlist.m3u8', uri)).toBeNull()
        },
    )
})
