import {
    BadRequestError,
    ForbiddenError,
    StaleUpdateError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { UpdateWorkspaceSettingsFeature } from './update-workspace-settings.feature'
import { UpdateWorkspaceSettingsHandler } from './update-workspace-settings.handler'

// The club row's current version in the mocked database.
const STORED_AT = new Date('2026-11-14T10:00:00.000Z')

const settingsRow = {
    id: 'w1',
    name: 'Club',
    coachSeesAllGroups: false,
    timezone: 'Europe/Moscow',
    joinAutoApprove: false,
    announcementsEnabled: true,
    ranksEnabled: true,
    leaderboardEnabled: true,
    attendanceEnabled: true,
    subscriptionEnabled: true,
    scheduleEnabled: true,
    groupsEnabled: true,
    eventsEnabled: true,
    guestVisitsEnabled: true,
    videosEnabled: true,
    achievementsEnabled: true,
    journalEnabled: true,
    updatedAt: new Date('2026-11-14T11:00:00.000Z'),
}

type LockRow = { feature: string; enabled: boolean; until: Date | null }

const build = (locks: LockRow[] = []) => {
    const update = jest.fn().mockResolvedValue(settingsRow)
    // The compare-and-set: matches only the stored version.
    const updateMany = jest.fn(
        async (args: { where: { updatedAt: Date } }) => ({
            count: args.where.updatedAt.getTime() === STORED_AT.getTime() ? 1 : 0,
        }),
    )
    const record = jest.fn().mockResolvedValue(undefined)
    const prisma: Record<string, unknown> = {
        workspace: {
            update,
            updateMany,
            findUnique: jest.fn().mockResolvedValue({
                ownerId: 'owner',
                coachSeesAllGroups: false,
            }),
        },
        workspaceFeatureLock: {
            findMany: jest.fn().mockResolvedValue(locks),
        },
    }
    prisma.$transaction = jest.fn(async (fn: (tx: unknown) => unknown) =>
        fn(prisma),
    )
    const handler = new UpdateWorkspaceSettingsHandler(
        prisma as never,
        new RbacService(prisma as never),
        { record } as never,
    )
    return { handler, update, updateMany, record }
}

const run = (
    handler: UpdateWorkspaceSettingsHandler,
    payload: Record<string, unknown>,
    who: { userId: string; roleName: string | null } = {
        userId: 'admin1',
        roleName: 'admin',
    },
) =>
    handler.execute(
        new UpdateWorkspaceSettingsFeature(
            payload,
            'w1',
            who.userId,
            who.roleName,
            false,
        ),
    )

describe('updateWorkspaceSettings', () => {
    // Settings are club-admin (owner/admin) territory: the head coach runs
    // every group of the sport side and is still refused.
    it.each(['head_coach', 'coach', 'user'])(
        'refuses a %s and writes nothing',
        async (roleName) => {
            const { handler, update, record } = build()
            await expect(
                run(
                    handler,
                    { joinAutoApprove: true },
                    { userId: 'u1', roleName },
                ),
            ).rejects.toBeInstanceOf(ForbiddenError)
            expect(update).not.toHaveBeenCalled()
            expect(record).not.toHaveBeenCalled()
        },
    )

    it.each([null, 'head_coach'])(
        'lets the owner change settings, whatever their member row says (%s)',
        async (roleName) => {
            const { handler, update } = build()
            await run(
                handler,
                { joinAutoApprove: true },
                { userId: 'owner', roleName },
            )
            expect(update).toHaveBeenCalled()
        },
    )

    it('applies a single feature-flag toggle and touches nothing else', async () => {
        const { handler, update } = build()
        await run(handler, { announcementsEnabled: false })

        expect(update).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: 'w1' },
                data: { announcementsEnabled: false },
            }),
        )
    })

    it('passes coachSeesAllGroups + multiple flags straight through', async () => {
        const { handler, update } = build()
        await run(handler, {
            coachSeesAllGroups: true,
            ranksEnabled: false,
            eventsEnabled: false,
        })

        expect(update.mock.calls[0][0].data).toEqual({
            coachSeesAllGroups: true,
            ranksEnabled: false,
            eventsEnabled: false,
        })
    })

    it('rejects an invalid timezone without writing', async () => {
        const { handler, update } = build()
        await expect(
            run(handler, { timezone: 'Europe/Mosсow' }), // Cyrillic с
        ).rejects.toBeInstanceOf(BadRequestError)
        expect(update).not.toHaveBeenCalled()
    })

    it('applies a valid timezone', async () => {
        const { handler, update } = build()
        await run(handler, { timezone: 'Asia/Krasnoyarsk' })

        expect(update.mock.calls[0][0].data).toEqual({
            timezone: 'Asia/Krasnoyarsk',
        })
    })

    it('turns auto-approval of code joins on and returns it', async () => {
        const { handler, update } = build()
        update.mockResolvedValue({ ...settingsRow, joinAutoApprove: true })
        const out = await run(handler, { joinAutoApprove: true })

        expect(update.mock.calls[0][0].data).toEqual({ joinAutoApprove: true })
        expect(update.mock.calls[0][0].select.joinAutoApprove).toBe(true)
        expect(out.joinAutoApprove).toBe(true)
    })

    it('lets coaches mark any class of the club and returns it', async () => {
        const { handler, update } = build()
        update.mockResolvedValue({ ...settingsRow, coachesMarkAnyClass: true })
        const out = await run(handler, { coachesMarkAnyClass: true })

        expect(update.mock.calls[0][0].data).toEqual({ coachesMarkAnyClass: true })
        expect(update.mock.calls[0][0].select.coachesMarkAnyClass).toBe(true)
        expect(out.coachesMarkAnyClass).toBe(true)
    })

    it('records an audit entry for the change', async () => {
        const { handler, record } = build()
        await run(handler, { leaderboardEnabled: false })

        expect(record).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'workspace.updateSettings',
                workspaceId: 'w1',
                actorId: 'admin1',
            }),
        )
    })

    describe('switches the platform pinned', () => {
        const locked: LockRow[] = [
            { feature: 'videos', enabled: false, until: null },
            { feature: 'events', enabled: true, until: new Date(Date.now() + 86_400_000) },
        ]

        it('refuses to change a locked switch and writes nothing', async () => {
            const { handler, update, record } = build(locked)
            const err = await run(handler, { videosEnabled: true }).catch((e) => e)
            expect(err).toBeInstanceOf(ForbiddenError)
            expect(err.message).toBe(
                'Раздел «Видео и курсы» установлен платформой — изменить его может только ClubSpace',
            )
            expect(update).not.toHaveBeenCalled()
            expect(record).not.toHaveBeenCalled()
        })

        it('refuses the owner too', async () => {
            const { handler, update } = build(locked)
            await expect(
                run(handler, { eventsEnabled: false }, { userId: 'owner', roleName: null }),
            ).rejects.toBeInstanceOf(ForbiddenError)
            expect(update).not.toHaveBeenCalled()
        })

        it('accepts the pinned value re-sent and other switches, and reports the locks', async () => {
            const { handler, update } = build(locked)
            const out = await run(handler, { videosEnabled: false, ranksEnabled: false })
            expect(update.mock.calls[0][0].data).toEqual({
                videosEnabled: false,
                ranksEnabled: false,
            })
            expect(out.lockedFeatures).toEqual([
                { feature: 'events', enabled: true, until: locked[1].until!.toISOString() },
                { feature: 'videos', enabled: false, until: null },
            ])
        })

        it('ignores a lock whose date has passed', async () => {
            const { handler, update } = build([
                { feature: 'events', enabled: true, until: new Date(Date.now() - 1000) },
            ])
            await run(handler, { eventsEnabled: false })
            expect(update).toHaveBeenCalled()
        })
    })

    describe('optimistic concurrency', () => {
        it('refuses a form that read an older version with 409, writing nothing', async () => {
            const { handler, update, record } = build()
            const err = await run(handler, {
                coachSeesAllGroups: true,
                expectedUpdatedAt: '2026-11-14T09:00:00.000Z',
            }).catch((e: unknown) => e)
            expect(err).toBeInstanceOf(StaleUpdateError)
            expect((err as StaleUpdateError).statusCode).toBe(409)
            expect(update).not.toHaveBeenCalled()
            expect(record).not.toHaveBeenCalled()
        })

        it('saves a form that read the current version and returns the new one', async () => {
            const { handler, update, updateMany } = build()
            const out = await run(handler, {
                coachSeesAllGroups: true,
                expectedUpdatedAt: STORED_AT.toISOString(),
            })
            expect(updateMany.mock.calls[0][0].where).toEqual({
                id: 'w1',
                updatedAt: STORED_AT,
            })
            // The version is not a column to write.
            expect(update.mock.calls[0][0].data).toEqual({ coachSeesAllGroups: true })
            expect(out.updatedAt).toBe('2026-11-14T11:00:00.000Z')
        })

        it('keeps last-write-wins when the version is omitted', async () => {
            const { handler, update, updateMany } = build()
            await run(handler, { coachSeesAllGroups: true })
            expect(updateMany).not.toHaveBeenCalled()
            expect(update).toHaveBeenCalled()
        })
    })
})
