import {
    BadRequestError,
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { AddMyDependentHandler } from './add-my-dependent.handler'
import { ConfirmMyDependentHandler } from './confirm-my-dependent.handler'
import { DeleteMyDependentHandler } from './delete-my-dependent.handler'
import { GUARDIAN_CONSENT_VERSION } from './dependents-utils'
import { ListMyDependentsHandler } from './list-my-dependents.handler'
import {
    AddMyDependentFeature,
    ConfirmMyDependentFeature,
    DeleteMyDependentFeature,
    ListMyDependentsFeature,
    UnlinkMyDependentFeature,
    UpdateMyDependentFeature,
} from './my-dependents.feature'
import { UnlinkMyDependentHandler } from './unlink-my-dependent.handler'
import { UpdateMyDependentHandler } from './update-my-dependent.handler'

const CONSENTED = new Date('2026-11-01T10:00:00Z')

// A guardianship row as myDependentSelect (+ id) returns it.
const linkRow = (over: Record<string, unknown> = {}) => ({
    id: 'link1',
    relation: 'PARENT' as const,
    consentAt: CONSENTED as Date | null,
    consentVersion: GUARDIAN_CONSENT_VERSION as string | null,
    invitedByWorkspace: null as { id: string; name: string } | null,
    dependent: {
        id: 'kid',
        firstname: 'Миша',
        lastname: 'Иванов',
        dateOfBirth: new Date('2018-05-04T00:00:00Z'),
        workspaceMemberships: [{ workspace: { id: 'w1', name: 'Клуб' } }],
    },
    ...over,
})
const pendingRow = () =>
    linkRow({
        consentAt: null,
        consentVersion: null,
        invitedByWorkspace: { id: 'w1', name: 'Клуб' },
    })

const makeAudit = () => ({ record: jest.fn().mockResolvedValue(undefined) })
const makeRealtime = () => ({ invalidate: jest.fn() })

describe('ListMyDependentsHandler', () => {
    it("lists the caller's own live children, confirmed and pending", async () => {
        const prisma = {
            guardianship: {
                findMany: jest.fn().mockResolvedValue([linkRow(), pendingRow()]),
            },
        }
        const res = await new ListMyDependentsHandler(prisma as never).execute(
            new ListMyDependentsFeature('g1'),
        )
        expect(prisma.guardianship.findMany.mock.calls[0][0].where).toEqual({
            guardianId: 'g1',
            dependent: { status: 'ACTIVE' },
        })
        expect(res.data).toEqual([
            {
                id: 'kid',
                firstname: 'Миша',
                lastname: 'Иванов',
                dateOfBirth: '2018-05-04',
                relation: 'PARENT',
                status: 'ACTIVE',
                consentAt: CONSENTED.toISOString(),
                consentVersion: GUARDIAN_CONSENT_VERSION,
                invitedBy: null,
                clubs: [{ workspaceId: 'w1', name: 'Клуб' }],
            },
            expect.objectContaining({
                status: 'PENDING',
                consentAt: null,
                invitedBy: { workspaceId: 'w1', name: 'Клуб' },
            }),
        ])
    })
})

describe('AddMyDependentHandler', () => {
    const payload = {
        firstname: 'Миша',
        dateOfBirth: '2018-05-04',
        relation: 'PARENT' as const,
        consent: true as const,
    }
    const build = (o: { guardian?: unknown; count?: number } = {}) => {
        const tx = {
            user: { create: jest.fn().mockResolvedValue({ id: 'kid' }) },
            guardianship: {
                create: jest.fn().mockResolvedValue(
                    linkRow({
                        dependent: {
                            ...linkRow().dependent,
                            lastname: null,
                            workspaceMemberships: [],
                        },
                    }),
                ),
            },
            consentRecord: { create: jest.fn().mockResolvedValue({}) },
        }
        const prisma = {
            user: {
                findUnique: jest
                    .fn()
                    .mockResolvedValue(
                        o.guardian === undefined
                            ? { email: 'mom@x.io', language: 'RU' }
                            : o.guardian,
                    ),
            },
            guardianship: { count: jest.fn().mockResolvedValue(o.count ?? 0) },
            $transaction: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
        }
        const audit = makeAudit()
        const handler = new AddMyDependentHandler(prisma as never, audit as never)
        return { handler, prisma, tx, audit }
    }

    it('creates a login-less child and a confirmed link carrying the consent', async () => {
        const { handler, tx, audit } = build()
        const res = await handler.execute(
            new AddMyDependentFeature(payload, 'g1', '10.0.0.1', 'ClubSpace/1.0'),
        )

        expect(tx.user.create.mock.calls[0][0].data).toEqual({
            email: null,
            status: 'ACTIVE',
            language: 'RU',
            firstname: 'Миша',
            lastname: null,
            dateOfBirth: new Date('2018-05-04T00:00:00.000Z'),
        })
        const link = tx.guardianship.create.mock.calls[0][0].data
        expect(link).toEqual({
            guardianId: 'g1',
            dependentId: 'kid',
            relation: 'PARENT',
            consentAt: expect.any(Date),
            consentVersion: GUARDIAN_CONSENT_VERSION,
        })
        // Evidence in the consent log, next to the personal-data consent.
        expect(tx.consentRecord.create.mock.calls[0][0].data).toEqual({
            userId: 'g1',
            kind: 'DEPENDENT_DATA',
            dependentId: 'kid',
            version: GUARDIAN_CONSENT_VERSION,
            ip: '10.0.0.1',
            userAgent: 'ClubSpace/1.0',
        })
        expect(res).toEqual(
            expect.objectContaining({ id: 'kid', status: 'ACTIVE', clubs: [] }),
        )
        expect(audit.record).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'guardian.addDependent',
                targetId: 'kid',
                actorId: 'g1',
            }),
        )
    })

    it('refuses a child profile adding children', async () => {
        const { handler, prisma } = build({
            guardian: { email: null, language: 'RU' },
        })
        await expect(
            handler.execute(new AddMyDependentFeature(payload, 'kid')),
        ).rejects.toBeInstanceOf(BadRequestError)
        expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('refuses an unknown caller', async () => {
        const { handler } = build({ guardian: null })
        await expect(
            handler.execute(new AddMyDependentFeature(payload, 'ghost')),
        ).rejects.toBeInstanceOf(NotFoundError)
    })

    it('stops at the per-guardian ceiling', async () => {
        const { handler, prisma } = build({ count: 10 })
        await expect(
            handler.execute(new AddMyDependentFeature(payload, 'g1')),
        ).rejects.toBeInstanceOf(BadRequestError)
        expect(prisma.$transaction).not.toHaveBeenCalled()
    })
})

