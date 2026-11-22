import { NotFoundError } from '../../shared/errors/shared.errors'
import { ExportMyDataFeature } from './export-my-data.feature'
import { ExportMyDataHandler } from './export-my-data.handler'

const club = { id: 'w1', name: 'Клуб' }
const d = (iso: string) => new Date(iso)

const profileRow = {
    id: 'u1',
    email: 'member@example.com',
    phone: '+79990000000',
    firstname: 'Иван',
    lastname: 'Петров',
    dateOfBirth: d('1990-05-17T00:00:00Z'),
    description: null,
    profilePhotoUrl: null,
    language: 'RU',
    createdAt: d('2026-01-01T10:00:00Z'),
    lastSeenAt: d('2026-10-31T10:00:00Z'),
    telegramLink: null,
}

const build = (
    rows: Partial<Record<string, unknown[]>> = {},
    profile: unknown = profileRow,
) => {
    // Every section serves its rows once, then an empty page.
    const section = (name: string) => ({
        findMany: jest.fn(async (args: { cursor?: unknown }) =>
            args.cursor ? [] : (rows[name] ?? []),
        ),
    })
    const prisma = {
        user: { findUnique: jest.fn().mockResolvedValue(profile) },
        consentRecord: section('consents'),
        workspaceMember: section('memberships'),
        attendanceRecord: section('attendance'),
        subscription: section('subscriptions'),
        payment: section('payments'),
        subscriptionFreeze: section('freezes'),
        trainingJournalEntry: section('journal'),
        rankPromotion: section('ranks'),
        videoNote: section('videoNotes'),
        videoBookmark: section('bookmarks'),
        studyPlan: section('studyPlans'),
        reviewClip: section('videoReviews'),
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const handler = new ExportMyDataHandler(prisma as never, audit as never)
    return { handler, prisma, audit }
}

describe('ExportMyDataHandler', () => {
    it('throws NotFound for a vanished user and writes no audit entry', async () => {
        const { handler, audit } = build({}, null)
        await expect(
            handler.execute(new ExportMyDataFeature('u1')),
        ).rejects.toBeInstanceOf(NotFoundError)
        expect(audit.record).not.toHaveBeenCalled()
    })

    it('exports an account with no club history as empty sections', async () => {
        const { handler } = build()
        const out = await handler.execute(new ExportMyDataFeature('u1'))
        expect(out.profile).toEqual({
            id: 'u1',
            email: 'member@example.com',
            phone: '+79990000000',
            firstname: 'Иван',
            lastname: 'Петров',
            dateOfBirth: '1990-05-17',
            description: null,
            profilePhotoUrl: null,
            language: 'RU',
            createdAt: '2026-01-01T10:00:00.000Z',
            lastSeenAt: '2026-10-31T10:00:00.000Z',
        })
        expect(out.memberships).toEqual([])
        expect(out.telegram).toBeNull()
        expect(out.truncated).toEqual([])
        expect(out.formatVersion).toBe(1)
    })

    it('includes the linked Telegram chat', async () => {
        const { handler } = build({}, {
            ...profileRow,
            telegramLink: { chatId: '123456789', linkedAt: d('2026-11-02T08:00:00Z') },
        })
        const out = await handler.execute(new ExportMyDataFeature('u1'))
        expect(out.telegram).toEqual({
            chatId: '123456789',
            linkedAt: '2026-11-02T08:00:00.000Z',
        })
    })

    it('reads only the caller’s rows in every section', async () => {
        const { handler, prisma } = build()
        await handler.execute(new ExportMyDataFeature('u1'))
        expect(prisma.user.findUnique.mock.calls[0][0].where).toEqual({
            id: 'u1',
        })
        for (const model of [
            prisma.consentRecord,
            prisma.workspaceMember,
            prisma.attendanceRecord,
            prisma.payment,
            prisma.subscriptionFreeze,
            prisma.trainingJournalEntry,
            prisma.rankPromotion,
            prisma.videoNote,
            prisma.videoBookmark,
            prisma.studyPlan,
        ]) {
            expect(model.findMany.mock.calls[0][0].where).toEqual({
                userId: 'u1',
            })
        }
        // Abonements: the caller's membership rows, plus ones kept after removal (by userId).
        expect(prisma.subscription.findMany.mock.calls[0][0].where).toEqual({
            OR: [{ userId: 'u1' }, { workspaceMember: { userId: 'u1' } }],
        })
        expect(prisma.reviewClip.findMany.mock.calls[0][0].where).toEqual({
            ownerUserId: 'u1',
        })
    })

    it('maps every section and audits the export with row counts', async () => {
        const { handler, audit } = build(
            {
                consents: [
                    {
                        id: 'c1',
                        kind: 'PERSONAL_DATA',
                        version: '2026-11-01',
                        acceptedAt: d('2026-11-01T09:00:00Z'),
                        ip: '203.0.113.7',
                        userAgent: 'ClubSpace/1.0',
                        withdrawnAt: null,
                    },
                ],
                memberships: [
                    {
                        id: 'm1',
                        status: 'ACTIVE',
                        accessUntil: null,
                        createdAt: d('2026-02-01T00:00:00Z'),
                        workspace: club,
                        role: { name: 'user' },
                    },
                ],
                attendance: [
                    {
                        id: 'a1',
                        markedAt: d('2026-03-01T18:05:00Z'),
                        isGuest: null,
                        workspace: club,
                        session: {
                            title: 'Взрослые',
                            startAt: d('2026-03-01T18:00:00Z'),
                        },
                    },
                ],
                subscriptions: [
                    {
                        id: 's1',
                        status: 'ACTIVE',
                        startDate: d('2026-03-01T00:00:00Z'),
                        endDate: null,
                        classesTotal: 8,
                        classesRemaining: 7,
                        amountPaid: 400000,
                        currency: 'RUB',
                        isPaid: true,
                        paidAt: d('2026-03-01T12:00:00Z'),
                        createdAt: d('2026-03-01T12:00:00Z'),
                        workspace: club,
                        plan: { name: '8 занятий' },
                    },
                ],
                freezes: [
                    {
                        id: 'f1',
                        fromDate: d('2026-04-01T00:00:00Z'),
                        untilDate: d('2026-04-10T00:00:00Z'),
                        reason: 'Отпуск',
                        endedEarlyAt: null,
                        workspace: club,
                    },
                ],
                payments: [
                    {
                        id: 'pay1',
                        planName: '8 занятий',
                        provider: 'YOOKASSA',
                        status: 'SUCCEEDED',
                        amount: 4000,
                        currency: 'RUB',
                        createdAt: d('2026-03-01T11:58:00Z'),
                        paidAt: d('2026-03-01T12:00:00Z'),
                        refundedAt: null,
                        workspace: club,
                    },
                ],
                journal: [
                    {
                        id: 'j1',
                        entryDate: d('2026-03-02T00:00:00Z'),
                        body: 'треугольник',
                        createdAt: d('2026-03-02T20:00:00Z'),
                        workspace: club,
                    },
                ],
                ranks: [
                    {
                        id: 'p1',
                        stripes: 2,
                        note: null,
                        awardedAt: d('2026-05-01T00:00:00Z'),
                        workspace: club,
                        ladder: { name: 'Взрослые' },
                        level: { name: 'Синий пояс' },
                    },
                ],
            },
            { ...profileRow, dateOfBirth: null },
        )
        const out = await handler.execute(new ExportMyDataFeature('u1'))

        expect(out.profile.dateOfBirth).toBeNull()
        expect(out.consents).toEqual([
            {
                kind: 'PERSONAL_DATA',
                version: '2026-11-01',
                acceptedAt: '2026-11-01T09:00:00.000Z',
                ip: '203.0.113.7',
                userAgent: 'ClubSpace/1.0',
                withdrawnAt: null,
            },
        ])
        expect(out.memberships).toEqual([
            {
                club,
                role: 'user',
                status: 'ACTIVE',
                joinedAt: '2026-02-01T00:00:00.000Z',
                accessUntil: null,
            },
        ])
        expect(out.attendance).toEqual([
            {
                club,
                title: 'Взрослые',
                startAt: '2026-03-01T18:00:00.000Z',
                markedAt: '2026-03-01T18:05:00.000Z',
                isGuest: false,
            },
        ])
        expect(out.subscriptions[0]).toMatchObject({
            plan: '8 занятий',
            amountPaid: 400000,
            paidAt: '2026-03-01T12:00:00.000Z',
            endDate: null,
        })
        expect(out.payments).toEqual([
            {
                club,
                plan: '8 занятий',
                provider: 'YOOKASSA',
                status: 'SUCCEEDED',
                amount: 4000,
                currency: 'RUB',
                createdAt: '2026-03-01T11:58:00.000Z',
                paidAt: '2026-03-01T12:00:00.000Z',
                refundedAt: null,
            },
        ])
        expect(out.freezes[0]).toMatchObject({
            fromDate: '2026-04-01',
            untilDate: '2026-04-10',
            reason: 'Отпуск',
        })
        expect(out.journal[0]).toMatchObject({
            entryDate: '2026-03-02',
            body: 'треугольник',
        })
        expect(out.ranks[0]).toMatchObject({
            ladder: 'Взрослые',
            level: 'Синий пояс',
            stripes: 2,
        })

        expect(audit.record).toHaveBeenCalledWith({
            action: 'me.export',
            targetType: 'member',
            targetId: 'u1',
            actorId: 'u1',
            workspaceId: null,
            metadata: {
                consents: 1,
                memberships: 1,
                attendance: 1,
                subscriptions: 1,
                payments: 1,
                freezes: 1,
                journal: 1,
                ranks: 1,
                videoNotes: 0,
                bookmarks: 0,
                studyPlans: 0,
                videoReviews: 0,
            },
        })
    })

    it('exports video notes, bookmarks with their review schedule, study plans and review clips', async () => {
        const video = { id: 'v1', title: 'Проход гарда' }
        const { handler, audit } = build({
            videoNotes: [
                {
                    videoId: 'v1',
                    text: 'держать локти',
                    updatedAt: d('2026-05-01T10:00:00Z'),
                    workspace: club,
                    video,
                },
            ],
            bookmarks: [
                {
                    id: 'b1',
                    positionSec: 30,
                    endSec: 45,
                    label: 'захват',
                    note: 'левой рукой',
                    drawing: { strokes: [] },
                    createdAt: d('2026-05-01T10:00:00Z'),
                    updatedAt: d('2026-05-02T10:00:00Z'),
                    deletedAt: null,
                    workspace: club,
                    video,
                    review: {
                        dueAt: d('2026-05-05T10:00:00Z'),
                        intervalDays: 3,
                        ease: 2.5,
                        reps: 2,
                        lapses: 0,
                        lastReviewedAt: d('2026-05-02T10:00:00Z'),
                    },
                },
            ],
            studyPlans: [
                {
                    id: 'p1',
                    title: 'К турниру',
                    description: null,
                    createdAt: d('2026-05-01T10:00:00Z'),
                    updatedAt: d('2026-05-03T10:00:00Z'),
                    workspace: club,
                    items: [
                        {
                            position: 0,
                            startSec: 10,
                            endSec: null,
                            title: 'старт',
                            note: null,
                            createdAt: d('2026-05-01T11:00:00Z'),
                            video,
                        },
                    ],
                },
            ],
            videoReviews: [
                {
                    id: 'clip1',
                    status: 'ready',
                    duration: 120,
                    sizeBytes: BigInt(5_000_000),
                    createdAt: d('2026-06-01T10:00:00Z'),
                    workspace: club,
                    request: {
                        title: 'Спарринг',
                        message: 'что не так?',
                        status: 'answered',
                        createdAt: d('2026-06-01T10:00:00Z'),
                        updatedAt: d('2026-06-02T10:00:00Z'),
                        comments: [
                            {
                                atSec: 12,
                                endSec: null,
                                text: 'бёдра выше',
                                drawing: null,
                                createdAt: d('2026-06-02T09:00:00Z'),
                                updatedAt: d('2026-06-02T09:00:00Z'),
                            },
                        ],
                    },
                },
                {
                    // Upload never finished: no request yet.
                    id: 'clip2',
                    status: 'uploading',
                    duration: null,
                    sizeBytes: null,
                    createdAt: d('2026-06-03T10:00:00Z'),
                    workspace: club,
                    request: null,
                },
            ],
        })
        const out = await handler.execute(new ExportMyDataFeature('u1'))
        expect(out.videoNotes).toEqual([
            {
                club,
                video,
                text: 'держать локти',
                updatedAt: '2026-05-01T10:00:00.000Z',
            },
        ])
        expect(out.bookmarks).toEqual([
            {
                club,
                video,
                positionSec: 30,
                endSec: 45,
                label: 'захват',
                note: 'левой рукой',
                hasDrawing: true,
                createdAt: '2026-05-01T10:00:00.000Z',
                updatedAt: '2026-05-02T10:00:00.000Z',
                deletedAt: null,
                review: {
                    dueAt: '2026-05-05T10:00:00.000Z',
                    intervalDays: 3,
                    ease: 2.5,
                    reps: 2,
                    lapses: 0,
                    lastReviewedAt: '2026-05-02T10:00:00.000Z',
                },
            },
        ])
        expect(out.studyPlans).toEqual([
            {
                club,
                title: 'К турниру',
                description: null,
                createdAt: '2026-05-01T10:00:00.000Z',
                updatedAt: '2026-05-03T10:00:00.000Z',
                items: [
                    {
                        position: 0,
                        video,
                        startSec: 10,
                        endSec: null,
                        title: 'старт',
                        note: null,
                        createdAt: '2026-05-01T11:00:00.000Z',
                    },
                ],
            },
        ])
        expect(out.videoReviews).toEqual([
            {
                club,
                clip: {
                    status: 'ready',
                    durationSec: 120,
                    sizeBytes: 5_000_000,
                    createdAt: '2026-06-01T10:00:00.000Z',
                },
                request: {
                    title: 'Спарринг',
                    message: 'что не так?',
                    status: 'answered',
                    createdAt: '2026-06-01T10:00:00.000Z',
                    updatedAt: '2026-06-02T10:00:00.000Z',
                    comments: [
                        {
                            atSec: 12,
                            endSec: null,
                            text: 'бёдра выше',
                            hasDrawing: false,
                            createdAt: '2026-06-02T09:00:00.000Z',
                            updatedAt: '2026-06-02T09:00:00.000Z',
                        },
                    ],
                },
            },
            {
                club,
                clip: {
                    status: 'uploading',
                    durationSec: null,
                    sizeBytes: null,
                    createdAt: '2026-06-03T10:00:00.000Z',
                },
                request: null,
            },
        ])
        expect(audit.record.mock.calls[0][0].metadata).toMatchObject({
            videoNotes: 1,
            bookmarks: 1,
            studyPlans: 1,
            videoReviews: 2,
        })
    })
})
