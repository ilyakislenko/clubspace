jest.mock('../../environments/environment', () => ({
    environment: {
        encryptionKey: 'unit-secret',
        rootUrl: 'https://api.example',
        appUrl: 'https://app.example',
    },
}))

import { ClubMessageDeliveryService, loadEmailTargets, planPush } from './deliver'

const NOW = new Date('2026-11-26T05:00:00Z') // 12:00 in Tomsk
const WS = { id: 'w1', name: 'Клуб', ownerId: 'owner', timezone: 'Asia/Tomsk', messagesEmailEnabled: true }

type World = {
    // Students the segment resolves to.
    students: string[]
    // child → guardians (confirmed).
    guardians?: Record<string, string[]>
    childNames?: Record<string, string>
    optedOut?: string[]
    muted?: string[]
    devices?: string[]
    // userId → today's broadcast pushes already received.
    pushesToday?: Record<string, number>
    emails?: Record<string, string>
    emailOptOut?: string[]
}

const buildPrisma = (w: World, message: Record<string, unknown> = {}) => {
    const guardians = w.guardians ?? {}
    const msg = {
        id: 'm1',
        authorId: 'owner',
        segment: 'ALL',
        directionId: null,
        groupIds: [],
        memberIds: [],
        isDirect: false,
        isService: false,
        urgent: false,
        withEmail: false,
        title: 'Сбор',
        body: 'Тренировка переносится',
        ...message,
        workspace: { ...WS, ...((message.workspace as object) ?? {}) },
    }
    const inIds = (where: { userId?: { in?: string[] }; id?: { in?: string[] } }) =>
        new Set(where.userId?.in ?? where.id?.in ?? [])
    const prisma = {
        clubMessage: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            findUniqueOrThrow: jest.fn().mockResolvedValue(msg),
            update: jest.fn().mockResolvedValue({}),
        },
        clubMessageRecipient: {
            createMany: jest.fn().mockResolvedValue({ count: 0 }),
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            groupBy: jest.fn(async ({ where }: { where: { userId: { in: string[] } } }) =>
                where.userId.in
                    .filter((u) => (w.pushesToday?.[u] ?? 0) > 0)
                    .map((u) => ({ userId: u, _count: { _all: w.pushesToday?.[u] ?? 0 } })),
            ),
        },
        workspaceMember: {
            // The segment query, or planPush's muted query.
            findMany: jest.fn(async ({ where }: { where: { notificationsMuted?: boolean; userId?: { in: string[] } } }) =>
                where.notificationsMuted
                    ? (w.muted ?? []).filter((u) => inIds(where).has(u)).map((userId) => ({ userId }))
                    : w.students.map((userId) => ({ userId })),
            ),
        },
        guardianship: {
            findMany: jest.fn(async ({ where }: { where: { dependentId: { in: string[] } } }) =>
                where.dependentId.in.flatMap((d) =>
                    (guardians[d] ?? []).map((g) => ({
                        dependentId: d,
                        guardianId: g,
                        dependent: { firstname: w.childNames?.[d] ?? 'Миша' },
                    })),
                ),
            ),
        },
        notificationPreferences: {
            findMany: jest.fn(async ({ where }: { where: { userId: { in: string[] } } }) =>
                (w.optedOut ?? []).filter((u) => where.userId.in.includes(u)).map((userId) => ({ userId })),
            ),
        },
        user: {
            // planPush's device query (OR) or the e-mail targets.
            findMany: jest.fn(async ({ where }: { where: { OR?: unknown; id: { in: string[] } } }) => {
                const ids = where.id.in
                if (where.OR) return (w.devices ?? []).filter((u) => ids.includes(u)).map((id) => ({ id }))
                return ids
                    .filter((u) => w.emails?.[u])
                    .map((id) => ({
                        id,
                        email: w.emails?.[id],
                        notificationPreferences: (w.emailOptOut ?? []).includes(id)
                            ? { clubMessagesEmailEnabled: false }
                            : null,
                    }))
            }),
            findUnique: jest.fn().mockResolvedValue(null),
        },
        group: { findMany: jest.fn().mockResolvedValue([]) },
        memberRetentionContact: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
        $executeRaw: jest.fn().mockResolvedValue(1),
    }
    // The recipients transaction runs on the same mock.
    return Object.assign(prisma, {
        $transaction: jest.fn(async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma)),
    })
}

