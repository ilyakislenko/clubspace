import {
    BadRequestError,
    ForbiddenError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { UpdateWorkspaceSettingsFeature } from './update-workspace-settings.feature'
import { UpdateWorkspaceSettingsHandler } from './update-workspace-settings.handler'

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
}

type LockRow = { feature: string; enabled: boolean; until: Date | null }

const build = (locks: LockRow[] = []) => {
    const update = jest.fn().mockResolvedValue(settingsRow)
    const record = jest.fn().mockResolvedValue(undefined)
    const prisma = {
        workspace: {
            update,
            findUnique: jest.fn().mockResolvedValue({
                ownerId: 'owner',
                coachSeesAllGroups: false,
            }),
        },
        workspaceFeatureLock: {
            findMany: jest.fn().mockResolvedValue(locks),
        },
    }
    const handler = new UpdateWorkspaceSettingsHandler(
        prisma as never,
        new RbacService(prisma as never),
        { record } as never,
    )
    return { handler, update, record }
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
    it.each(['coach', 'user'])(
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

    it('lets the owner (no member row) change settings', async () => {
        const { handler, update } = build()
        await run(
            handler,
            { joinAutoApprove: true },
            { userId: 'owner', roleName: null },
        )
        expect(update).toHaveBeenCalled()
    })

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
})
