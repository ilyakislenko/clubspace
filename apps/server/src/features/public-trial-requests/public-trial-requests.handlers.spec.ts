jest.mock('../../infrastructure/prisma', () => ({ PrismaService: class {} }))

import { Logger } from '@nestjs/common'

import { LEAD_CONSENT_OUTDATED, LEAD_CONSENT_VERSION } from '../../domains/leads/lead-consent'
import { TrialRequestsCappedError } from '../../domains/leads/lead-errors'
import { BadRequestError, NotFoundError } from '../../shared/errors/shared.errors'
import { LEAD_PHONE_INVALID } from '../leads/schemas'
import {
    CreatePublicTrialRequestFeature,
    CreatePublicTrialRequestInputSchema,
} from './create-public-trial-request.feature'
import {
    CreatePublicTrialRequestHandler,
    LEAD_MERGED_COMMENT_MAX,
    resubmissionNote,
    TRIAL_CONSENT_REQUIRED,
} from './create-public-trial-request.handler'
import { GetPublicTrialFormFeature } from './get-public-trial-form.feature'
import { GetPublicTrialFormHandler } from './get-public-trial-form.handler'
import { TRIAL_FORM_CLOSED } from './schemas'

const NOW = new Date('2026-12-10T09:00:00Z')

const CLUB = {
    id: 'w1',
    name: 'Академия',
    ownerId: 'owner',
    timezone: 'Europe/Moscow',
    isActive: true,
    isListed: false,
    logoKey: null,
    trialRequestsEnabled: true,
    pdOperatorName: 'ИП Орлов',
    pdOperatorAddress: 'г. Москва, ул. Примерная, 1',
    aboutContacts: [{ label: 'Администратор', phone: '+7 900 000-00-00' }],
    aboutLinks: [],
    aboutRules: null,
    aboutUpdatedAt: null,
}

const input = {
    name: 'Анна Смирнова',
    phone: '+7 952 884-94-20',
    email: 'anna@example.com',
    forChild: true,
    childName: 'Маша',
    childAge: 8,
    comment: 'Хотим в субботу',
    source: 'qr' as const,
    consent: true,
    consentVersion: LEAD_CONSENT_VERSION,
}

const make = (o: { club?: Partial<typeof CLUB> | null; lastDay?: number; duplicate?: { id: string; comment: string | null } } = {}) => {
    const prisma = {
        workspacePublicSlug: {
            findUnique: jest.fn(async () => (o.club === null ? null : { workspace: { ...CLUB, ...o.club } })),
        },
        direction: {
            findFirst: jest.fn().mockResolvedValue(null),
            findMany: jest.fn().mockResolvedValue([{ id: 'd1', name: 'Дети' }]),
        },
        lead: {
            count: jest.fn().mockResolvedValue(o.lastDay ?? 0),
            findFirst: jest.fn().mockResolvedValue(o.duplicate ?? null),
            update: jest.fn().mockResolvedValue({}),
            create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
                id: 'lead-1',
                directionName: data.directionName ?? null,
            })),
        },
        workspaceMember: { findMany: jest.fn().mockResolvedValue([{ userId: 'head1' }]) },
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const realtime = { invalidate: jest.fn() }
    const notifications = { notifyUser: jest.fn().mockResolvedValue(true) }
    const handler = new CreatePublicTrialRequestHandler(
        prisma as never,
        audit as never,
        realtime as never,
        notifications as never,
    )
    const run = (payload: Record<string, unknown> = input) =>
        handler.execute(
            new CreatePublicTrialRequestFeature(payload as never, 'akademiya', '10.0.0.7', 'Safari/17', NOW),
        )
    return { prisma, audit, realtime, notifications, run }
}

const PD_PATTERN = /Анна|Смирнова|\+7952|anna@|Маша|субботу/

