import { ForbiddenError } from '../../shared/errors/shared.errors'
import { SetPersonalTrainingOfferFeature } from './set-personal-training-offer.feature'
import { SetPersonalTrainingOfferHandler } from './set-personal-training-offer.handler'

const makePrisma = () => ({
    personalTrainingCoach: {
        create: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
})

const makeRbac = (allowed = true) => ({
    resolveCoachScope: jest.fn().mockImplementation(async () => {
        if (!allowed) {
            throw new ForbiddenError({ message: 'Нужны права администратора клуба' })
        }
        return { scope: 'coach_own_only' }
    }),
})

const run = (prisma: unknown, rbac: unknown, enabled: boolean) =>
    new SetPersonalTrainingOfferHandler(prisma as never, rbac as never).execute(
        new SetPersonalTrainingOfferFeature({ enabled }, 'w1', 'c1', 'coach', false),
    )

describe('SetPersonalTrainingOfferHandler', () => {
    it('refuses a plain member', async () => {
        const prisma = makePrisma()
        await expect(run(prisma, makeRbac(false), true)).rejects.toBeInstanceOf(
            ForbiddenError,
        )
        expect(prisma.personalTrainingCoach.create).not.toHaveBeenCalled()
    })

    it('opts a coach in', async () => {
        const prisma = makePrisma()
        await expect(run(prisma, makeRbac(), true)).resolves.toEqual({
            offersPersonalTraining: true,
        })
        expect(prisma.personalTrainingCoach.create).toHaveBeenCalledWith({
            data: { workspaceId: 'w1', userId: 'c1' },
        })
    })

    it('treats an existing opt-in as success', async () => {
        const prisma = makePrisma()
        prisma.personalTrainingCoach.create.mockRejectedValue({ code: 'P2002' })
        await expect(run(prisma, makeRbac(), true)).resolves.toEqual({
            offersPersonalTraining: true,
        })
    })

    it('rethrows any other create failure', async () => {
        const prisma = makePrisma()
        prisma.personalTrainingCoach.create.mockRejectedValue(new Error('db down'))
        await expect(run(prisma, makeRbac(), true)).rejects.toThrow('db down')
    })

    it('opts out by deleting the row', async () => {
        const prisma = makePrisma()
        await expect(run(prisma, makeRbac(), false)).resolves.toEqual({
            offersPersonalTraining: false,
        })
        expect(prisma.personalTrainingCoach.deleteMany).toHaveBeenCalledWith({
            where: { workspaceId: 'w1', userId: 'c1' },
        })
    })
})
