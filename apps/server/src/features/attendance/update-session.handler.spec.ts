// loadSessionForWrite is covered by session-access.spec; stub it so this test
// focuses on the update + serialization.
jest.mock('./session-access', () => ({
    loadSessionForWrite: jest.fn().mockResolvedValue({ id: 'sess1' }),
}))

import { UpdateSessionFeature } from './update-session.feature'
import { UpdateSessionHandler } from './update-session.handler'

const dbSession = (notes: string | null) => ({
    id: 'sess1',
    workspaceId: 'w1',
    groupId: 'g1',
    slotId: 's1',
    workspaceEventId: null,
    sessionDate: new Date('2026-07-02T00:00:00Z'),
    title: 'Morning',
    startAt: new Date('2026-07-02T16:00:00Z'),
    timezone: 'Europe/Moscow',
    coachId: 'c1',
    notes,
    createdAt: new Date('2026-07-02T16:00:00Z'),
    updatedAt: new Date('2026-07-02T16:00:00Z'),
    _count: { records: 3 },
})

const makePrisma = (returned: string | null) => ({
    attendanceSession: {
        update: jest.fn().mockResolvedValue(dbSession(returned)),
    },
})

const rbac = { resolveCoachScope: jest.fn().mockResolvedValue({ scope: 'all' }) }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (prisma: any, notes: string | null) =>
    new UpdateSessionHandler(prisma, rbac as never).execute(
        new UpdateSessionFeature({ notes }, 'w1', 'sess1', 'u1', 'admin', false),
    )

describe('updateSession', () => {
    it('trims and saves the note, returning the serialized session', async () => {
        const prisma = makePrisma('Belt test day')
        const out = await run(prisma, '  Belt test day  ')
        expect(prisma.attendanceSession.update).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: 'sess1' },
                data: { notes: 'Belt test day' },
            }),
        )
        expect(out).toMatchObject({ id: 'sess1', notes: 'Belt test day' })
    })

    it('stores null for a blank note', async () => {
        const prisma = makePrisma(null)
        await run(prisma, '   ')
        expect(prisma.attendanceSession.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: { notes: null } }),
        )
    })
})