describe('public trial requests', () => {
    let warn: jest.SpyInstance
    beforeEach(() => {
        warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    })
    afterEach(() => warn.mockRestore())

    it('a filled honeypot answers received and stores nothing', async () => {
        const t = make()
        await expect(t.run({ ...input, website: 'http://spam', consent: false })).resolves.toEqual({
            status: 'received',
        })
        expect(t.prisma.lead.create).not.toHaveBeenCalled()
        expect(t.prisma.lead.update).not.toHaveBeenCalled()
        expect(t.notifications.notifyUser).not.toHaveBeenCalled()
    })

    it('refuses a missing consent, an old edition and a bad phone', async () => {
        await expect(make().run({ ...input, consent: false })).rejects.toThrow(
            new BadRequestError({ message: TRIAL_CONSENT_REQUIRED }),
        )
        await expect(make().run({ ...input, consentVersion: '2026-11-01' })).rejects.toThrow(LEAD_CONSENT_OUTDATED)
        await expect(make().run({ ...input, phone: '12-34' })).rejects.toThrow(LEAD_PHONE_INVALID)
    })

    it.each([
        ['the switch is off', { trialRequestsEnabled: false }],
        ['the operator has no address', { pdOperatorAddress: null }],
        ['the operator has no name', { pdOperatorName: null }],
        ['the club is inactive', { isActive: false }],
    ])('404s when %s', async (_why, club) => {
        await expect(make({ club: club as never }).run()).rejects.toThrow(new NotFoundError({ message: TRIAL_FORM_CLOSED }))
    })

    it('404s an unknown slug', async () => {
        await expect(make({ club: null }).run()).rejects.toBeInstanceOf(NotFoundError)
    })

    it('answers 429 past the club cap of 50 a day, and logs it', async () => {
        const t = make({ lastDay: 50 })
        await expect(t.run()).rejects.toBeInstanceOf(TrialRequestsCappedError)
        expect(t.prisma.lead.count.mock.calls[0][0].where).toEqual({
            workspaceId: 'w1',
            createdById: null,
            createdAt: { gte: new Date(NOW.getTime() - 24 * 60 * 60_000) },
        })
        expect(warn).toHaveBeenCalled()
        expect(t.prisma.lead.create).not.toHaveBeenCalled()
    })

    it('stores a NEW lead with consent evidence, audits without PD and pushes without PD', async () => {
        const t = make()
        await expect(t.run()).resolves.toEqual({ status: 'received' })
        expect(t.prisma.lead.create.mock.calls[0][0].data).toMatchObject({
            workspaceId: 'w1',
            source: 'QR',
            status: 'NEW',
            phone: '+79528849420',
            forChild: true,
            childName: 'Маша',
            childAge: 8,
            consentVersion: LEAD_CONSENT_VERSION,
            consentAt: NOW,
            consentIp: '10.0.0.7',
            consentUserAgent: 'Safari/17',
        })
        expect(t.prisma.lead.create.mock.calls[0][0].data.createdById).toBeUndefined()
        expect(t.audit.record.mock.calls[0][0]).toEqual({
            action: 'lead.create',
            targetType: 'lead',
            targetId: 'lead-1',
            workspaceId: 'w1',
            actorId: null,
            metadata: { leadSource: 'QR' },
        })
        expect(t.realtime.invalidate).toHaveBeenCalledWith('w1', ['leads'])
        expect(t.notifications.notifyUser.mock.calls.map((c) => c[0].userId).sort()).toEqual(['head1', 'owner'])
        expect(t.notifications.notifyUser.mock.calls[0][0]).toMatchObject({
            kind: 'lead.created',
            topic: 'Новая заявка на пробное',
        })
        expect(JSON.stringify(t.notifications.notifyUser.mock.calls)).not.toMatch(PD_PATTERN)
        expect(JSON.stringify(t.audit.record.mock.calls)).not.toMatch(PD_PATTERN)
    })

    it('merges a duplicate into the open lead: no new row, no push, same answer', async () => {
        const t = make({ duplicate: { id: 'lead-0', comment: 'Первый раз' } })
        await expect(t.run({ ...input, comment: 'Можно в воскресенье?' })).resolves.toEqual({ status: 'received' })
        expect(t.prisma.lead.create).not.toHaveBeenCalled()
        expect(t.notifications.notifyUser).not.toHaveBeenCalled()
        // The first consent evidence stays: only the words and the repeat mark.
        expect(t.prisma.lead.update.mock.calls[0][0]).toEqual({
            where: { id: 'lead-0' },
            data: {
                comment: 'Первый раз\n10.12.2026: Можно в воскресенье?',
                resubmittedAt: NOW,
            },
        })
        expect(t.realtime.invalidate).toHaveBeenCalledWith('w1', ['leads'])
    })

    it('stops growing a merged comment at the cap, still marking the repeat', async () => {
        const t = make({ duplicate: { id: 'lead-0', comment: 'x'.repeat(LEAD_MERGED_COMMENT_MAX) } })
        await t.run({ ...input, comment: 'ещё раз' })
        expect(t.prisma.lead.update.mock.calls[0][0]).toEqual({
            where: { id: 'lead-0' },
            data: { resubmittedAt: NOW },
        })
    })

    it('dates a repeat note in the club zone', () => {
        expect(resubmissionNote(new Date('2026-12-10T22:30:00Z'), 'Asia/Novosibirsk', undefined)).toBe(
            '11.12.2026: повторная заявка',
        )
    })

    it('the schema needs the child block for a child request and a page or qr source', () => {
        const { childName: _n, ...noChild } = input
        expect(CreatePublicTrialRequestInputSchema.safeParse(noChild).success).toBe(false)
        expect(CreatePublicTrialRequestInputSchema.safeParse({ ...input, childAge: 18 }).success).toBe(false)
        expect(CreatePublicTrialRequestInputSchema.safeParse({ ...input, source: 'utm' }).success).toBe(false)
        expect(CreatePublicTrialRequestInputSchema.safeParse({ ...input, email: 'nope' }).success).toBe(false)
        expect(CreatePublicTrialRequestInputSchema.safeParse(input).success).toBe(true)
    })

    describe('getPublicTrialForm', () => {
        it('shows the operator, directions, consent edition and contacts — for an unlisted club too', async () => {
            const t = make()
            const handler = new GetPublicTrialFormHandler(t.prisma as never, {} as never)
            expect(await handler.execute(new GetPublicTrialFormFeature('akademiya'))).toEqual({
                clubName: 'Академия',
                logoUrl: null,
                directions: [{ id: 'd1', name: 'Дети' }],
                operator: { name: 'ИП Орлов', address: 'г. Москва, ул. Примерная, 1' },
                consentVersion: LEAD_CONSENT_VERSION,
                contacts: [{ label: 'Администратор', phone: '+7 900 000-00-00' }],
                isListed: false,
            })
        })

        it('404s while the form is off', async () => {
            const t = make({ club: { trialRequestsEnabled: false } })
            const handler = new GetPublicTrialFormHandler(t.prisma as never, {} as never)
            await expect(handler.execute(new GetPublicTrialFormFeature('akademiya'))).rejects.toBeInstanceOf(NotFoundError)
        })
    })
})
