import { environment } from '../../environments/environment'
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
    const savedKey = environment.ai.chat.apiKey
    beforeEach(() => {
        environment.ai.chat.apiKey = ''
    })
    afterAll(() => {
        environment.ai.chat.apiKey = savedKey
    })

    it('selects and returns the auto-approval setting', async () => {
        const row = {
            id: 'w1',
            name: 'Club',
            coachSeesAllGroups: false,
            timezone: 'Europe/Moscow',
            joinAutoApprove: true,
            coachesMarkAnyClass: true,
            coachPayVisible: false,
        }
        const { handler, findUnique } = build({
            ...row,
            updatedAt: new Date('2026-11-14T10:00:00.000Z'),
            billing: null,
            moduleEntitlements: [],
            featureLocks: [],
        })
        const out = await handler.execute(new GetWorkspaceSettingsFeature('w1'))

        expect(findUnique.mock.calls[0][0].where).toEqual({ id: 'w1' })
        expect(findUnique.mock.calls[0][0].select.joinAutoApprove).toBe(true)
        expect(findUnique.mock.calls[0][0].select.coachesMarkAnyClass).toBe(true)
        expect(findUnique.mock.calls[0][0].select.coachPayVisible).toBe(true)
        expect(out).toEqual({
            ...row,
            // The version a settings edit sends back.
            updatedAt: '2026-11-14T10:00:00.000Z',
            videoModuleEntitled: true,
            aiConfigured: false,
            lockedFeatures: [],
        })
    })

    it('reports videoModuleEntitled false when VIDEO is not on the bill', async () => {
        const { handler } = build({
            id: 'w1',
            updatedAt: new Date('2026-11-14T10:00:00.000Z'),
            billing: { status: 'ACTIVE' },
            moduleEntitlements: [],
            featureLocks: [],
        })
        const out = await handler.execute(new GetWorkspaceSettingsFeature('w1'))
        expect(out).toEqual({
            id: 'w1',
            updatedAt: '2026-11-14T10:00:00.000Z',
            videoModuleEntitled: false,
            aiConfigured: false,
            lockedFeatures: [],
        })
    })

    it('reports the switches the platform pinned, only while the lock holds', async () => {
        const until = new Date(Date.now() + 86_400_000)
        const { handler, findUnique } = build({
            id: 'w1',
            updatedAt: new Date('2026-11-14T10:00:00.000Z'),
            billing: null,
            moduleEntitlements: [],
            featureLocks: [
                { feature: 'videos', enabled: false, until: null },
                { feature: 'events', enabled: true, until },
                { feature: 'ranks', enabled: false, until: new Date(Date.now() - 1000) },
            ],
        })
        const out = await handler.execute(new GetWorkspaceSettingsFeature('w1'))
        expect(findUnique.mock.calls[0][0].select.featureLocks.where).toEqual({
            OR: [{ until: null }, { until: { gt: expect.any(Date) } }],
        })
        expect(out.lockedFeatures).toEqual([
            { feature: 'events', enabled: true, until: until.toISOString() },
            { feature: 'videos', enabled: false, until: null },
        ])
    })

    it('selects the video answers switch and tells whether an AI model is configured', async () => {
        environment.ai.chat.apiKey = 'key'
        const { handler, findUnique } = build({
            id: 'w1',
            videoAnswersEnabled: true,
            updatedAt: new Date('2026-11-14T10:00:00.000Z'),
            billing: null,
            moduleEntitlements: [],
            featureLocks: [],
        })
        const out = await handler.execute(new GetWorkspaceSettingsFeature('w1'))
        expect(findUnique.mock.calls[0][0].select.videoAnswersEnabled).toBe(true)
        expect(out).toMatchObject({ videoAnswersEnabled: true, aiConfigured: true })
    })

    it('404s on a missing club', async () => {
        const { handler } = build(null)
        await expect(
            handler.execute(new GetWorkspaceSettingsFeature('w1')),
        ).rejects.toBeInstanceOf(NotFoundError)
    })
})
