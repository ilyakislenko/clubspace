jest.mock('../../infrastructure/prisma', () => ({ PrismaService: class {} }))
jest.mock('../../environments/environment', () => ({
    environment: { appUrl: 'https://app.club.example' },
}))
jest.mock('../../domains/workspace/join-qr', () => ({
    buildJoinQrPngDataUrl: jest.fn(async (url: string) => `data:image/png;qr,${url}`),
}))

import { LEAD_CONSENT_VERSION } from '../../domains/leads/lead-consent'
import { LeadDuplicateError } from '../../domains/leads/lead-errors'
import {
    BadRequestError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
    StaleUpdateError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { CreateLeadFeature, CreateLeadInputSchema } from './create-lead.feature'
import { CreateLeadHandler } from './create-lead.handler'
import { EraseLeadFeature } from './erase-lead.feature'
import { EraseLeadHandler } from './erase-lead.handler'
import { GetLeadConversionReportFeature } from './get-lead-conversion-report.feature'
import { GetLeadConversionReportHandler } from './get-lead-conversion-report.handler'
import { GetLeadFeature } from './get-lead.feature'
import { GetLeadHandler } from './get-lead.handler'
import { GetTrialLinkFeature } from './get-trial-link.feature'
import { GetTrialLinkHandler } from './get-trial-link.handler'
import { LEAD_SPORT_LEAD_ONLY } from './leads-utils'
import { LinkLeadMemberFeature } from './link-lead-member.feature'
import { LEAD_LINK_NOT_STUDENT, LEAD_LINKED_ELSEWHERE, LinkLeadMemberHandler } from './link-lead-member.handler'
import { ListLeadsFeature } from './list-leads.feature'
import { leadViewWhere, ListLeadsHandler } from './list-leads.handler'
import { SetLeadStatusFeature } from './set-lead-status.feature'
import {
    LEAD_LOST_COMMENT_REQUIRED,
    LEAD_MOVE_REFUSED,
    LEAD_STATUS_CHANGED,
    LEAD_TRIAL_AT_REQUIRED,
    SetLeadStatusHandler,
} from './set-lead-status.handler'
import { UpdateLeadFeature } from './update-lead.feature'
import { UpdateLeadHandler } from './update-lead.handler'

const WS = 'w1'
const OWNER = 'owner'
const LEAD_ID = '11111111-1111-4111-8111-111111111111'
const NOW = new Date('2026-12-10T09:00:00Z')
const STORED_AT = new Date('2026-12-09T10:00:00Z')

const CLUB = {
    id: WS,
    name: 'Академия',
    timezone: 'Europe/Moscow',
    ownerId: OWNER,
    coachSeesAllGroups: false,
    trialRequestsEnabled: true,
    pdOperatorName: 'ИП Орлов',
    pdOperatorAddress: 'г. Москва',
}

const BASE_LEAD = {
    id: LEAD_ID,
    source: 'PUBLIC_PAGE' as const,
    status: 'NEW' as const,
    name: 'Анна Смирнова',
    phone: '+79528849420',
    email: 'anna@example.com',
    forChild: true,
    childName: 'Маша',
    childAge: 8,
    directionId: null,
    directionName: 'Дети',
    comment: 'Хотим в субботу',
    staffNote: null,
    trialAt: null,
    trialGroupId: null,
    trialGroupName: null,
    contactedAt: null,
    trialBookedAt: null,
    cameAt: null,
    lostAt: null,
    lostReason: null,
    lostComment: null,
    convertedUserId: null as string | null,
    convertedAt: null,
    convertedUser: null,
    trialGroup: null as { gym: { timezone: string | null } | null } | null,
    consentVersion: LEAD_CONSENT_VERSION,
    consentAt: STORED_AT,
    consentRecordedById: null,
    resubmittedAt: null,
    anonymizedAt: null as Date | null,
    createdAt: STORED_AT,
    updatedAt: STORED_AT,
}
type Lead = typeof BASE_LEAD & Record<string, unknown>

// An in-memory lead: writes apply to it, so assertions read what the handler
// actually wrote.
const makeDb = (
    o: {
        lead?: Partial<Lead> | null
        member?: boolean
        duplicateId?: string
        group?: { id: string; name: string; coachId: string; gym: { timezone: string } | null }
        boughtUserIds?: string[]
    } = {},
) => {
    let lead: Lead | null = o.lead === null ? null : ({ ...BASE_LEAD, ...o.lead } as Lead)
    const prisma = {
        workspace: { findUnique: jest.fn(async () => CLUB) },
        workspacePublicSlug: {
            findUnique: jest.fn().mockResolvedValue({ slug: 'akademiya' }),
        },
        lead: {
            findFirst: jest.fn(async ({ where }: { where: { id?: unknown } }) => {
                if (typeof where.id === 'string') {
                    return lead && where.id === lead.id ? { ...lead } : null
                }
                return o.duplicateId ? { id: o.duplicateId } : null
            }),
            findFirstOrThrow: jest.fn(async () => ({ ...lead })),
            updateMany: jest.fn(
                async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
                    if (!lead) return { count: 0 }
                    if (where.status && where.status !== lead.status) return { count: 0 }
                    if (where.anonymizedAt === null && lead.anonymizedAt) return { count: 0 }
                    if (where.convertedUserId === null && lead.convertedUserId) return { count: 0 }
                    if (where.updatedAt && +(where.updatedAt as Date) !== +lead.updatedAt) {
                        return { count: 0 }
                    }
                    lead = { ...lead, ...data } as Lead
                    return { count: 1 }
                },
            ),
            update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
                const { direction: _direction, ...rest } = data
                lead = { ...(lead as Lead), ...rest } as Lead
                return { ...lead }
            }),
            create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
                ...BASE_LEAD,
                ...data,
                id: 'new-lead',
                convertedUser: null,
            })),
            findMany: jest.fn(async () => (lead ? [{ ...lead }] : [])),
            count: jest.fn().mockResolvedValue(2),
        },
        subscription: {
            findMany: jest.fn(async () => (o.boughtUserIds ?? []).map((userId) => ({ userId }))),
        },
        user: {
            findMany: jest.fn().mockResolvedValue([
                { id: 'admin1', firstname: 'Ольга', lastname: 'Админ', email: 'o@x.ru' },
            ]),
        },
        workspaceMember: {
            findFirst: jest.fn(async () => (o.member ? { id: 'm1' } : null)),
            findMany: jest.fn().mockResolvedValue([{ userId: 'head1' }, { userId: 'admin1' }]),
        },
        direction: { findFirst: jest.fn().mockResolvedValue(null) },
        group: { findFirst: jest.fn(async () => o.group ?? null) },
        $transaction(fn: (tx: unknown) => unknown) {
            return fn(this)
        },
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const realtime = { invalidate: jest.fn() }
    const notifications = { notifyUser: jest.fn().mockResolvedValue(true) }
    const rbac = new RbacService(prisma as never)
    return { prisma, audit, realtime, notifications, rbac, current: () => lead }
}

