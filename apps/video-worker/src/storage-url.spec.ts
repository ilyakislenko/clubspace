import { isVirtualHostEndpoint, publicObjectUrl } from './storage-url'

describe('isVirtualHostEndpoint', () => {
    it('is true only when the host name starts with "<bucket>."', () => {
        expect(isVirtualHostEndpoint('https://clubspace.s3.example.com', 'clubspace')).toBe(true)
        expect(isVirtualHostEndpoint('https://media.clubspace.space', 'clubspace')).toBe(false)
        expect(isVirtualHostEndpoint('https://s3.clubspace.ru', 'clubspace')).toBe(false)
        expect(isVirtualHostEndpoint('http://localhost:9000', 'clubspace')).toBe(false)
    })
})

describe('publicObjectUrl', () => {
    it('puts the bucket in the path of an origin that merely contains its name', () => {
        expect(
            publicObjectUrl('https://media.clubspace.space', 'clubspace', 'thumbnails/v1/c1'),
        ).toBe('https://media.clubspace.space/clubspace/thumbnails/v1/c1')
    })

    it('keeps a virtual-host endpoint as the base', () => {
        expect(
            publicObjectUrl('https://clubspace.s3.example.com/', 'clubspace', 'hls/v1/master.m3u8'),
        ).toBe('https://clubspace.s3.example.com/hls/v1/master.m3u8')
    })

    it('reaches the local fake-s3 host as localhost', () => {
        expect(publicObjectUrl('http://s3:9000/', 'clubspace', 'subtitles/v1/ru/a.vtt')).toBe(
            'http://localhost:9000/clubspace/subtitles/v1/ru/a.vtt',
        )
    })
})
