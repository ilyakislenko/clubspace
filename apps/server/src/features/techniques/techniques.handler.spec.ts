jest.mock('../../domains/playlist/services/course-access.service', () => ({
    CourseAccessService: class {},
}))

import { techniquesFor } from '@clubspace/sport-glossary'

import { STAFF_VIEWER } from '../../domains/playlist/services/course-audience'
import { ForbiddenError, NotFoundError } from '../../shared/errors/shared.errors'
import { reindexChapterMentions } from './chapter-mentions'
import { GetTechniqueFeature } from './get-technique.feature'
import { GetTechniqueHandler } from './get-technique.handler'
import { ListTechniquesFeature } from './list-techniques.feature'
import { ListTechniquesHandler } from './list-techniques.handler'
import {
    groupTechniqueMoments,
    MAX_TECHNIQUE_MOMENTS,
    summarizeTechniques,
} from './techniques-utils'

type Mention = {
    videoId: string
    technique: string
    kind: string
    atSec: number
    text: string
    matched: string
}

const mention = (videoId: string, technique: string, kind: string, atSec: number): Mention => ({
    videoId,
    technique,
    kind,
    atSec,
    text: `about ${technique} here`,
    matched: technique,
})

const build = (
    o: {
        membership?: unknown
        type?: string
        ready?: string[]
        watchable?: string[]
        mentions?: Mention[]
    } = {},
) => {
    const mentions = o.mentions ?? []
    const inScope = (where: { videoId: { in: string[] }; technique?: string }) =>
        mentions.filter(
            (m) =>
                where.videoId.in.includes(m.videoId) &&
                (!where.technique || m.technique === where.technique),
        )
    const prisma = {
        workspace: {
            findUnique: jest.fn(async () => ({ ownerId: null, type: o.type ?? 'GRAPPLING' })),
        },
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
                          title: `Video ${id}`,
                          thumbnailUrl: null,
                          duration: 100,
                          courses: id === 'v1' ? [{ course: { id: 'c1', title: 'Basics' } }] : [],
                      }))
                    : (o.ready ?? ['v1', 'v2', 'v3']).map((id) => ({ id })),
            ),
        },
        videoTechniqueMention: {
            groupBy: jest.fn(
                async (args: { by: string[]; where: { videoId: { in: string[] } } }) => {
                    const rows = inScope(args.where)
                    const key = (m: Mention) => args.by.map((b) => m[b as keyof Mention]).join('|')
                    const groups = new Map<string, Mention[]>()
                    for (const m of rows) groups.set(key(m), [...(groups.get(key(m)) ?? []), m])
                    return [...groups.values()].map((g) => ({
                        ...Object.fromEntries(args.by.map((b) => [b, g[0][b as keyof Mention]])),
                        _count: { _all: g.length },
                    }))
                },
            ),
            findMany: jest.fn(
                async (args: { where: { videoId: { in: string[] }; technique: string } }) =>
                    inScope(args.where),
            ),
        },
    }
    const courseAccess = {
        watchableVideoIds: jest.fn(
            async (_w: string, _u: string, ids: readonly string[]) =>
                new Set(ids.filter((id) => (o.watchable ?? ids).includes(id))),
        ),
        loadViewer: jest.fn().mockResolvedValue(STAFF_VIEWER),
    }
    return { prisma, courseAccess }
}

const list = (d: ReturnType<typeof build>, q?: string) =>
    new ListTechniquesHandler(d.prisma as never, d.courseAccess as never).execute(
        new ListTechniquesFeature('u1', 'w1', { q }),
    )
const get = (d: ReturnType<typeof build>, key: string, isStaff = false) =>
    new GetTechniqueHandler(d.prisma as never, d.courseAccess as never).execute(
        new GetTechniqueFeature('u1', 'w1', key, isStaff),
    )