const buildService = (prisma: ReturnType<typeof buildPrisma>, emailsLeft = Infinity) => {
    let left = emailsLeft
    const producer = { writeMany: jest.fn(async (rows: unknown[]) => rows.length) }
    const notifications = { sendNotification: jest.fn().mockResolvedValue('n1') }
    const templates = { getTemplate: jest.fn(async ({ data }: { data: { title: string } }) => ({ content: `<p>${data.title}</p>` })) }
    const trialLimits = {
        consumeTrialEmail: jest.fn(async () => {
            if (left <= 0) return false
            left -= 1
            return true
        }),
    }
    const realtime = {
        invalidateUsersInWorkspace: jest.fn(),
        invalidateUsers: jest.fn(),
        invalidateCoalesced: jest.fn(),
    }
    const callLists = { invalidate: jest.fn().mockResolvedValue(undefined) }
    const svc = new ClubMessageDeliveryService(
        prisma as never,
        producer as never,
        notifications as never,
        templates as never,
        trialLimits as never,
        realtime as never,
        callLists as never,
    )
    return { svc, producer, notifications, templates, trialLimits, realtime, callLists }
}

const recipientRows = (prisma: ReturnType<typeof buildPrisma>) =>
    prisma.clubMessageRecipient.createMany.mock.calls.flatMap((c) => c[0].data) as Array<{
        userId: string
        pushSkip: string | null
    }>
const skipOf = (prisma: ReturnType<typeof buildPrisma>) =>
    Object.fromEntries(recipientRows(prisma).map((r) => [r.userId, r.pushSkip]))

// A club with every kind of recipient: s1 has the app, s2 doesn't, kid's
// mother has it, s3 switched off «Сообщения клуба», s4 muted the club.
const MIXED: World = {
    students: ['s1', 's2', 'kid', 's3', 's4'],
    guardians: { kid: ['mom'] },
    optedOut: ['s3'],
    muted: ['s4'],
    devices: ['s1', 'mom', 's3', 's4'],
}

describe('planPush', () => {
    const plan = (w: World, kind: 'message.broadcast' | 'message.service' | 'message.direct') =>
        planPush(buildPrisma(w) as never, {
            workspaceId: 'w1',
            timezone: 'Asia/Tomsk',
            userIds: w.students,
            kind,
            now: NOW,
        })

    it('a broadcast stops at the switch and the mute; no device = in-app only', async () => {
        const { skip, routes } = await plan(MIXED, 'message.broadcast')
        expect(Object.fromEntries(skip)).toEqual({
            s1: null,
            s2: 'no_device',
            kid: null,
            s3: 'opted_out',
            s4: 'muted',
        })
        expect(routes.get('kid')).toEqual({ guardianIds: ['mom'], dependentName: 'Миша' })
    })

    it.each(['message.service', 'message.direct'] as const)(
        '%s passes the switch and the mute',
        async (kind) => {
            const { skip } = await plan(MIXED, kind)
            expect(skip.get('s3')).toBeNull()
            expect(skip.get('s4')).toBeNull()
        },
    )

    it("a child's broadcast follows the guardians' settings: all opted out → opted_out, all muted → muted", async () => {
        const w: World = { students: ['k1', 'k2', 'k3'], guardians: { k1: ['g1'], k2: ['g2'], k3: ['g3', 'g4'] }, optedOut: ['g1'], muted: ['g2', 'g3'], devices: ['g1', 'g2', 'g4'] }
        const { skip } = await plan(w, 'message.broadcast')
        expect(Object.fromEntries(skip)).toEqual({ k1: 'opted_out', k2: 'muted', k3: null })
    })

    it('caps a recipient who already got 3 broadcast pushes today; not service or direct', async () => {
        const w: World = { students: ['s1', 's2'], devices: ['s1', 's2'], pushesToday: { s1: 3, s2: 2 } }
        expect(Object.fromEntries((await plan(w, 'message.broadcast')).skip)).toEqual({ s1: 'cap', s2: null })
        expect((await plan(w, 'message.service')).skip.get('s1')).toBeNull()
    })
})