type Who = { userId: string; roleName: string | null }
const ADMIN: Who = { userId: 'admin1', roleName: 'admin' }
const HEAD: Who = { userId: 'head1', roleName: 'head_coach' }
const OWNER_NO_ROW: Who = { userId: OWNER, roleName: null }
// A direction manager is a coach with DirectionManager rows: still a coach.
const COACH: Who = { userId: 'coach1', roleName: 'coach' }

const PD_PATTERN = /Анна|Смирнова|\+7952|anna@|Маша|субботу/

describe('leads handlers', () => {
    describe('authorization', () => {
        it.each([
            ['list', (db: ReturnType<typeof makeDb>, w: Who) =>
                new ListLeadsHandler(db.prisma as never, db.rbac).execute(
                    new ListLeadsFeature({}, WS, w.userId, w.roleName, false, NOW),
                )],
            ['get', (db: ReturnType<typeof makeDb>, w: Who) =>
                new GetLeadHandler(db.prisma as never, db.rbac).execute(
                    new GetLeadFeature(WS, LEAD_ID, w.userId, w.roleName, false),
                )],
            ['setStatus', (db: ReturnType<typeof makeDb>, w: Who) =>
                new SetLeadStatusHandler(db.prisma as never, db.rbac, db.audit as never, db.realtime as never, db.notifications as never).execute(
                    new SetLeadStatusFeature({ from: 'NEW', to: 'CONTACTED' }, WS, LEAD_ID, w.userId, w.roleName, false, NOW),
                )],
            ['erase', (db: ReturnType<typeof makeDb>, w: Who) =>
                new EraseLeadHandler(db.prisma as never, db.rbac, db.audit as never, db.realtime as never).execute(
                    new EraseLeadFeature(WS, LEAD_ID, w.userId, w.roleName, false, NOW),
                )],
            ['report', (db: ReturnType<typeof makeDb>, w: Who) =>
                new GetLeadConversionReportHandler(db.prisma as never, db.rbac).execute(
                    new GetLeadConversionReportFeature({}, WS, w.userId, w.roleName, false, NOW),
                )],
        ])('%s: a coach (or direction manager) is refused; the owner without a member row passes', async (_name, call) => {
            const refused = makeDb()
            await expect(call(refused, COACH)).rejects.toThrow(new ForbiddenError({ message: LEAD_SPORT_LEAD_ONLY }))
            expect(refused.prisma.lead.updateMany).not.toHaveBeenCalled()
            expect(refused.audit.record).not.toHaveBeenCalled()
            await expect(call(makeDb(), { userId: 'u1', roleName: 'user' })).rejects.toBeInstanceOf(ForbiddenError)

            await expect(call(makeDb(), OWNER_NO_ROW)).resolves.toBeDefined()
            await expect(call(makeDb(), HEAD)).resolves.toBeDefined()
        })
    })

    it('404s a lead of another club or none', async () => {
        const db = makeDb({ lead: null })
        await expect(
            new GetLeadHandler(db.prisma as never, db.rbac).execute(
                new GetLeadFeature(WS, LEAD_ID, ADMIN.userId, ADMIN.roleName, false),
            ),
        ).rejects.toBeInstanceOf(NotFoundError)
        expect(db.prisma.lead.findFirst.mock.calls[0][0].where).toEqual({ id: LEAD_ID, workspaceId: WS })
    })

    it('serializes BOUGHT for a linked member with a paid abonement', async () => {
        const db = makeDb({ lead: { status: 'CAME', convertedUserId: 'u1' }, boughtUserIds: ['u1'] })
        const out = await new GetLeadHandler(db.prisma as never, db.rbac).execute(
            new GetLeadFeature(WS, LEAD_ID, ADMIN.userId, ADMIN.roleName, false),
        )
        expect(out).toMatchObject({ status: 'CAME', displayStatus: 'BOUGHT', timezone: 'Europe/Moscow' })
        expect(db.prisma.subscription.findMany.mock.calls[0][0].where).toMatchObject({
            workspaceId: WS,
            userId: { in: ['u1'] },
            amountPaid: { gt: 0 },
            plan: { isFreeTrial: false },
        })
    })

    describe('listLeads', () => {
        it('defaults to needs action, oldest first, with counts and the form state', async () => {
            const db = makeDb()
            const out = await new ListLeadsHandler(db.prisma as never, db.rbac).execute(
                new ListLeadsFeature({}, WS, ADMIN.userId, ADMIN.roleName, false, NOW),
            )
            const args = db.prisma.lead.findMany.mock.calls[0][0]
            expect(args.where.AND[1]).toEqual(leadViewWhere('needsAction', WS, NOW))
            expect(args.orderBy).toEqual([{ statusChangedAt: 'asc' }, { id: 'asc' }])
            expect(out.counts.needsAction).toBe(out.counts.new + out.counts.trialOverdue)
            expect(out).toMatchObject({ total: 2, formEnabled: true, timezone: 'Europe/Moscow' })
            expect(out.data[0]).toMatchObject({ id: LEAD_ID, needsAction: true })
        })

        it('hides anonymised leads outside lost and all; searches name and phone digits', async () => {
            expect(leadViewWhere('new', WS, NOW)).toMatchObject({ anonymizedAt: null, status: 'NEW' })
            expect(leadViewWhere('lost', WS, NOW)).not.toHaveProperty('anonymizedAt')
            expect(leadViewWhere('all', WS, NOW)).toEqual({})
            const db = makeDb()
            await new ListLeadsHandler(db.prisma as never, db.rbac).execute(
                new ListLeadsFeature({ view: 'all', q: '8 952 884', source: 'QR' }, WS, ADMIN.userId, ADMIN.roleName, false, NOW),
            )
            const where = db.prisma.lead.findMany.mock.calls[0][0].where
            expect(where.AND).toContainEqual({ source: 'QR' })
            expect(where.AND).toContainEqual({
                OR: [
                    { name: { contains: '8 952 884', mode: 'insensitive' } },
                    { phone: { contains: '8952884' } },
                ],
            })
            expect(db.prisma.lead.findMany.mock.calls[0][0].orderBy).toEqual([
                { statusChangedAt: 'desc' },
                { id: 'asc' },
            ])
        })
    })

    describe('createLead', () => {
        const input = {
            name: 'Анна Смирнова',
            phone: '8 (952) 884-94-20',
            forChild: false,
            consentConfirmed: true as const,
        }
        const run = (db: ReturnType<typeof makeDb>, payload: Record<string, unknown> = input) =>
            new CreateLeadHandler(db.prisma as never, db.rbac, db.audit as never, db.realtime as never, db.notifications as never).execute(
                new CreateLeadFeature(payload as never, WS, ADMIN.userId, ADMIN.roleName, false),
            )

        it('records the attesting staff member and the consent edition; no PD in audit or push', async () => {
            const db = makeDb()
            const out = await run(db)
            expect(db.prisma.lead.create.mock.calls[0][0].data).toMatchObject({
                workspaceId: WS,
                source: 'MANUAL',
                phone: '+79528849420',
                consentVersion: LEAD_CONSENT_VERSION,
                consentRecordedById: 'admin1',
                createdById: 'admin1',
            })
            expect(out.consentRecordedByName).toBe('Ольга Админ')
            expect(db.audit.record.mock.calls[0][0]).toEqual({
                action: 'lead.create',
                targetType: 'lead',
                targetId: 'new-lead',
                workspaceId: WS,
                actorId: 'admin1',
                metadata: { leadSource: 'MANUAL' },
            })
            expect(db.realtime.invalidate).toHaveBeenCalledWith(WS, ['leads'])
            // The owner and the head coach hear about it; the creator doesn't.
            const recipients = db.notifications.notifyUser.mock.calls.map((c) => c[0].userId).sort()
            expect(recipients).toEqual(['head1', 'owner'])
            expect(JSON.stringify(db.notifications.notifyUser.mock.calls)).not.toMatch(PD_PATTERN)
        })

        it('answers 409 with the open lead of the same phone', async () => {
            const db = makeDb({ duplicateId: 'dup-1' })
            const err = await run(db).catch((e: unknown) => e)
            expect(err).toBeInstanceOf(LeadDuplicateError)
            expect(err).toMatchObject({ statusCode: 409, metadata: { leadId: 'dup-1' } })
            expect(db.prisma.lead.create).not.toHaveBeenCalled()
        })

        it('refuses a bad phone, and the schema needs consent and a child block', async () => {
            await expect(run(makeDb(), { ...input, phone: '12345' })).rejects.toBeInstanceOf(BadRequestError)
            expect(CreateLeadInputSchema.safeParse({ ...input, consentConfirmed: false }).success).toBe(false)
            expect(CreateLeadInputSchema.safeParse({ ...input, forChild: true }).success).toBe(false)
            expect(
                CreateLeadInputSchema.safeParse({ ...input, forChild: true, childName: 'Маша', childAge: 8 }).success,
            ).toBe(true)
        })
    })

    describe('updateLead', () => {
        const run = (db: ReturnType<typeof makeDb>, payload: Record<string, unknown>) =>
            new UpdateLeadHandler(db.prisma as never, db.rbac, db.audit as never, db.realtime as never).execute(
                new UpdateLeadFeature(payload as never, WS, LEAD_ID, ADMIN.userId, ADMIN.roleName, false),
            )

        it('saves the note and contact, auditing field names only', async () => {
            const db = makeDb()
            const out = await run(db, { name: 'Анна С.', staffNote: 'перезвонить вечером', expectedUpdatedAt: STORED_AT.toISOString() })
            expect(out).toMatchObject({ name: 'Анна С.', staffNote: 'перезвонить вечером' })
            expect(db.audit.record.mock.calls[0][0].metadata).toEqual({ fields: ['personName', 'staffNote'] })
        })

        it('refuses a stale form and an anonymised lead', async () => {
            await expect(
                run(makeDb(), { staffNote: 'x', expectedUpdatedAt: '2026-12-01T00:00:00.000Z' }),
            ).rejects.toBeInstanceOf(StaleUpdateError)
            await expect(run(makeDb({ lead: { anonymizedAt: NOW } }), { staffNote: 'x' })).rejects.toBeInstanceOf(
                BadRequestError,
            )
        })
    })

    describe('setLeadStatus', () => {
        const run = (db: ReturnType<typeof makeDb>, payload: Record<string, unknown>) =>
            new SetLeadStatusHandler(db.prisma as never, db.rbac, db.audit as never, db.realtime as never, db.notifications as never).execute(
                new SetLeadStatusFeature(payload as never, WS, LEAD_ID, ADMIN.userId, ADMIN.roleName, false, NOW),
            )

        it('moves on a matching `from` and stamps it', async () => {
            const db = makeDb()
            const out = await run(db, { from: 'NEW', to: 'CONTACTED' })
            expect(db.current()).toMatchObject({ status: 'CONTACTED', contactedAt: NOW, statusChangedAt: NOW })
            expect(out.status).toBe('CONTACTED')
            expect(db.audit.record.mock.calls[0][0].metadata).toEqual({ fromStatus: 'NEW', toStatus: 'CONTACTED' })
        })

        it('stamps the first contact once: a booking from NEW sets it, «Вернуть в работу» keeps it', async () => {
            const booked = makeDb()
            await run(booked, { from: 'NEW', to: 'TRIAL_BOOKED', trialAt: '2026-12-12T18:00' })
            expect(booked.current()).toMatchObject({ contactedAt: NOW, trialBookedAt: NOW })

            const first = new Date('2026-11-20T10:00:00Z')
            const reopened = makeDb({
                lead: { status: 'LOST', contactedAt: first, lostAt: STORED_AT, lostReason: 'PRICE' },
            })
            await run(reopened, { from: 'LOST', to: 'CONTACTED' })
            expect(reopened.current()).toMatchObject({
                status: 'CONTACTED',
                contactedAt: first,
                lostAt: null,
                lostReason: null,
            })
        })

        it('shows the trial in the zone it was booked in: the group gym, else the club', async () => {
            const group = { id: 'g1', name: 'Дети', coachId: 'coach9', gym: { timezone: 'Asia/Novosibirsk' } }
            const db = makeDb({ group })
            // The fake doesn't follow the relation: give the stored row its gym.
            db.prisma.lead.findFirstOrThrow.mockImplementationOnce(async () => ({
                ...db.current(),
                trialGroup: { gym: { timezone: 'Asia/Novosibirsk' } },
            }))
            const out = await run(db, { from: 'NEW', to: 'TRIAL_BOOKED', trialAt: '2026-12-12T18:00', trialGroupId: 'g1' })
            expect(out).toMatchObject({
                trialAt: '2026-12-12T11:00:00.000Z',
                trialTimezone: 'Asia/Novosibirsk',
                timezone: 'Europe/Moscow',
            })
            const noGroup = await run(makeDb(), { from: 'NEW', to: 'TRIAL_BOOKED', trialAt: '2026-12-12T18:00' })
            expect(noGroup).toMatchObject({ trialAt: '2026-12-12T15:00:00.000Z', trialTimezone: 'Europe/Moscow' })
        })
        it('answers 409 when someone moved it first', async () => {
            const db = makeDb({ lead: { status: 'CONTACTED' } })
            await expect(run(db, { from: 'NEW', to: 'CONTACTED' })).rejects.toThrow(
                new ConflictError({ message: LEAD_STATUS_CHANGED }),
            )
            expect(db.audit.record).not.toHaveBeenCalled()
        })

        it('refuses a backward move, a trial without a time and «Другое» without a comment', async () => {
            await expect(run(makeDb({ lead: { status: 'CAME' } }), { from: 'CAME', to: 'NEW' })).rejects.toThrow(LEAD_MOVE_REFUSED)
            await expect(run(makeDb(), { from: 'NEW', to: 'TRIAL_BOOKED' })).rejects.toThrow(LEAD_TRIAL_AT_REQUIRED)
            await expect(run(makeDb(), { from: 'NEW', to: 'LOST', lostReason: 'OTHER' })).rejects.toThrow(
                LEAD_LOST_COMMENT_REQUIRED,
            )
            await expect(run(makeDb(), { from: 'NEW', to: 'LOST' })).rejects.toBeInstanceOf(BadRequestError)
            await expect(run(makeDb({ lead: { anonymizedAt: NOW } }), { from: 'NEW', to: 'CONTACTED' })).rejects.toBeInstanceOf(
                BadRequestError,
            )
        })

        it('erases a spam lead in the same write', async () => {
            const db = makeDb()
            await run(db, { from: 'NEW', to: 'LOST', lostReason: 'SPAM' })
            expect(db.current()).toMatchObject({
                status: 'LOST',
                lostReason: 'SPAM',
                name: null,
                phone: null,
                email: null,
                comment: null,
                anonymizedAt: NOW,
            })
            expect(db.audit.record.mock.calls[0][0].metadata).toEqual({
                fromStatus: 'NEW',
                toStatus: 'LOST',
                lostReason: 'SPAM',
            })
        })

        it('books a trial in the gym zone and heads up only the group coach, without PD', async () => {
            const group = { id: 'g1', name: 'Дети 6–9', coachId: 'coach9', gym: { timezone: 'Asia/Novosibirsk' } }
            const db = makeDb({ group })
            await run(db, {
                from: 'NEW',
                to: 'TRIAL_BOOKED',
                trialAt: '2026-12-12T18:00',
                trialGroupId: 'g1',
                notifyCoach: true,
            })
            expect(db.current()).toMatchObject({
                status: 'TRIAL_BOOKED',
                // 18:00 in Novosibirsk (UTC+7).
                trialAt: new Date('2026-12-12T11:00:00Z'),
                trialGroupId: 'g1',
                trialGroupName: 'Дети 6–9',
            })
            expect(db.notifications.notifyUser).toHaveBeenCalledTimes(1)
            const push = db.notifications.notifyUser.mock.calls[0][0]
            expect(push).toMatchObject({
                userId: 'coach9',
                kind: 'lead.trialBooked',
                topic: 'На пробное придёт новый человек',
                message: 'сб, 12 дек., 18:00 · «Дети 6–9»',
            })
            expect(JSON.stringify(push)).not.toMatch(PD_PATTERN)
        })

        it('sends no heads-up without notifyCoach, and refuses another club\'s group', async () => {
            const group = { id: 'g1', name: 'Дети', coachId: 'coach9', gym: null }
            const quiet = makeDb({ group })
            await run(quiet, { from: 'NEW', to: 'TRIAL_BOOKED', trialAt: '2026-12-12T18:00', trialGroupId: 'g1' })
            expect(quiet.notifications.notifyUser).not.toHaveBeenCalled()
            await expect(
                run(makeDb(), { from: 'NEW', to: 'TRIAL_BOOKED', trialAt: '2026-12-12T18:00', trialGroupId: 'g2' }),
            ).rejects.toBeInstanceOf(BadRequestError)
        })
    })

    describe('linkLeadMember', () => {
        const run = (db: ReturnType<typeof makeDb>, userId = 'u1') =>
            new LinkLeadMemberHandler(db.prisma as never, db.rbac, db.audit as never, db.realtime as never).execute(
                new LinkLeadMemberFeature({ userId }, WS, LEAD_ID, ADMIN.userId, ADMIN.roleName, false, NOW),
            )

        it('links an active student and moves the lead to CAME', async () => {
            const db = makeDb({ member: true, lead: { status: 'TRIAL_BOOKED' } })
            const out = await run(db)
            expect(db.prisma.workspaceMember.findFirst.mock.calls[0][0].where).toEqual({
                workspaceId: WS,
                userId: 'u1',
                status: 'ACTIVE',
                role: { name: 'user' },
            })
            expect(db.current()).toMatchObject({
                convertedUserId: 'u1',
                convertedAt: NOW,
                status: 'CAME',
                cameAt: NOW,
                // Never contacted before: linking is the club's reaction.
                contactedAt: NOW,
            })
            const earlier = new Date('2026-12-01T08:00:00Z')
            const kept = makeDb({ member: true, lead: { status: 'CONTACTED', contactedAt: earlier } })
            await run(kept)
            expect(kept.current()?.contactedAt).toEqual(earlier)
            expect(out.displayStatus).toBe('CAME')
            expect(db.audit.record.mock.calls[0][0].metadata).toEqual({ userId: 'u1' })
        })

        it('refuses another club\'s person or a staff member', async () => {
            const db = makeDb({ member: false })
            await expect(run(db)).rejects.toThrow(LEAD_LINK_NOT_STUDENT)
            expect(db.prisma.lead.updateMany).not.toHaveBeenCalled()
        })

        it('is idempotent for the same user and 409 for a different one', async () => {
            const same = makeDb({ member: true, lead: { status: 'CAME', convertedUserId: 'u1' } })
            await run(same)
            expect(same.prisma.lead.updateMany).not.toHaveBeenCalled()
            expect(same.audit.record).not.toHaveBeenCalled()
            await expect(run(makeDb({ member: true, lead: { convertedUserId: 'u2' } }))).rejects.toThrow(
                new ConflictError({ message: LEAD_LINKED_ELSEWHERE }),
            )
        })
    })

    describe('eraseLead', () => {
        const run = (db: ReturnType<typeof makeDb>) =>
            new EraseLeadHandler(db.prisma as never, db.rbac, db.audit as never, db.realtime as never).execute(
                new EraseLeadFeature(WS, LEAD_ID, ADMIN.userId, ADMIN.roleName, false, NOW),
            )

        it('blanks the personal data now and audits without it', async () => {
            const db = makeDb()
            const out = await run(db)
            expect(out).toMatchObject({ name: null, phone: null, email: null, childName: null, comment: null, anonymizedAt: NOW.toISOString() })
            expect(out.source).toBe('PUBLIC_PAGE')
            expect(db.audit.record.mock.calls[0][0]).toMatchObject({ action: 'lead.erase', metadata: {} })
        })

        it('answers an erased lead as it is', async () => {
            const db = makeDb({ lead: { anonymizedAt: NOW, name: null, phone: null } })
            await run(db)
            expect(db.prisma.lead.update).not.toHaveBeenCalled()
            expect(db.audit.record).not.toHaveBeenCalled()
        })
    })

    it('reports the last 30 club-local days by default', async () => {
        const db = makeDb()
        db.prisma.lead.findMany.mockResolvedValueOnce([])
        const out = await new GetLeadConversionReportHandler(db.prisma as never, db.rbac).execute(
            new GetLeadConversionReportFeature({}, WS, ADMIN.userId, ADMIN.roleName, false, NOW),
        )
        expect(out).toMatchObject({ from: '2026-11-11', to: '2026-12-10' })
        expect(out.bySource.map((s) => s.source)).toEqual(['PUBLIC_PAGE', 'QR', 'MANUAL'])
        expect(db.prisma.lead.findMany.mock.calls[0][0].where.createdAt).toEqual({
            gte: new Date('2026-11-10T21:00:00.000Z'),
            lte: new Date('2026-12-10T20:59:59.999Z'),
        })
    })

    it('builds the poster link with ?src=qr, or names what is missing', async () => {
        const db = makeDb()
        const handler = new GetTrialLinkHandler(db.prisma as never, db.rbac)
        const run = () => handler.execute(new GetTrialLinkFeature(WS, ADMIN.userId, ADMIN.roleName, false))
        expect(await run()).toEqual({
            url: 'https://app.club.example/c/akademiya/trial?src=qr',
            qrPngDataUrl: 'data:image/png;qr,https://app.club.example/c/akademiya/trial?src=qr',
            missing: null,
        })
        db.prisma.workspace.findUnique.mockResolvedValue({ ...CLUB, trialRequestsEnabled: false })
        expect(await run()).toMatchObject({ missing: 'disabled', qrPngDataUrl: null })
        db.prisma.workspace.findUnique.mockResolvedValue({ ...CLUB, trialRequestsEnabled: false, pdOperatorName: null })
        expect(await run()).toMatchObject({ missing: 'operator' })
    })
})
