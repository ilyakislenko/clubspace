import { NotFoundError } from '../../shared/errors/shared.errors'
import { GetPersonalTrainingFeature } from './get-personal-training.feature'
import { GetPersonalTrainingHandler } from './get-personal-training.handler'

const person = (id: string, firstname: string) => ({
    id,
    firstname,
    lastname: null,
    email: `${id}@x`,
})

const ROW = {
    id: 'r1',
    workspaceId: 'w1',
    status: 'PENDING_COACH',
    memberId: 'm1',
    coachId: 'c1',
    member: person('m1', 'Ann'),
    coach: person('c1', 'Bob'),
    gym: { id: 'g1', name: 'Манеж', address: 'ул. 1' },
    timezone: 'Asia/Tomsk',
    options: [
        {
            id: 'o1',
            startAt: new Date('2099-10-31T12:00:00Z'),
            durationMin: 60,
            proposedBy: 'member',
            createdAt: new Date('2026-10-24T08:00:00Z'),
        },
    ],
    confirmedStartAt: null,
    confirmedDurationMin: null,
    sessionId: null,
    memberComment: 'Привет',
    coachComment: null,
    closeComment: null,
    closedByRole: null,
    createdAt: new Date('2026-10-24T08:00:00Z'),
    updatedAt: new Date('2026-10-24T08:00:00Z'),
}

const makePrisma = (row: unknown = ROW) => ({
    personalTrainingRequest: { findFirst: jest.fn().mockResolvedValue(row) },
})

const makeRbac = (admin = false) => ({
    resolveCoachScope: jest.fn().mockImplementation(async () => {
        if (!admin) throw new Error('forbidden')
        return { scope: 'admin' }
    }),
    canWriteAllGroups: jest.fn().mockReturnValue(admin),
})

const run = (prisma: unknown, rbac: unknown, invoker: string) =>
    new GetPersonalTrainingHandler(prisma as never, rbac as never).execute(
        new GetPersonalTrainingFeature('w1', 'r1', invoker, 'coach', false),
    )

describe('GetPersonalTrainingHandler', () => {
    it('serializes the request for the member and the coach', async () => {
        for (const invoker of ['m1', 'c1']) {
            await expect(
                run(makePrisma(), makeRbac(), invoker),
            ).resolves.toMatchObject({
                id: 'r1',
                status: 'PENDING_COACH',
                displayStatus: 'PENDING_COACH',
                member: { userId: 'm1', displayName: 'Ann' },
                coach: { userId: 'c1', displayName: 'Bob' },
                gym: { id: 'g1', name: 'Манеж', address: 'ул. 1' },
                timezone: 'Asia/Tomsk',
                options: [
                    {
                        id: 'o1',
                        startAt: '2099-10-31T12:00:00.000Z',
                        durationMin: 60,
                        proposedBy: 'member',
                    },
                ],
                memberComment: 'Привет',
                closedByRole: null,
            })
        }
    })

    it('scopes the lookup to the club', async () => {
        const prisma = makePrisma()
        await run(prisma, makeRbac(), 'm1')
        expect(prisma.personalTrainingRequest.findFirst.mock.calls[0][0].where).toEqual({
            id: 'r1',
            workspaceId: 'w1',
        })
    })

    it('is NotFound for an unknown request', async () => {
        await expect(
            run(makePrisma(null), makeRbac(), 'm1'),
        ).rejects.toBeInstanceOf(NotFoundError)
    })

    it('is NotFound for a non-participant who is not an admin', async () => {
        await expect(
            run(makePrisma(), makeRbac(), 'stranger'),
        ).rejects.toBeInstanceOf(NotFoundError)
    })

    it('lets an admin read any request', async () => {
        await expect(
            run(makePrisma(), makeRbac(true), 'admin1'),
        ).resolves.toMatchObject({ id: 'r1' })
    })
})
