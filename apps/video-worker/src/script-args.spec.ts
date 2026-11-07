import { hasFlag, videoIdsFrom } from './script-args'

const A = '4c9d8e27-7b84-46de-a5e6-46a44f30bafa'
const B = 'd3071fb0-1e29-4dc4-97b3-81720ad52f8a'

describe('hasFlag', () => {
    it('takes the flag as typed or as nx forwards it', () => {
        for (const arg of ['--redo-auto-subtitles', '--redo-auto-subtitles=true', '--redoAutoSubtitles']) {
            expect(hasFlag(['--video', A, arg], 'redo-auto-subtitles')).toBe(true)
        }
        expect(hasFlag(['--redo-auto-subtitles=false'], 'redo-auto-subtitles')).toBe(false)
        expect(hasFlag(['--rescan-auto'], 'redo-auto-subtitles')).toBe(false)
    })
})

describe('videoIdsFrom', () => {
    it('collects ids from every form', () => {
        expect(videoIdsFrom([])).toEqual([])
        expect(videoIdsFrom(['--video', A, `--video=${B}`])).toEqual([A, B])
        expect(videoIdsFrom([`--video=${A}, ${B}`])).toEqual([A, B])
    })

    it('refuses anything that is not a video id', () => {
        expect(() => videoIdsFrom(['--video'])).toThrow('--video takes a video id, got «»')
        expect(() => videoIdsFrom(['--video=Vol-4-3'])).toThrow('got «Vol-4-3»')
    })
})