describe('loadEmailTargets', () => {
    it("goes to the recipient or a child's guardians with an address and the e-mail switch on; a muted member gets no broadcast copy", async () => {
        const w: World = {
            students: ['s1', 's2', 'kid', 's4', 's5'],
            guardians: { kid: ['mom', 'dad'] },
            emails: { s1: 's1@x.io', mom: 'mom@x.io', dad: 'dad@x.io', s4: 's4@x.io', s5: 's5@x.io' },
            emailOptOut: ['dad', 's5'],
        }
        const prisma = buildPrisma(w)
        const plan = {
            skip: new Map<string, 'muted' | null>([['s1', null], ['s2', null], ['kid', null], ['s4', 'muted'], ['s5', null]]),
            routes: new Map([['kid', { guardianIds: ['mom', 'dad'], dependentName: 'Миша' }]]),
            muted: new Set(['s4']),
        }
        const targets = await loadEmailTargets(prisma as never, w.students, plan, 'message.broadcast')
        expect(Object.fromEntries(targets)).toEqual({
            s1: [{ userId: 's1', address: 's1@x.io' }],
            kid: [{ userId: 'mom', address: 'mom@x.io' }],
        })
        const direct = await loadEmailTargets(prisma as never, ['s4'], plan, 'message.direct')
        expect(direct.get('s4')).toEqual([{ userId: 's4', address: 's4@x.io' }])
    })

    it("a broadcast skips a guardian who muted the club; the child's other guardian still gets it", async () => {
        const w: World = { students: ['kid'], guardians: { kid: ['mom', 'dad'] }, emails: { mom: 'mom@x.io', dad: 'dad@x.io' } }
        const prisma = buildPrisma(w)
        const plan = {
            skip: new Map<string, null>([['kid', null]]),
            routes: new Map([['kid', { guardianIds: ['mom', 'dad'], dependentName: 'Миша' }]]),
            muted: new Set(['dad']),
        }
        expect((await loadEmailTargets(prisma as never, ['kid'], plan, 'message.broadcast')).get('kid')).toEqual([
            { userId: 'mom', address: 'mom@x.io' },
        ])
        // A service message passes the mute.
        expect((await loadEmailTargets(prisma as never, ['kid'], plan, 'message.service')).get('kid')).toHaveLength(2)
    })
})

describe('planPush muted set', () => {
    it('names everyone who muted the club, guardians included, for a broadcast only', async () => {
        const w: World = { students: ['kid', 's1'], guardians: { kid: ['mom', 'dad'] }, muted: ['dad', 's1'], devices: ['mom'] }
        const plan = (kind: 'message.broadcast' | 'message.direct') =>
            planPush(buildPrisma(w) as never, { workspaceId: 'w1', timezone: 'Asia/Tomsk', userIds: w.students, kind, now: NOW })
        expect([...(await plan('message.broadcast')).muted].sort()).toEqual(['dad', 's1'])
        expect((await plan('message.direct')).muted.size).toBe(0)
    })
})

