// environment.ts reads required env vars at import; stub the one value the
// handlers read.
jest.mock('../../environments/environment', () => ({
    environment: { consent: { personalDataVersion: '2026-11-01' } },
}))

import { ConflictError, NotFoundError } from '../../shared/errors/shared.errors'
import { AcceptMyConsentFeature } from './accept-my-consent.feature'
import { AcceptMyConsentHandler } from './accept-my-consent.handler'
import { GetMyConsentFeature } from './get-my-consent.feature'
import { GetMyConsentHandler } from './get-my-consent.handler'

const CURRENT = '2026-11-01'

describe('getMyConsent', () => {
    const run = (user: unknown) => {
        const findUnique = jest.fn().mockResolvedValue(user)
        const prisma = { user: { findUnique } }
        return {
            findUnique,
            result: new GetMyConsentHandler(prisma as never).execute(
                new GetMyConsentFeature('u1'),
            ),
        }
    }

    it('reports a never-accepted account as required', async () => {
        const { result, findUnique } = run({
            personalDataConsentVersion: null,
            consentRecords: [],
        })
        await expect(result).resolves.toEqual({
            kind: 'PERSONAL_DATA',
            currentVersion: CURRENT,
            acceptedVersion: null,
            acceptedAt: null,
            required: true,
        })
        expect(findUnique.mock.calls[0][0].where).toEqual({ id: 'u1' })
        // Only still-standing acceptances count.
        expect(
            findUnique.mock.calls[0][0].select.consentRecords.where,
        ).toEqual({ kind: 'PERSONAL_DATA', withdrawnAt: null })
    })

    it('reports an older edition as required, with its acceptance date', async () => {
        const { result } = run({
            personalDataConsentVersion: '2026-01-01',
            consentRecords: [
                {
                    version: '2026-01-01',
                    acceptedAt: new Date('2026-01-02T10:00:00Z'),
                },
            ],
        })
        await expect(result).resolves.toMatchObject({
            acceptedVersion: '2026-01-01',
            acceptedAt: '2026-01-02T10:00:00.000Z',
            required: true,
        })
    })

    it('reports the current edition as not required', async () => {
        const { result } = run({
            personalDataConsentVersion: CURRENT,
            consentRecords: [
                { version: CURRENT, acceptedAt: new Date('2026-11-01T09:00:00Z') },
            ],
        })
        await expect(result).resolves.toMatchObject({
            acceptedVersion: CURRENT,
            acceptedAt: '2026-11-01T09:00:00.000Z',
            required: false,
        })
    })

    it('throws NotFound for a vanished user', async () => {
        const { result } = run(null)
        await expect(result).rejects.toBeInstanceOf(NotFoundError)
    })
})

describe('acceptMyConsent', () => {
    const setup = (user: unknown) => {
        const findUnique = jest.fn().mockResolvedValue(user)
        const create = jest.fn((args: { data: { version: string } }) =>
            Promise.resolve({
                version: args.data.version,
                acceptedAt: new Date('2026-11-01T12:00:00Z'),
            }),
        )
        const update = jest.fn().mockResolvedValue({ id: 'u1' })
        const prisma = {
            user: { findUnique, update },
            consentRecord: { create },
        }
        const handler = new AcceptMyConsentHandler(prisma as never)
        return { handler, findUnique, create, update }
    }

    it('records the acceptance with ip and user agent and moves the user to the edition', async () => {
        const { handler, create, update } = setup({
            personalDataConsentVersion: null,
            consentRecords: [],
        })
        const out = await handler.execute(
            new AcceptMyConsentFeature(
                { version: CURRENT },
                'u1',
                '203.0.113.7',
                'ClubSpace/1.0',
            ),
        )
        expect(create.mock.calls[0][0].data).toEqual({
            userId: 'u1',
            kind: 'PERSONAL_DATA',
            version: CURRENT,
            ip: '203.0.113.7',
            userAgent: 'ClubSpace/1.0',
        })
        expect(update.mock.calls[0][0]).toMatchObject({
            where: { id: 'u1' },
            data: { personalDataConsentVersion: CURRENT },
        })
        // The evidence is written before the gate opens.
        expect(create.mock.invocationCallOrder[0]).toBeLessThan(
            update.mock.invocationCallOrder[0],
        )
        expect(out).toEqual({
            kind: 'PERSONAL_DATA',
            currentVersion: CURRENT,
            acceptedVersion: CURRENT,
            acceptedAt: '2026-11-01T12:00:00.000Z',
            required: false,
        })
    })

    it('truncates an oversized user agent and stores missing evidence as null', async () => {
        const { handler, create } = setup({
            personalDataConsentVersion: '2026-01-01',
            consentRecords: [],
        })
        await handler.execute(
            new AcceptMyConsentFeature(
                { version: CURRENT },
                'u1',
                null,
                'x'.repeat(2000),
            ),
        )
        const data = create.mock.calls[0][0].data
        expect(data.ip).toBeNull()
        expect(data.userAgent).toHaveLength(512)
    })

    it('refuses an edition other than the current one', async () => {
        const { handler, findUnique, create } = setup({
            personalDataConsentVersion: null,
            consentRecords: [],
        })
        await expect(
            handler.execute(
                new AcceptMyConsentFeature({ version: '2025-01-01' }, 'u1', null, null),
            ),
        ).rejects.toBeInstanceOf(ConflictError)
        expect(findUnique).not.toHaveBeenCalled()
        expect(create).not.toHaveBeenCalled()
    })

    it('is idempotent when the edition is already accepted', async () => {
        const { handler, create, update } = setup({
            personalDataConsentVersion: CURRENT,
            consentRecords: [
                { version: CURRENT, acceptedAt: new Date('2026-11-01T09:00:00Z') },
            ],
        })
        const out = await handler.execute(
            new AcceptMyConsentFeature({ version: CURRENT }, 'u1', null, null),
        )
        expect(create).not.toHaveBeenCalled()
        expect(update).not.toHaveBeenCalled()
        expect(out.acceptedAt).toBe('2026-11-01T09:00:00.000Z')
        expect(out.required).toBe(false)
    })

    it('throws NotFound for a vanished user', async () => {
        const { handler } = setup(null)
        await expect(
            handler.execute(
                new AcceptMyConsentFeature({ version: CURRENT }, 'u1', null, null),
            ),
        ).rejects.toBeInstanceOf(NotFoundError)
    })
})
