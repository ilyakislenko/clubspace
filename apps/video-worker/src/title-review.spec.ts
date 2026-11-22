import { buildTitleReviewPrompt, parseTitleReview } from './title-review'

const CONTEXT = {
    videoTitle: 'Octopus 2.0 · Vol 3 · часть 6',
    courses: [{ title: 'Octopus 2.0', lessonTitle: null }],
}

const TITLES = [
    { positionSec: 12, title: 'Octopus Guard Entry' },
    { positionSec: 62, title: 'CLUB CLUE' },
    { positionSec: 140, title: 'Review' },
]

describe('buildTitleReviewPrompt', () => {
    it('lists the numbered candidates with their times under the video’s titles', () => {
        const [system, user] = buildTitleReviewPrompt(CONTEXT, TITLES)
        expect(system.content).toContain('Reject only text that is clearly not such a caption')
        expect(system.content).toContain('{"reject":[2,5]}')
        expect(user.content.split('\n')).toEqual([
            'Video title: Octopus 2.0 · Vol 3 · часть 6',
            'Course: Octopus 2.0',
            'Text read off the screen:',
            '1. [00:12] Octopus Guard Entry',
            '2. [01:02] CLUB CLUE',
            '3. [02:20] Review',
        ])
    })
})

describe('parseTitleReview', () => {
    it('drops the rejected titles, named by number or by title', () => {
        expect(parseTitleReview('{"reject":[2]}', TITLES)).toEqual([TITLES[0], TITLES[2]])
        expect(parseTitleReview('{"reject":[" club clue "]}', TITLES)).toEqual([
            TITLES[0],
            TITLES[2],
        ])
        expect(parseTitleReview('[1, 2, 3, 9, {"n": 1}]', TITLES)).toEqual([])
    })

    it('honours a list of titles to keep instead', () => {
        expect(parseTitleReview('{"keep":[1,3]}', TITLES)).toEqual([TITLES[0], TITLES[2]])
        expect(parseTitleReview('{"keep":[]}', TITLES)).toEqual([])
    })

    it('rejects nothing on an answer without a list', () => {
        for (const content of ['{}', '{"reject": "none"}', 'All of them are titles.']) {
            expect(parseTitleReview(content, TITLES)).toEqual(TITLES)
        }
    })
})