describe('ClubMessageDeliveryService.deliver', () => {
    it('claims first: a second run (or a cancelled message) writes nothing', async () => {
        const prisma = buildPrisma(MIXED)
        const { svc, producer } = buildService(prisma)
        expect(await svc.deliver('m1', NOW)).toBe(true)
        expect(prisma.clubMessage.updateMany).toHaveBeenCalledWith({
            where: { id: 'm1', status: 'SCHEDULED' },
            data: { status: 'SENT', sentAt: NOW },
        })
        prisma.clubMessage.updateMany.mockResolvedValue({ count: 0 })
        prisma.clubMessageRecipient.createMany.mockClear()
        producer.writeMany.mockClear()
        expect(await svc.deliver('m1', NOW)).toBe(false)
        expect(prisma.clubMessageRecipient.createMany).not.toHaveBeenCalled()
        expect(producer.writeMany).not.toHaveBeenCalled()
    })

    it("a broadcast: every recipient's in-app copy with why no push; inbox for the reachable; counters", async () => {
        const prisma = buildPrisma(MIXED)
        const { svc, producer } = buildService(prisma)
        await svc.deliver('m1', NOW)
        expect(skipOf(prisma)).toEqual({ s1: null, s2: 'no_device', kid: null, s3: 'opted_out', s4: 'muted' })
        // The row stays the child's: guardian routing happens in the producer.
        const rows = producer.writeMany.mock.calls[0][0] as Array<Record<string, unknown>>
        expect(rows.map((r) => r.userId)).toEqual(['s1', 's2', 'kid'])
        expect(rows[0]).toEqual({
            userId: 's1',
            topic: 'Сбор',
            message: 'Тренировка переносится',
            metadata: { kind: 'message.broadcast', workspaceId: 'w1', messageId: 'm1' },
            category: 'clubMessagesEnabled',
        })
        // The counters land with the copies, in the recipients transaction.
        expect(prisma.clubMessage.update).toHaveBeenCalledTimes(1)
        expect(prisma.clubMessage.update).toHaveBeenCalledWith({
            where: { id: 'm1' },
            data: { recipientCount: 5, pushCount: 2 },
        })
        expect(prisma.$executeRaw.mock.calls[0][0].join('?')).toContain('pg_advisory_xact_lock(hashtext(?))')
        expect(prisma.$executeRaw.mock.calls[0][1]).toBe('club-messages:w1')
        expect(prisma.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
            prisma.clubMessageRecipient.groupBy.mock.invocationCallOrder[0],
        )
    })

    it('a service message reaches the opted-out and the muted, with no category', async () => {
        const prisma = buildPrisma(MIXED, { isService: true })
        const { svc, producer } = buildService(prisma)
        await svc.deliver('m1', NOW)
        expect(skipOf(prisma)).toEqual({ s1: null, s2: 'no_device', kid: null, s3: null, s4: null })
        const rows = producer.writeMany.mock.calls[0][0] as Array<Record<string, unknown>>
        expect(rows).toHaveLength(5)
        expect(rows[0].metadata).toMatchObject({ kind: 'message.service' })
        expect(rows[0]).not.toHaveProperty('category')
        expect(prisma.notificationPreferences.findMany).not.toHaveBeenCalled()
    })

    it('a direct message reaches a member who switched off club messages', async () => {
        const prisma = buildPrisma({ students: ['s3'], optedOut: ['s3'], devices: ['s3'] }, {
            segment: 'MEMBERS',
            memberIds: ['s3'],
            isDirect: true,
        })
        const { svc, producer } = buildService(prisma)
        await svc.deliver('m1', NOW)
        expect(skipOf(prisma)).toEqual({ s3: null })
        expect((producer.writeMany.mock.calls[0][0] as Array<{ metadata: unknown }>)[0].metadata).toMatchObject({
            kind: 'message.direct',
        })
    })

    it('cuts a long body for the push, the full text stays in the message', async () => {
        const body = 'а'.repeat(250)
        const prisma = buildPrisma({ students: ['s1'], devices: ['s1'] }, { body })
        const { svc, producer } = buildService(prisma)
        await svc.deliver('m1', NOW)
        const row = (producer.writeMany.mock.calls[0][0] as Array<{ message: string }>)[0]
        expect(row.message).toBe(`${'а'.repeat(200)}…`)
    })

    it('tells the recipients (guardians included), their inbox and the staff list to refetch', async () => {
        const prisma = buildPrisma(MIXED)
        const { svc, realtime } = buildService(prisma)
        await svc.deliver('m1', NOW)
        const addressed = ['s1', 's2', 'kid', 's3', 's4', 'mom']
        expect(realtime.invalidateUsersInWorkspace).toHaveBeenCalledWith(addressed, 'w1', ['club-messages'])
        expect(realtime.invalidateUsers).toHaveBeenCalledWith(addressed, ['notifications'])
        expect(realtime.invalidateCoalesced).toHaveBeenCalledWith('w1', ['messages'])
    })

    it('writes nothing to the producer when nobody is reachable, still records the copies', async () => {
        const prisma = buildPrisma({ students: ['s3'], optedOut: ['s3'] })
        const { svc, producer } = buildService(prisma)
        await svc.deliver('m1', NOW)
        expect(producer.writeMany).not.toHaveBeenCalled()
        expect(skipOf(prisma)).toEqual({ s3: 'opted_out' })
    })

    it('a push failure keeps the copies and counters, still tells the screens to refetch', async () => {
        const prisma = buildPrisma(MIXED)
        const { svc, producer, realtime } = buildService(prisma)
        producer.writeMany.mockRejectedValueOnce(new Error('redis down'))
        await expect(svc.deliver('m1', NOW)).rejects.toThrow('redis down')
        expect(recipientRows(prisma)).toHaveLength(5)
        expect(prisma.clubMessage.update).toHaveBeenCalledWith({
            where: { id: 'm1' },
            data: { recipientCount: 5, pushCount: 2 },
        })
        expect(realtime.invalidateCoalesced).toHaveBeenCalledWith('w1', ['messages'])
    })

    describe('e-mail', () => {
        const EMAIL_WORLD: World = {
            students: ['s1', 'kid', 's5'],
            guardians: { kid: ['mom'] },
            devices: ['s1'],
            emails: { s1: 's1@x.io', mom: 'mom@x.io', s5: 's5@x.io' },
            emailOptOut: ['s5'],
        }

        it('only when both the message and the club enable it', async () => {
            for (const [withEmail, messagesEmailEnabled] of [
                [true, false],
                [false, true],
            ]) {
                const prisma = buildPrisma(EMAIL_WORLD, { withEmail, workspace: { messagesEmailEnabled } })
                const { svc, notifications } = buildService(prisma)
                await svc.deliver('m1', NOW)
                expect(notifications.sendNotification).not.toHaveBeenCalled()
                expect(prisma.clubMessageRecipient.updateMany).not.toHaveBeenCalled()
            }
        })

        it("sends to the recipient and a child's guardian (with the child's name), skips the opted out, stamps emailedAt", async () => {
            const prisma = buildPrisma(EMAIL_WORLD, { withEmail: true })
            const { svc, notifications, templates } = buildService(prisma)
            await svc.deliver('m1', NOW)
            const sent = notifications.sendNotification.mock.calls.map((c) => c[0])
            expect(sent.map((s) => [s.userId, s.identity, s.type, s.topic])).toEqual([
                ['s1', 's1@x.io', 'EMAIL', 'Сбор — Клуб'],
                ['mom', 'mom@x.io', 'EMAIL', 'Миша: Сбор — Клуб'],
            ])
            expect(sent[0].metadata).toEqual({
                kind: 'message.broadcast',
                workspaceId: 'w1',
                messageId: 'm1',
                unsubscribeUrl: expect.stringMatching(
                    /^https:\/\/api\.example\/public\/unsubscribe\/club-messages\?token=s1\./,
                ),
            })
            expect(sent[1].metadata).toMatchObject({ dependentId: 'kid' })
            expect(templates.getTemplate.mock.calls[0][0]).toMatchObject({ key: 'club-message' })
            expect(prisma.clubMessageRecipient.updateMany).toHaveBeenCalledWith({
                where: { messageId: 'm1', userId: { in: ['s1', 'kid'] } },
                data: { emailedAt: NOW },
            })
            expect(prisma.clubMessage.update).toHaveBeenCalledWith({
                where: { id: 'm1' },
                data: { recipientCount: 3, pushCount: 1 },
            })
            expect(prisma.clubMessage.update).toHaveBeenLastCalledWith({
                where: { id: 'm1' },
                data: { emailCount: 2 },
            })
        })

        it('stops at the end of the trial allowance: the rest keep emailedAt null', async () => {
            const prisma = buildPrisma(EMAIL_WORLD, { withEmail: true })
            const { svc, notifications } = buildService(prisma, 1)
            await svc.deliver('m1', NOW)
            expect(notifications.sendNotification).toHaveBeenCalledTimes(1)
            expect(prisma.clubMessageRecipient.updateMany).toHaveBeenCalledWith({
                where: { messageId: 'm1', userId: { in: ['s1'] } },
                data: { emailedAt: NOW },
            })
        })

        it('an allowance spent before the first e-mail stamps nobody', async () => {
            const prisma = buildPrisma(EMAIL_WORLD, { withEmail: true })
            const { svc, notifications } = buildService(prisma, 0)
            await svc.deliver('m1', NOW)
            expect(notifications.sendNotification).not.toHaveBeenCalled()
            expect(prisma.clubMessageRecipient.updateMany).not.toHaveBeenCalled()
        })

        it('one failed e-mail does not stop the others', async () => {
            const prisma = buildPrisma(EMAIL_WORLD, { withEmail: true })
            const { svc, notifications } = buildService(prisma)
            notifications.sendNotification.mockRejectedValueOnce(new Error('queue down'))
            jest.spyOn(svc['logger'], 'error').mockImplementation(() => undefined)
            await svc.deliver('m1', NOW)
            expect(notifications.sendNotification).toHaveBeenCalledTimes(2)
            expect(prisma.clubMessageRecipient.updateMany.mock.calls[0][0].where.userId).toEqual({ in: ['kid'] })
        })

        it('a failure midway still records the copies already sent', async () => {
            const prisma = buildPrisma(EMAIL_WORLD, { withEmail: true })
            const { svc, trialLimits } = buildService(prisma)
            trialLimits.consumeTrialEmail
                .mockResolvedValueOnce(true)
                .mockRejectedValueOnce(new Error('billing down'))
            await expect(svc.deliver('m1', NOW)).rejects.toThrow('billing down')
            expect(prisma.clubMessageRecipient.updateMany).toHaveBeenCalledWith({
                where: { messageId: 'm1', userId: { in: ['s1'] } },
                data: { emailedAt: NOW },
            })
            expect(prisma.clubMessage.update).toHaveBeenLastCalledWith({ where: { id: 'm1' }, data: { emailCount: 1 } })
        })
    })

    describe("the author's scope at send time (dispatcher)", () => {
        it('cancels a message whose author is no longer staff', async () => {
            const prisma = buildPrisma(MIXED, { authorId: 'gone', workspaceId: 'w1', contactId: 'c1' })
            prisma.user.findUnique.mockResolvedValue({
                isSuperAdmin: false,
                workspaceMemberships: [{ role: { name: 'user' } }],
            })
            const { svc, producer, realtime, callLists } = buildService(prisma)
            jest.spyOn(svc['logger'], 'warn').mockImplementation(() => undefined)
            expect(await svc.deliver('m1', NOW)).toBe(false)
            expect(prisma.clubMessage.update).toHaveBeenCalledWith({
                where: { id: 'm1' },
                data: { status: 'CANCELLED', sentAt: null },
            })
            expect(prisma.clubMessageRecipient.createMany).not.toHaveBeenCalled()
            expect(producer.writeMany).not.toHaveBeenCalled()
            expect(realtime.invalidateCoalesced).toHaveBeenCalledWith('w1', ['messages'])
            // The «Связались» it logged is taken back.
            expect(prisma.memberRetentionContact.deleteMany).toHaveBeenCalledWith({
                where: { id: 'c1', workspaceId: 'w1' },
            })
            expect(callLists.invalidate).toHaveBeenCalledWith('w1')
        })

        it("re-reads a coach's own groups and narrows the segment to them", async () => {
            const prisma = buildPrisma({ students: ['s1'], devices: ['s1'] }, { authorId: 'coach' })
            prisma.user.findUnique.mockResolvedValue({
                isSuperAdmin: false,
                workspaceMemberships: [{ role: { name: 'coach' } }],
            })
            prisma.group.findMany.mockResolvedValue([{ id: 'own' }])
            const { svc } = buildService(prisma)
            await svc.deliver('m1', NOW)
            const where = prisma.workspaceMember.findMany.mock.calls[0][0].where
            expect(where.AND[1]).toEqual({
                user: { groupMemberships: { some: { groupId: { in: ['own'] } } } },
            })
        })

        it('uses the scope the request resolved and skips the author lookup', async () => {
            const prisma = buildPrisma({ students: ['s1'] }, { authorId: 'coach' })
            const { svc } = buildService(prisma)
            await svc.deliver('m1', NOW, { scope: { groupIds: null } })
            expect(prisma.user.findUnique).not.toHaveBeenCalled()
        })
    })
})

