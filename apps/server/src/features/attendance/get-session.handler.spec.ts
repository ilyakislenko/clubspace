import { NotFoundError } from '../../shared/errors/shared.errors'
import { GetAttendanceSessionFeature } from './get-session.feature'
import { GetAttendanceSessionHandler } from './get-session.handler'

const ROW = {
    id: 's1',
    workspaceId: 'w1',
    groupId: null,
    slotId: null,
    workspaceEventId: null,
    sessionDate: new Date('2026-10-31T00:00:00Z'),
    title: 'Персональная тренировка',
    startAt: new Date('2026-10-31T12:00:00Z'),
    timezone: 'Asia/Tomsk',
    coachId: 'coach1',
    notes: null,
    createdAt: new Date('2026-10-24T09:00:00Z'),
    updatedAt: new Date('2026-10-24T09:00:00Z'),
    _count: { records: 2 },
}

const makePrisma = (session: unknown) => ({
    attendanceSession: {
        findFirst: jest.fn().mockResolvedValue(session),
        findUniqueOrThrow: jest.fn().mockResolvedValue(ROW),
    },
})

const makeRbac = (over: Record<string, unknown> = {}) => ({
    resolveCoachScope: jest.fn().mockImplementation(async (a: { userId: string }) => ({
        scope: 'coach_own_only',
        userId: a.userId,
        workspaceId: 'w1',
        workspaceOwnerId: 'owner',
    })),
    assertCanWriteGroup: jest.fn().mockResolvedValue(undefined),
    canWriteAllGroups: jest.fn().mockReturnValue(false),
    canSeeAllGroups: jest.fn().mockReturnValue(false),
    ...over,
})

const run = (prisma: unknown, rbac: unknown, userId = 'coach1') =>
    new GetAttendanceSessionHandler(prisma as never, rbac as never).execute(
        new GetAttendanceSessionFeature('w1', 's1', userId, 'coach', false),
    )

const personal = { id: 's1', workspaceId: 'w1', groupId: null, isPersonal: true, coachId: 'coach1' }

describe('GetAttendanceSessionHandler', () => {
    it('returns the serialized session with its attendee count', async () => {
        const prisma = makePrisma(personal)
        const out = await run(prisma, makeRbac())
        expect(out).toMatchObject({
            id: 's1',
            title: 'Персональная тренировка',
            coachId: 'coach1',
            attendeeCount: 2,
            sessionDate: '2026-10-31',
            startAt: '2026-10-31T12:00:00.000Z',
        })
        expect(prisma.attendanceSession.findUniqueOrThrow.mock.calls[0][0].where).toEqual({
            id: 's1',
        })
    })

    it('is NotFound for an unknown session', async () => {
        await expect(run(makePrisma(null), makeRbac())).rejects.toBeInstanceOf(
            NotFoundError,
        )
    })

    it('hides it (NotFound) from a coach who is not the personal session\'s coach', async () => {
        await expect(
            run(makePrisma(personal), makeRbac(), 'coach2'),
        ).rejects.toBeInstanceOf(NotFoundError)
    })
})