// Prisma with one guardianship lookup (loadMyDependentLink) and the writes.
const linkPrisma = (link: unknown) => ({
    guardianship: {
        findFirst: jest.fn().mockResolvedValue(link),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        delete: jest.fn().mockResolvedValue({}),
    },
    user: {
        update: jest.fn(),
    },
    consentRecord: {
        create: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
})

describe('ConfirmMyDependentHandler', () => {
    const build = (link: unknown) => {
        const prisma = linkPrisma(link)
        const audit = makeAudit()
        const realtime = makeRealtime()
        const handler = new ConfirmMyDependentHandler(
            prisma as never,
            audit as never,
            realtime as never,
        )
        return { handler, prisma, audit, realtime }
    }
    const confirm = (guardianId = 'g1') =>
        new ConfirmMyDependentFeature({ consent: true }, guardianId, 'kid')

    it("treats someone else's child as not found", async () => {
        const { handler, prisma } = build(null)
        await expect(handler.execute(confirm('stranger'))).rejects.toBeInstanceOf(
            NotFoundError,
        )
        expect(prisma.guardianship.findFirst.mock.calls[0][0].where).toEqual({
            guardianId: 'stranger',
            dependentId: 'kid',
            dependent: { status: 'ACTIVE' },
        })
        expect(prisma.guardianship.updateMany).not.toHaveBeenCalled()
    })

    it('records the consent on a pending link and refreshes the club roster', async () => {
        const { handler, prisma, audit, realtime } = build(pendingRow())
        prisma.guardianship.findUniqueOrThrow.mockResolvedValue(
            linkRow({ invitedByWorkspace: { id: 'w1', name: 'Клуб' } }),
        )
        const res = await handler.execute(confirm())

        expect(prisma.guardianship.updateMany).toHaveBeenCalledWith({
            where: { id: 'link1', consentAt: null },
            data: {
                consentAt: expect.any(Date),
                consentVersion: GUARDIAN_CONSENT_VERSION,
            },
        })
        expect(res.status).toBe('ACTIVE')
        expect(prisma.consentRecord.create.mock.calls[0][0].data).toEqual(
            expect.objectContaining({
                userId: 'g1',
                kind: 'DEPENDENT_DATA',
                dependentId: 'kid',
            }),
        )
        expect(audit.record).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'guardian.confirmDependent',
                workspaceId: 'w1',
                actorId: 'g1',
            }),
        )
        expect(realtime.invalidate).toHaveBeenCalledWith('w1', ['members'])
    })

    it('keeps the first consent when confirmed again', async () => {
        const { handler, prisma } = build(linkRow())
        const res = await handler.execute(confirm())
        expect(prisma.guardianship.updateMany).not.toHaveBeenCalled()
        expect(res.consentAt).toBe(CONSENTED.toISOString())
    })
})