describe('ListTechniquesHandler', () => {
    it("refuses a user who isn't an active member", async () => {
        const d = build({ membership: null })
        await expect(list(d)).rejects.toBeInstanceOf(ForbiddenError)
        expect(d.prisma.videoTechniqueMention.groupBy).not.toHaveBeenCalled()
    })

    it('counts only lessons the member may watch, by category', async () => {
        const d = build({
            watchable: ['v1', 'v2'],
            mentions: [
                mention('v1', 'kimura', 'chapter', 10),
                mention('v1', 'kimura', 'speech', 20),
                mention('v2', 'kimura', 'speech', 5),
                mention('v2', 'scissor-sweep', 'speech', 5),
                // A lesson the member can't open: invisible.
                mention('v3', 'armbar', 'chapter', 5),
            ],
        })
        const res = await list(d)
        expect(d.courseAccess.watchableVideoIds).toHaveBeenCalledWith('w1', 'u1', [
            'v1',
            'v2',
            'v3',
        ])
        expect(res.categories.map((c) => [c.category, c.label, c.techniques])).toEqual([
            [
                'submissions',
                'Болевые и удушающие',
                [
                    {
                        key: 'kimura',
                        en: 'Kimura',
                        ru: 'кимура',
                        videoCount: 2,
                        chapterCount: 1,
                        speechCount: 2,
                    },
                ],
            ],
            [
                'sweeps',
                'Свипы',
                [
                    {
                        key: 'scissor-sweep',
                        en: 'Scissor Sweep',
                        ru: null,
                        videoCount: 1,
                        chapterCount: 0,
                        speechCount: 1,
                    },
                ],
            ],
        ])
    })

    it('filters by English or Russian name', async () => {
        const d = build({
            mentions: [mention('v1', 'kimura', 'chapter', 1), mention('v1', 'armbar', 'chapter', 2)],
        })
        expect((await list(d, 'КИМУР')).categories[0].techniques.map((t) => t.key)).toEqual([
            'kimura',
        ])
        expect((await list(d, 'arm')).categories[0].techniques.map((t) => t.key)).toEqual([
            'armbar',
        ])
    })

    it('is empty for a custom club or when nothing is watchable', async () => {
        const custom = build({ type: 'CUSTOM' })
        await expect(list(custom)).resolves.toEqual({ categories: [] })
        expect(custom.prisma.video.findMany).not.toHaveBeenCalled()
        await expect(list(build({ watchable: [] }))).resolves.toEqual({ categories: [] })
    })
})

describe('GetTechniqueHandler', () => {
    it('lists lessons with a chapter on it first, chapters before speech', async () => {
        const d = build({
            mentions: [
                mention('v2', 'kimura', 'speech', 50),
                mention('v2', 'kimura', 'speech', 70),
                mention('v1', 'kimura', 'speech', 90),
                mention('v1', 'kimura', 'chapter', 120),
                mention('v1', 'armbar', 'chapter', 5),
            ],
        })
        const res = await get(d, 'kimura', true)
        expect(res.technique).toEqual({
            key: 'kimura',
            en: 'Kimura',
            ru: 'кимура',
            category: 'submissions',
            categoryLabel: 'Болевые и удушающие',
        })
        expect(res.items.map((i) => [i.video.id, i.chapterHits, i.speechHits])).toEqual([
            ['v1', 1, 1],
            ['v2', 0, 2],
        ])
        expect(res.items[0].course).toEqual({ id: 'c1', title: 'Basics' })
        expect(res.items[0].moments.map((m) => [m.kind, m.atSec])).toEqual([
            ['chapter', 120],
            ['speech', 90],
        ])
        expect(res.items[0].moments[0]).toMatchObject({
            snippet: 'about kimura here',
            highlight: { start: 6, length: 6 },
        })
        expect(d.courseAccess.loadViewer).toHaveBeenCalledWith({
            workspaceId: 'w1',
            userId: 'u1',
            isStaff: true,
        })
    })

    it('hides lessons the member may not watch', async () => {
        const d = build({ watchable: ['v2'], mentions: [mention('v1', 'kimura', 'chapter', 1)] })
        await expect(get(d, 'kimura')).resolves.toMatchObject({ items: [] })
    })

    it("404s a technique the club's sport doesn't have", async () => {
        await expect(get(build(), 'savasana')).rejects.toBeInstanceOf(NotFoundError)
    })

    it("refuses a user who isn't an active member", async () => {
        await expect(get(build({ membership: null }), 'kimura')).rejects.toBeInstanceOf(
            ForbiddenError,
        )
    })
})