describe('ClubMessageDeliveryService.authorScope', () => {
    const scopeFor = async (authorId: string | null, author: unknown) => {
        const prisma = buildPrisma({ students: [] })
        prisma.user.findUnique.mockResolvedValue(author)
        prisma.group.findMany.mockResolvedValue([{ id: 'g1' }])
        return buildService(prisma).svc.authorScope(WS, authorId)
    }
    const member = (role: string) => ({ isSuperAdmin: false, workspaceMemberships: [{ role: { name: role } }] })

    it('the owner, a super admin and every sport lead: the whole club', async () => {
        expect(await scopeFor('owner', null)).toEqual({ groupIds: null })
        expect(await scopeFor('sa', { isSuperAdmin: true, workspaceMemberships: [] })).toEqual({ groupIds: null })
        for (const role of ['admin', 'head_coach']) {
            expect(await scopeFor('u', member(role))).toEqual({ groupIds: null })
        }
    })

    it('a coach: own groups', async () => {
        expect(await scopeFor('u', member('coach'))).toEqual({ groupIds: ['g1'] })
    })

    it('gone, deleted or no longer staff: null', async () => {
        expect(await scopeFor(null, null)).toBeNull()
        expect(await scopeFor('u', null)).toBeNull()
        expect(await scopeFor('u', member('user'))).toBeNull()
        expect(await scopeFor('u', { isSuperAdmin: false, workspaceMemberships: [] })).toBeNull()
    })
})
