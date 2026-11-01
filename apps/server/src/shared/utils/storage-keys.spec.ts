import {
    buildPlaylistThumbnailKey,
    buildSubtitleKey,
    buildVideoThumbnailKey,
    isPlaylistThumbnailKey,
    isSubtitleKey,
    isVideoThumbnailKey,
    keyFromPublicUrl,
} from './storage-keys'

const VIDEO = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const FILE = '33333333-3333-4333-8333-333333333333'

describe('subtitle keys', () => {
    it('accepts what the builder issues', () => {
        const key = buildSubtitleKey(VIDEO, 'ru')
        expect(key).toMatch(new RegExp(`^subtitles/${VIDEO}/ru/[0-9a-f-]{36}\\.vtt$`))
        expect(isSubtitleKey(key, VIDEO, 'ru')).toBe(true)
        expect(isSubtitleKey(key, VIDEO)).toBe(true)
    })

    it.each([
        // H1: another club's source video and HLS output.
        `raw/${OTHER}/source.mp4`,
        `hls/${OTHER}/master.m3u8`,
        // Another video's track.
        `subtitles/${OTHER}/ru/${FILE}.vtt`,
        // Traversal and shape tricks.
        `subtitles/${VIDEO}/ru/../../raw/${OTHER}/source.mp4`,
        `subtitles/${VIDEO}/../hls/${FILE}.vtt`,
        `subtitles/${VIDEO}/ru/${FILE}.vtt/extra`,
        `subtitles/${VIDEO}/ru/${FILE}.mp4`,
        `subtitles/${VIDEO}/ru/not-a-uuid.vtt`,
        `subtitles/${VIDEO}/ru`,
        `/subtitles/${VIDEO}/ru/${FILE}.vtt`,
        '',
    ])('refuses %s', (key) => {
        expect(isSubtitleKey(key, VIDEO)).toBe(false)
        expect(isSubtitleKey(key, VIDEO, 'ru')).toBe(false)
    })

    it('binds the key to the language of the track', () => {
        const key = `subtitles/${VIDEO}/en/${FILE}.vtt`
        expect(isSubtitleKey(key, VIDEO, 'ru')).toBe(false)
        expect(isSubtitleKey(key, VIDEO, 'en')).toBe(true)
    })
})

describe('thumbnail keys', () => {
    it('accepts what the video builder issues, for that video only', () => {
        const key = buildVideoThumbnailKey(VIDEO)
        expect(isVideoThumbnailKey(key, VIDEO)).toBe(true)
        expect(isVideoThumbnailKey(key, OTHER)).toBe(false)
    })

    it('accepts what the playlist builder issues, for that course only', () => {
        const key = buildPlaylistThumbnailKey(VIDEO)
        expect(key).toMatch(/^thumbnails\/playlists\//)
        expect(isPlaylistThumbnailKey(key, VIDEO)).toBe(true)
        expect(isPlaylistThumbnailKey(key, OTHER)).toBe(false)
    })

    it.each([
        `raw/${VIDEO}/source.mp4`,
        `thumbnails/${VIDEO}/${FILE}/x`,
        `thumbnails/${VIDEO}/../../raw`,
        `thumbnails/playlists/${VIDEO}/${FILE}`,
    ])('refuses %s as a video cover', (key) => {
        expect(isVideoThumbnailKey(key, VIDEO)).toBe(false)
    })

    it('does not accept a video cover as a course cover', () => {
        expect(
            isPlaylistThumbnailKey(`thumbnails/${VIDEO}/${FILE}`, VIDEO),
        ).toBe(false)
    })
})

describe('keyFromPublicUrl', () => {
    const base = 'https://s3.example.ru/clubspace/'

    it('returns the key behind a URL of our bucket', () => {
        expect(keyFromPublicUrl(`${base}thumbnails/a/b`, base)).toBe(
            'thumbnails/a/b',
        )
    })

    it.each([
        'https://evil.example/pixel.gif',
        'https://s3.example.ru.evil.example/clubspace/thumbnails/a/b',
        'https://s3.example.ru/other-bucket/thumbnails/a/b',
        base,
    ])('returns null for %s', (url) => {
        expect(keyFromPublicUrl(url, base)).toBeNull()
    })
})