describe('summarizeTechniques', () => {
    it('puts techniques with chapters first, then the most lessons', () => {
        const techniques = techniquesFor('GRAPPLING')
        const [group] = summarizeTechniques(
            techniques,
            [
                { technique: 'armbar', kind: 'speech', _count: { _all: 9 } },
                { technique: 'americana', kind: 'chapter', _count: { _all: 1 } },
                { technique: 'kimura', kind: 'speech', _count: { _all: 2 } },
            ],
            [
                { technique: 'armbar', videoId: 'a' },
                { technique: 'armbar', videoId: 'b' },
                { technique: 'americana', videoId: 'a' },
                { technique: 'kimura', videoId: 'a' },
                { technique: 'unknown', videoId: 'a' },
            ],
        )
        expect(group.techniques.map((t) => t.key)).toEqual(['americana', 'armbar', 'kimura'])
    })
})

describe('groupTechniqueMoments', () => {
    it('drops a translation at a second already said and caps the moments', () => {
        const many = Array.from({ length: MAX_TECHNIQUE_MOMENTS + 2 }, (_, i) =>
            mention('v1', 'kimura', 'speech', i * 10),
        )
        const [v] = groupTechniqueMoments([
            ...many,
            mention('v1', 'kimura', 'speechRu', 0),
            mention('v1', 'kimura', 'speechRu', 3),
        ])
        expect(v.speechHits).toBe(MAX_TECHNIQUE_MOMENTS + 3)
        expect(v.moments).toHaveLength(MAX_TECHNIQUE_MOMENTS)
        expect(v.moments.filter((m) => m.kind === 'speechRu').map((m) => m.atSec)).toEqual([3])
    })
})

describe('reindexChapterMentions', () => {
    const prisma = (video: unknown) => ({
        video: { findUnique: jest.fn(async () => video) },
        videoTechniqueMention: {
            deleteMany: jest.fn((a: unknown) => ({ delete: a })),
            createMany: jest.fn((a: unknown) => ({ create: a })),
        },
        $transaction: jest.fn(async (ops: unknown[]) => ops),
    })

    it("redoes only the lesson's chapter mentions", async () => {
        const p = prisma({
            workspaceId: 'w1',
            workspace: { type: 'GRAPPLING' },
            timestamps: [{ positionSec: 30, title: 'Armbar finish' }],
        })
        await reindexChapterMentions(p as never, 'v1')
        expect(p.videoTechniqueMention.deleteMany).toHaveBeenCalledWith({
            where: { videoId: 'v1', kind: 'chapter' },
        })
        expect(p.videoTechniqueMention.createMany).toHaveBeenCalledWith({
            data: [
                {
                    videoId: 'v1',
                    workspaceId: 'w1',
                    technique: 'armbar',
                    kind: 'chapter',
                    atSec: 30,
                    text: 'Armbar finish',
                    matched: 'Armbar',
                },
            ],
        })
    })

    it('never fails the chapter edit', async () => {
        const p = prisma(null)
        await expect(reindexChapterMentions(p as never, 'gone')).resolves.toBeUndefined()
        p.video.findUnique.mockRejectedValueOnce(new Error('db down'))
        await expect(reindexChapterMentions(p as never, 'v1')).resolves.toBeUndefined()
        expect(p.$transaction).not.toHaveBeenCalled()
    })
})
