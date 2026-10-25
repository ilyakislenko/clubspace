import { ForbiddenError } from '../../shared/errors/shared.errors'
import { ListPersonalTrainingsFeature } from './list-personal-trainings.feature'
import { ListPersonalTrainingsHandler } from './list-personal-trainings.handler'

// Saturday 2026-10-24 09:00Z.
const NOW = new Date('2026-10-24T09:00:00Z')

const person = (id: string, firstname: string) => ({
    id,
    firstname,
    lastname: null,
    email: `${id}@x`,
})

const row = (id: string) => ({
    id,
    workspaceId: 'w1',
    status: 'PENDING_COACH',
    memberId: 'm1',
    coachId: 'c1',
    member: person('m1', 'Ann'),
    coach: person('c1', 'Bob'),
    gym: null,
    timezone: 'Asia/Tomsk',
    options: [],
    confirmedStartAt: null,
    confirmedDurationMin: null,
    sessionId: null,
    memberComment: null,
    coachComment: null,
    closeComment: null,
    closedByRole: null,
    createdAt: new Date('2026-10-24T08:00:00Z'),
    updatedAt: new Date('2026-10-24T08:00:00Z'),
})

const makePrisma = () => ({
    personalTrainingRequest: {
        findMany: jest.fn().mockResolvedValue([row('r1'), row('r2')]),
    },
    personalTrainingCoach: {
        findUnique: jest.fn().mockResolvedValue({ userId: 'c1' }),
        findMany: jest.fn().mockResolvedValue([
            { userId: 'c1', user: { firstname: 'Bob', lastname: null, email: 'c1@x' } },
            { userId: 'c2', user: { firstname: 'Cy', lastname: null, email: 'c2@x' } },
        ]),
    },
    workspace: { findUnique: jest.fn().mockResolvedValue({ ownerId: 'owner' }) },
    workspaceMember: {
        findMany: jest.fn().mockResolvedValue([
            { userId: 'c1', role: { name: 'coach' } },
            { userId: 'c2', role: { name: 'coach' } },
        ]),
    },
})

const makeRbac = (admin = false) => ({
    resolveCoachScope: jest.fn().mockResolvedValue({ scope: admin ? 'admin' : 'coach_own_only' }),
    canWriteAllGroups: jest.fn().mockReturnValue(admin),
})

const run = (
    prisma: unknown,
    rbac: unknown,
    view?: 'mine' | 'workspace',
    roleName: string | null = 'coach',
) =>
    new ListPersonalTrainingsHandler(prisma as never, rbac as never).execute(
        new ListPersonalTrainingsFeature({ view }, 'w1', 'c1', roleName, false),
    )

describe('ListPersonalTrainingsHandler', () => {
    beforeEach(() => {
        jest.useFakeTimers({
            now: NOW,
            doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'queueMicrotask'],
        })
    })
    afterEach(() => jest.useRealTimers())

    it('lists the caller\'s own requests (as member or coach) from the last 90 days', async () => {
        const prisma = makePrisma()
        const out = await run(prisma, makeRbac())
        const args = prisma.personalTrainingRequest.findMany.mock.calls[0][0]
        expect(args.where).toEqual({
            workspaceId: 'w1',
            OR: [{ memberId: 'c1' }, { coachId: 'c1' }],
            updatedAt: { gte: new Date('2026-07-26T09:00:00Z') },
        })
        expect(args.orderBy).toEqual({ createdAt: 'desc' })
        expect(args.take).toBe(200)
        expect(out.data.map((r) => r.id)).toEqual(['r1', 'r2'])
    })

    it('reports the coach\'s own offer state and the other coaches available', async () => {
        const out = await run(makePrisma(), makeRbac())
        expect(out).toMatchObject({
            canOffer: true,
            offersPersonalTraining: true,
            coachesAvailable: 1,
        })
    })

    it('a plain member cannot offer and has not opted in', async () => {
        const prisma = makePrisma()
        prisma.personalTrainingCoach.findUnique.mockResolvedValue(null)
        const out = await run(prisma, makeRbac(), undefined, 'user')
        expect(out).toMatchObject({
            canOffer: false,
            offersPersonalTraining: false,
            coachesAvailable: 1,
        })
    })

    it('forbids the workspace view without admin scope', async () => {
        const prisma = makePrisma()
        await expect(run(prisma, makeRbac(false), 'workspace')).rejects.toBeInstanceOf(
            ForbiddenError,
        )
        expect(prisma.personalTrainingRequest.findMany).not.toHaveBeenCalled()
    })

    it('shows every request in the club to an admin', async () => {
        const prisma = makePrisma()
        await run(prisma, makeRbac(true), 'workspace', 'admin')
        expect(prisma.personalTrainingRequest.findMany.mock.calls[0][0].where).toEqual({
            workspaceId: 'w1',
            updatedAt: { gte: new Date('2026-07-26T09:00:00Z') },
        })
    })
})
