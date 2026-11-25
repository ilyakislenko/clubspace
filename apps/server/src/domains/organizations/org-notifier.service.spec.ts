import { isMuteExempt } from '../notifications/notification-mute'
import { OrgNotifierService } from './org-notifier.service'

const build = () => {
    const prisma = {
        organizationMember: {
            findMany: jest.fn().mockResolvedValue([{ userId: 'a1' }, { userId: 'a2' }]),
        },
    }
    const producer = { notifyUser: jest.fn().mockResolvedValue(true) }
    const bus = { execute: jest.fn().mockResolvedValue({ success: true }) }
    return { prisma, producer, bus, notifier: new OrgNotifierService(prisma as never, producer as never, bus as never) }
}

describe('OrgNotifierService', () => {
    it('invites the club owner by inbox/push and e-mail; a re-invite is a new notice', async () => {
        const t = build()
        const p = {
            linkId: 'l1',
            invitedAt: new Date(1000),
            organization: { id: 'org1', name: 'Федерация <b>' },
            club: { workspaceId: 'w1', name: 'ACADEMY', ownerId: 'owner' },
        }
        await t.notifier.notifyClubInvited(p)
        expect(t.producer.notifyUser).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: 'owner',
                kind: 'org.club_invited',
                refId: 'l1:1000',
                metadata: { organizationId: 'org1', workspaceId: 'w1', linkId: 'l1' },
            }),
        )
        const email = t.bus.execute.mock.calls[0][0].payload
        expect(email).toMatchObject({ userId: 'owner', types: ['EMAIL'], forced: true })
        expect(email.message).toContain('Федерация &lt;b&gt;')
        await t.notifier.notifyClubInvited({ ...p, invitedAt: new Date(2000) })
        expect(t.producer.notifyUser.mock.calls[1][0].refId).toBe('l1:2000')
    })

    it('never throws: the decision is already saved', async () => {
        const t = build()
        t.producer.notifyUser.mockRejectedValue(new Error('push down'))
        t.bus.execute.mockRejectedValue(new Error('mail down'))
        await expect(
            t.notifier.notifyClubInvited({
                linkId: 'l1',
                invitedAt: new Date(),
                organization: { id: 'org1', name: 'Ф' },
                club: { workspaceId: 'w1', name: 'A', ownerId: 'o' },
            }),
        ).resolves.toBeUndefined()
        await expect(
            t.notifier.notifyMemberAdded({ userId: 'u', organization: { id: 'org1', name: 'Ф' }, role: 'ORG_COACH' }),
        ).resolves.toBe(false)
    })

    it('tells every org admin when a club joins or leaves', async () => {
        const t = build()
        await t.notifier.notifyOrgAdmins({
            organizationId: 'org1',
            kind: 'org.club_left',
            refId: 'l1:5',
            topic: 't',
            message: 'm',
            workspaceId: 'w1',
        })
        expect(t.prisma.organizationMember.findMany.mock.calls[0][0].where).toEqual({
            organizationId: 'org1',
            role: 'ORG_ADMIN',
        })
        expect(t.producer.notifyUser.mock.calls.map((c) => [c[0].userId, c[0].refId])).toEqual([
            ['a1', 'l1:5:a1'],
            ['a2', 'l1:5:a2'],
        ])
    })

    it('membership notices are mute-exempt; org announcements are not', () => {
        expect(isMuteExempt('org.club_invited')).toBe(true)
        expect(isMuteExempt('org.club_joined')).toBe(true)
        expect(isMuteExempt('org.club_left')).toBe(true)
        expect(isMuteExempt('org.announcement')).toBe(false)
    })
})
