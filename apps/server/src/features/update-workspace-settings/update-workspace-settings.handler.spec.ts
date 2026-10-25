import { BadRequestError } from '../../shared/errors/shared.errors'
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

const build = () => {
    const update = jest.fn().mockResolvedValue(settingsRow)
    const record = jest.fn().mockResolvedValue(undefined)
    const handler = new UpdateWorkspaceSettingsHandler(
        { workspace: { update } } as never,
        { record } as never,
    )
    return { handler, update, record }
}

const run = (
    handler: UpdateWorkspaceSettingsHandler,
    payload: Record<string, unknown>,
) => handler.execute(new UpdateWorkspaceSettingsFeature(payload, 'w1', 'admin1'))

describe('updateWorkspaceSettings', () => {
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
})