describe('UpdateMyDependentHandler', () => {
    const update = new UpdateMyDependentFeature(
        { firstname: 'Михаил', dateOfBirth: '2018-05-05' },
        'g1',
        'kid',
    )

    it("treats someone else's child as not found", async () => {
        const prisma = linkPrisma(null)
        await expect(
            new UpdateMyDependentHandler(prisma as never).execute(update),
        ).rejects.toBeInstanceOf(NotFoundError)
        expect(prisma.user.update).not.toHaveBeenCalled()
    })

    it('refuses while the link is still pending', async () => {
        const prisma = linkPrisma(pendingRow())
        await expect(
            new UpdateMyDependentHandler(prisma as never).execute(update),
        ).rejects.toBeInstanceOf(ForbiddenError)
    })

    it('updates only the fields sent', async () => {
        const prisma = linkPrisma(linkRow())
        prisma.user.update.mockResolvedValue({
            firstname: 'Михаил',
            lastname: 'Иванов',
            dateOfBirth: new Date('2018-05-05T00:00:00Z'),
        })
        const res = await new UpdateMyDependentHandler(prisma as never).execute(
            update,
        )
        expect(prisma.user.update.mock.calls[0][0]).toEqual(
            expect.objectContaining({
                where: { id: 'kid' },
                data: {
                    firstname: 'Михаил',
                    dateOfBirth: new Date('2018-05-05T00:00:00.000Z'),
                },
            }),
        )
        expect(res.firstname).toBe('Михаил')
        expect(res.dateOfBirth).toBe('2018-05-05')
    })
})

describe('UnlinkMyDependentHandler', () => {
    const build = (link: unknown, otherGuardians = 0) => {
        const prisma = linkPrisma(link)
        prisma.guardianship.count.mockResolvedValue(otherGuardians)
        const audit = makeAudit()
        const realtime = makeRealtime()
        const handler = new UnlinkMyDependentHandler(
            prisma as never,
            audit as never,
            realtime as never,
        )
        return { handler, prisma, audit, realtime }
    }
    const unlink = new UnlinkMyDependentFeature('g1', 'kid')

    it("treats someone else's child as not found", async () => {
        const { handler, prisma } = build(null)
        await expect(handler.execute(unlink)).rejects.toBeInstanceOf(NotFoundError)
        expect(prisma.guardianship.delete).not.toHaveBeenCalled()
    })

    it('declines a pending club invitation', async () => {
        const { handler, prisma } = build(pendingRow())
        await expect(handler.execute(unlink)).resolves.toEqual({
            status: 'unlinked',
        })
        expect(prisma.guardianship.count).not.toHaveBeenCalled()
        expect(prisma.guardianship.delete).toHaveBeenCalledWith({
            where: { id: 'link1' },
        })
    })

    it('refuses the last confirmed guardian (delete the profile instead)', async () => {
        const { handler, prisma } = build(linkRow(), 0)
        await expect(handler.execute(unlink)).rejects.toBeInstanceOf(
            BadRequestError,
        )
        expect(prisma.guardianship.count.mock.calls[0][0].where).toEqual({
            dependentId: 'kid',
            guardianId: { not: 'g1' },
            consentAt: { not: null },
            guardian: { status: 'ACTIVE' },
        })
        expect(prisma.guardianship.delete).not.toHaveBeenCalled()
    })

    it('lets a guardian step back while another confirmed one remains', async () => {
        const { handler, prisma, audit, realtime } = build(linkRow(), 1)
        await expect(handler.execute(unlink)).resolves.toEqual({
            status: 'unlinked',
        })
        expect(prisma.guardianship.delete).toHaveBeenCalled()
        // Stepping back withdraws this guardian's consent for the child.
        expect(prisma.consentRecord.updateMany).toHaveBeenCalledWith({
            where: {
                userId: 'g1',
                dependentId: 'kid',
                kind: 'DEPENDENT_DATA',
                withdrawnAt: null,
            },
            data: { withdrawnAt: expect.any(Date), ip: null, userAgent: null },
        })
        expect(audit.record).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'guardian.unlinkDependent' }),
        )
        expect(realtime.invalidate).toHaveBeenCalledWith('w1', ['members'])
    })
})

describe('DeleteMyDependentHandler', () => {
    const build = (link: unknown) => {
        const prisma = linkPrisma(link)
        const users = { deleteAccount: jest.fn().mockResolvedValue(undefined) }
        const audit = makeAudit()
        const realtime = makeRealtime()
        const handler = new DeleteMyDependentHandler(
            prisma as never,
            users as never,
            audit as never,
            realtime as never,
        )
        return { handler, users, audit, realtime }
    }
    const remove = new DeleteMyDependentFeature('g1', 'kid')

    it("treats someone else's child as not found", async () => {
        const { handler, users } = build(null)
        await expect(handler.execute(remove)).rejects.toBeInstanceOf(NotFoundError)
        expect(users.deleteAccount).not.toHaveBeenCalled()
    })

    it('refuses on a pending invitation', async () => {
        const { handler, users } = build(pendingRow())
        await expect(handler.execute(remove)).rejects.toBeInstanceOf(
            ForbiddenError,
        )
        expect(users.deleteAccount).not.toHaveBeenCalled()
    })

    it('deletes the child by the account-deletion rules', async () => {
        const { handler, users, audit, realtime } = build(linkRow())
        await expect(handler.execute(remove)).resolves.toEqual({
            status: 'deleted',
        })
        expect(users.deleteAccount).toHaveBeenCalledWith('kid')
        expect(audit.record).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'guardian.deleteDependent',
                targetId: 'kid',
                actorId: 'g1',
            }),
        )
        expect(realtime.invalidate).toHaveBeenCalledWith('w1', ['members'])
    })
})
