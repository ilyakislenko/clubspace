import { NotFoundError } from '../../shared/errors/shared.errors'
import { GetWorkspaceSettingsFeature } from './get-workspace-settings.feature'
import { GetWorkspaceSettingsHandler } from './get-workspace-settings.handler'

const build = (row: unknown) => {
    const findUnique = jest.fn().mockResolvedValue(row)
    const handler = new GetWorkspaceSettingsHandler({
        workspace: { findUnique },
    } as never)
    return { handler, findUnique }
}

describe('getWorkspaceSettings', () => {
    it('selects and returns the auto-approval setting', async () => {
        const row = {
            id: 'w1',
            name: 'Club',
            coachSeesAllGroups: false,
            timezone: 'Europe/Moscow',
            joinAutoApprove: true,
        }
        const { handler, findUnique } = build({
            ...row,
            billing: null,
            moduleEntitlements: [],
        })
        const out = await handler.execute(new GetWorkspaceSettingsFeature('w1'))

        expect(findUnique.mock.calls[0][0].where).toEqual({ id: 'w1' })
        expect(findUnique.mock.calls[0][0].select.joinAutoApprove).toBe(true)
        expect(out).toEqual({ ...row, videoModuleEntitled: true })
    })

    it('reports videoModuleEntitled false when VIDEO is not on the bill', async () => {
        const { handler } = build({
            id: 'w1',
            billing: { status: 'ACTIVE' },
            moduleEntitlements: [],
        })
        const out = await handler.execute(new GetWorkspaceSettingsFeature('w1'))
        expect(out).toEqual({ id: 'w1', videoModuleEntitled: false })
    })

    it('404s on a missing club', async () => {
        const { handler } = build(null)
        await expect(
            handler.execute(new GetWorkspaceSettingsFeature('w1')),
        ).rejects.toBeInstanceOf(NotFoundError)
    })
})
