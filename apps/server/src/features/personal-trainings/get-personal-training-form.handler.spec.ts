import { GetPersonalTrainingFormFeature } from './get-personal-training-form.feature'
import { GetPersonalTrainingFormHandler } from './get-personal-training-form.handler'

const makePrisma = () => ({
    workspace: {
        findUnique: jest
            .fn()
            .mockResolvedValue({ ownerId: 'owner', timezone: 'Europe/Moscow' }),
    },
    personalTrainingCoach: {
        findMany: jest.fn().mockResolvedValue([
            { userId: 'c1', user: { firstname: 'Bob', lastname: null, email: 'c1@x' } },
            { userId: 'c2', user: { firstname: null, lastname: null, email: 'c2@x' } },
            { userId: 'c3', user: { firstname: 'Old', lastname: null, email: 'c3@x' } },
        ]),
    },
    workspaceMember: {
        findMany: jest.fn().mockResolvedValue([
            { userId: 'c1', role: { name: 'coach' } },
            { userId: 'c2', role: { name: 'head_coach' } },
            { userId: 'c3', role: { name: 'user' } },
        ]),
    },
    gym: {
        findMany: jest.fn().mockResolvedValue([
            { id: 'g1', name: 'Манеж', address: 'ул. 1', timezone: 'Asia/Tomsk' },
            { id: 'g2', name: 'Зал', address: 'ул. 2', timezone: null },
        ]),
    },
})

const run = (prisma: unknown, invoker = 'm1') =>
    new GetPersonalTrainingFormHandler(prisma as never).execute(
        new GetPersonalTrainingFormFeature('w1', invoker),
    )

describe('GetPersonalTrainingFormHandler', () => {
    it('lists coaches who still coach, with each gym\'s effective timezone', async () => {
        const prisma = makePrisma()
        await expect(run(prisma)).resolves.toEqual({
            timezone: 'Europe/Moscow',
            coaches: [
                { userId: 'c1', displayName: 'Bob' },
                { userId: 'c2', displayName: 'c2@x' },
            ],
            gyms: [
                { id: 'g1', name: 'Манеж', address: 'ул. 1', timezone: 'Asia/Tomsk' },
                { id: 'g2', name: 'Зал', address: 'ул. 2', timezone: 'Europe/Moscow' },
            ],
        })
        expect(prisma.gym.findMany.mock.calls[0][0]).toMatchObject({
            where: { workspaceId: 'w1' },
            orderBy: { name: 'asc' },
        })
    })

    it('leaves the caller out of the coach list', async () => {
        const out = await run(makePrisma(), 'c1')
        expect(out.coaches.map((c) => c.userId)).toEqual(['c2'])
    })

    it('lists the owner when they opted in without a member row', async () => {
        const prisma = makePrisma()
        prisma.personalTrainingCoach.findMany.mockResolvedValue([
            { userId: 'owner', user: { firstname: 'Own', lastname: null, email: 'o@x' } },
        ])
        prisma.workspaceMember.findMany.mockResolvedValue([])
        const out = await run(prisma)
        expect(out.coaches).toEqual([{ userId: 'owner', displayName: 'Own' }])
    })
})
