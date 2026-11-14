import {
    BadRequestError,
    ForbiddenError,
    NotFoundError,
    StaleUpdateError,
} from '../../shared/errors/shared.errors'
import { UpdateGroupFeature } from './update-group.feature'
import { UpdateGroupHandler } from './update-group.handler'

const OWNER = 'owner-1'
// The group's current version in the mocked database.
const STORED_AT = new Date('2026-11-14T10:00:00.000Z')

const build = (membership: unknown, access = 'admin', denyDirection = false) => {
    const tx = {
        group: {
            // The compare-and-set: matches only the stored version.
            updateMany: jest.fn(
                async (args: { where: { updatedAt: Date } }) => ({
                    count:
                        args.where.updatedAt.getTime() === STORED_AT.getTime()
                            ? 1
                            : 0,
                }),
            ),
            update: jest.fn().mockResolvedValue({
                id: 'g1',
                name: 'Kids',
                gymId: 'gym1',
                coachId: OWNER,
                updatedAt: new Date('2026-11-14T11:00:00.000Z'),
            }),
        },
        groupCoach: {
            deleteMany: jest.fn().mockResolvedValue({}),
            upsert: jest.fn().mockResolvedValue({}),
        },
    }
    const prisma = {
        workspace: { findUnique: jest.fn().mockResolvedValue({ type: 'GRAPPLING' }) },
        group: {
            findFirst: jest.fn().mockResolvedValue({
                id: 'g1',
                name: 'Kids',
                gymId: 'gym1',
                coachId: 'old-coach',
            }),
        },
        direction: {
            findFirst: jest.fn().mockResolvedValue({ id: 'dir-mma' }),
        },
        workspaceMember: {
            findFirst: jest.fn().mockResolvedValue(membership),
        },
        $transaction: jest.fn(async (fn: (c: typeof tx) => unknown) => fn(tx)),
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const rbac = {
        resolveCoachScope: jest
            .fn()
            .mockResolvedValue({ scope: 'admin', workspaceOwnerId: OWNER }),
        assertCanWriteGroup: jest.fn().mockResolvedValue(access),
        assertCanManageDirection: jest.fn(async () => {
            if (denyDirection) throw new ForbiddenError({ message: 'no' })
        }),
    }
    const handler = new UpdateGroupHandler(
        prisma as never,
        audit as never,
        rbac as never,
    )
    return { handler, tx, rbac }
}

const run = (handler: UpdateGroupHandler, coachId: string) =>
    handler.execute(
        new UpdateGroupFeature({ coachId }, 'w1', 'g1', 'admin1', 'admin', false),
    )

describe('updateGroup coach', () => {
    it('lets the owner without a member row become the primary coach', async () => {
        const { handler, tx } = build(null)
        const out = await run(handler, OWNER)
        expect(out.coachId).toBe(OWNER)
        expect(tx.groupCoach.upsert).toHaveBeenCalledWith(
            expect.objectContaining({
                create: { groupId: 'g1', userId: OWNER, role: 'primary' },
            }),
        )
    })

    it('still refuses a non-member who is not the owner', async () => {
        const { handler, tx } = build(null)
        await expect(run(handler, 'stranger')).rejects.toBeInstanceOf(
            NotFoundError,
        )
        expect(tx.group.update).not.toHaveBeenCalled()
    })

    it('still refuses a member without a coaching role', async () => {
        const { handler } = build({ role: { name: 'user' } })
        await expect(run(handler, 'student')).rejects.toBeInstanceOf(
            BadRequestError,
        )
    })
})

describe('updateGroup direction move', () => {
    const move = (handler: UpdateGroupHandler, directionId: string | null) =>
        handler.execute(
            new UpdateGroupFeature({ directionId }, 'w1', 'g1', 'm1', 'coach', false),
        )

    it('holds a direction manager to the target direction', async () => {
        const { handler, tx, rbac } = build(null, 'direction', true)
        await expect(move(handler, 'dir-mma')).rejects.toBeInstanceOf(
            ForbiddenError,
        )
        expect(rbac.assertCanManageDirection).toHaveBeenCalledWith(
            expect.anything(),
            'dir-mma',
        )
        expect(tx.group.update).not.toHaveBeenCalled()
    })

    it('refuses a direction manager making the group club-wide', async () => {
        const { handler, rbac } = build(null, 'direction', true)
        await expect(move(handler, null)).rejects.toBeInstanceOf(ForbiddenError)
        expect(rbac.assertCanManageDirection).toHaveBeenCalledWith(
            expect.anything(),
            null,
        )
    })

    it('does not apply the direction rule to admins or the group coach', async () => {
        for (const access of ['admin', 'coach']) {
            const { handler, tx, rbac } = build(null, access, true)
            await move(handler, 'dir-mma')
            expect(rbac.assertCanManageDirection).not.toHaveBeenCalled()
            expect(tx.group.update).toHaveBeenCalled()
        }
    })

    it('skips the rule when the direction is not changed', async () => {
        const { handler, rbac } = build(null, 'direction', true)
        await handler.execute(
            new UpdateGroupFeature({ name: 'BJJ утро' }, 'w1', 'g1', 'm1', 'coach', false),
        )
        expect(rbac.assertCanManageDirection).not.toHaveBeenCalled()
    })
})

describe('updateGroup optimistic concurrency', () => {
    const rename = (handler: UpdateGroupHandler, expectedUpdatedAt?: string) =>
        handler.execute(
            new UpdateGroupFeature(
                { name: 'BJJ вечер', expectedUpdatedAt },
                'w1',
                'g1',
                'admin1',
                'admin',
                false,
            ),
        )

    it('refuses a form that read an older version with 409, writing nothing', async () => {
        const { handler, tx } = build(null)
        const err = await rename(handler, '2026-11-14T09:59:59.999Z').catch(
            (e: unknown) => e,
        )
        expect(err).toBeInstanceOf(StaleUpdateError)
        expect((err as StaleUpdateError).statusCode).toBe(409)
        expect(tx.group.update).not.toHaveBeenCalled()
    })

    it('saves a form that read the current version and returns the new one', async () => {
        const { handler, tx } = build(null)
        const out = await rename(handler, STORED_AT.toISOString())
        expect(tx.group.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: 'g1', workspaceId: 'w1', updatedAt: STORED_AT },
            }),
        )
        expect(tx.group.update).toHaveBeenCalled()
        expect(out.updatedAt).toBe('2026-11-14T11:00:00.000Z')
    })

    it('keeps last-write-wins when the version is omitted', async () => {
        const { handler, tx } = build(null)
        await rename(handler)
        expect(tx.group.updateMany).not.toHaveBeenCalled()
        expect(tx.group.update).toHaveBeenCalled()
    })
})
