jest.mock('../../domains/playlist/services/course-access.service', () => ({
    CourseAccessService: class {},
}))

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { STAFF_VIEWER } from '../../domains/playlist/services/course-audience'
import { ForbiddenError } from '../../shared/errors/shared.errors'
import { SearchVideosFeature } from './search-videos.feature'
import { SearchVideosHandler } from './search-videos.handler'
import { SEARCH_CANDIDATE_LIMIT } from './search-videos.sql'
import { MAX_SEARCH_RESULTS, type VideoHitRow } from './search-videos-utils'

const row = (id: string, over: Partial<VideoHitRow> = {}): VideoHitRow => ({
    id,
    title: `Video ${id}`,
    thumbnailUrl: `https://cdn/${id}.jpg`,
    duration: 100,
    titleHit: false,
    chapterHits: 0,
    chapterMoments: null,
    speechHits: 0,
    speechMoments: null,
    speechRuHits: 0,
    speechRuMoments: null,
    ...over,
})

const build = (
    o: {
        membership?: unknown
        ready?: string[]
        watchable?: string[]
        rows?: VideoHitRow[]
        courses?: Record<string, { id: string; title: string }>
    } = {},
) => {
    const prisma = {
        workspace: { findUnique: jest.fn().mockResolvedValue({ ownerId: null }) },
        workspaceMember: {
            findUnique: jest
                .fn()
                .mockResolvedValue(
                    o.membership === undefined
                        ? { status: 'ACTIVE', accessUntil: null }
                        : o.membership,
                ),
        },
        video: {
            findMany: jest.fn(async (args: { where: { id?: { in: string[] } } }) =>
                args.where.id
                    ? args.where.id.in.map((id) => ({
                          id,
                          courses: o.courses?.[id] ? [{ course: o.courses[id] }] : [],
                      }))
                    : (o.ready ?? ['v1', 'v2', 'v3']).map((id) => ({ id })),
            ),
        },
        $queryRaw: jest.fn().mockResolvedValue(o.rows ?? []),
    }
    const courseAccess = {
        watchableVideoIds: jest.fn(
            async (_ws: string, _u: string, ids: readonly string[]) =>
                new Set(ids.filter((id) => (o.watchable ?? ids).includes(id))),
        ),
        loadViewer: jest.fn().mockResolvedValue(STAFF_VIEWER),
    }
    return { prisma, courseAccess }
}

const search = (deps: ReturnType<typeof build>, q = 'kimura', isStaff = false) =>
    new SearchVideosHandler(deps.prisma as never, deps.courseAccess as never).execute(
        new SearchVideosFeature('u1', 'w1', { q }, isStaff),
    )

describe('SearchVideosHandler', () => {
    it("refuses a user who isn't an active member", async () => {
        const deps = build({ membership: null })
        await expect(search(deps)).rejects.toBeInstanceOf(ForbiddenError)
        expect(deps.prisma.$queryRaw).not.toHaveBeenCalled()
    })

    it('searches only the ready videos the member may watch', async () => {
        const deps = build({ ready: ['v1', 'v2', 'v3'], watchable: ['v1', 'v3'] })
        await search(deps)
        expect(deps.prisma.video.findMany.mock.calls[0][0].where).toEqual({
            workspaceId: 'w1',
            status: 'ready',
        })
        expect(deps.courseAccess.watchableVideoIds).toHaveBeenCalledWith('w1', 'u1', [
            'v1',
            'v2',
            'v3',
        ])
        const sql = deps.prisma.$queryRaw.mock.calls[0][0]
        expect(sql.values).toContainEqual(['v1', 'v3'])
        expect(sql.values).toContain('w1')
        expect(sql.values).toContain(SEARCH_CANDIDATE_LIMIT)
        expect(sql.sql).toContain('jsonb_array_elements')
        expect(sql.sql).toContain("translations -> 'ru'")
        expect(sql.sql).toContain('"VideoTimestamp"')
    })

    it('matches the query literally — wildcards are escaped', async () => {
        const deps = build()
        await search(deps, '50%_x')
        const sql = deps.prisma.$queryRaw.mock.calls[0][0]
        expect(sql.values).toContain('%50\\%\\_x%')
        expect(sql.sql).toContain("ESCAPE '\\'")
    })

    it('asks nothing more when the member may watch no video', async () => {
        const deps = build({ watchable: [] })
        await expect(search(deps)).resolves.toEqual({ query: 'kimura', items: [] })
        expect(deps.prisma.$queryRaw).not.toHaveBeenCalled()
    })

    it('ranks, caps and shapes the results', async () => {
        const many = Array.from({ length: MAX_SEARCH_RESULTS + 3 }, (_, i) =>
            row(`s${String(i).padStart(2, '0')}`, { speechHits: 1 }),
        )
        const deps = build({
            rows: [
                ...many,
                row('chapter', {
                    chapterHits: 1,
                    chapterMoments: [{ at: 61, text: 'Kimura from guard' }],
                }),
                row('title', {
                    title: 'The Kimura trap',
                    titleHit: true,
                    speechHits: 2,
                    speechMoments: [{ at: 12.9, text: 'grab the wrist for kimura' }],
                    speechRuHits: 1,
                    speechRuMoments: [{ at: 40, text: 'захват на кимуру' }],
                }),
            ],
            courses: { title: { id: 'c1', title: 'Basics' } },
        })
        const res = await search(deps, 'Kimura', true)
        expect(res.items).toHaveLength(MAX_SEARCH_RESULTS)
        expect(res.items.map((i) => i.video.id).slice(0, 3)).toEqual([
            'title',
            'chapter',
            's00',
        ])
        expect(res.items[0]).toEqual({
            video: {
                id: 'title',
                title: 'The Kimura trap',
                thumbnailUrl: 'https://cdn/title.jpg',
                duration: 100,
            },
            course: { id: 'c1', title: 'Basics' },
            titleHighlight: { start: 4, length: 6 },
            chapterHits: 0,
            speechHits: 3,
            moments: [
                {
                    atSec: 12,
                    kind: 'speech',
                    snippet: 'grab the wrist for kimura',
                    highlight: { start: 19, length: 6 },
                },
                {
                    atSec: 40,
                    kind: 'speechRu',
                    snippet: 'захват на кимуру',
                    highlight: null,
                },
            ],
        })
        expect(res.items[1]).toMatchObject({
            course: null,
            titleHighlight: null,
            moments: [{ atSec: 61, kind: 'chapter', highlight: { start: 0, length: 6 } }],
        })
        expect(deps.courseAccess.loadViewer).toHaveBeenCalledWith({
            workspaceId: 'w1',
            userId: 'u1',
            isStaff: true,
        })
    })

    it('is registered before the video detail route that would swallow it', () => {
        const module = readFileSync(join(__dirname, '../../app/app.module.ts'), 'utf8')
        // The entries of the `controllers` list (one per line).
        const at = (name: string) => module.search(new RegExp(`^\\s+${name},$`, 'm'))
        expect(at('SearchVideosController')).toBeGreaterThan(-1)
        expect(at('SearchVideosController')).toBeLessThan(at('GetWorkspaceVideoController'))
    })
})
