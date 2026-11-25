jest.mock('../../environments/environment', () => ({
    environment: { encryptionKey: 'test-encryption-secret' },
}))

import {
    BadRequestError,
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { signCheckInCard } from './check-in-card-utils'
import { LookupCheckInCardFeature } from './lookup-check-in-card.feature'
import { LookupCheckInCardHandler } from './lookup-check-in-card.handler'

const SECRET = 'test-encryption-secret'
const OWNER = '00000000-0000-4000-8000-000000000001'
const COACH = '00000000-0000-4000-8000-000000000002'
const OTHER_COACH = '00000000-0000-4000-8000-000000000003'
const STUDENT = '00000000-0000-4000-8000-000000000004'
const GROUP = '00000000-0000-4000-8000-0000000000a1'
const SESSION = '00000000-0000-4000-8000-0000000000b1'

type MemberRow = { status: string } | null
const USER_ROW = {
    firstname: 'Аня',
    lastname: 'Смирнова',
    email: null,
    profilePhotoUrl: 'https://cdn/x.jpg',
}

// A real RbacService over a mocked Prisma, so the refusals are the ones the
// mark path gives (loadSessionForWrite → assertCanMarkClass).
const setup = (o: {
    session?: Record<string, unknown> | null
    member?: MemberRow
    user?: typeof USER_ROW | null
    record?: boolean
    inGroup?: boolean
    coachesMarkAnyClass?: boolean
} = {}) => {
    const prisma = {
        workspace: {
            findUnique: jest.fn().mockResolvedValue({
                ownerId: OWNER,
                coachSeesAllGroups: false,
                type: 'GRAPPLING',
            }),
        },
        attendanceSession: {
            findFirst: jest.fn().mockResolvedValue(
                o.session === undefined
                    ? {
                          id: SESSION,
                          workspaceId: 'w1',
                          groupId: GROUP,
                          slotId: null,
                          occurrenceKey: 'k',
                          workspaceEventId: null,
                          checkInCode: null,
                          coachId: COACH,
                          isPersonal: false,
                          startAt: new Date(),
                          timezone: 'Asia/Tomsk',
                          workspaceEvent: null,
                      }
                    : o.session,
            ),
        },
        groupCoach: {
            findFirst: jest
                .fn()
                .mockImplementation(async ({ where }) =>
                    where.userId === COACH ? { role: 'primary' } : null,
                ),
        },
        group: {
            findFirst: jest.fn().mockImplementation(async ({ select }) =>
                select.workspace
                    ? { workspace: { coachesMarkAnyClass: o.coachesMarkAnyClass ?? false } }
                    : { id: GROUP, directionId: null },
            ),
        },
        classSubstitution: { findFirst: jest.fn().mockResolvedValue(null) },
        workspaceMember: {
            findFirst: jest
                .fn()
                .mockResolvedValue(o.member === undefined ? { status: 'ACTIVE' } : o.member),
        },
        user: {
            findUnique: jest
                .fn()
                .mockResolvedValue(o.user === undefined ? USER_ROW : o.user),
        },
        attendanceRecord: {
            findUnique: jest.fn().mockResolvedValue(o.record ? { id: 'r1' } : null),
        },
        groupMember: {
            findFirst: jest
                .fn()
                .mockResolvedValue(o.inGroup === false ? null : { userId: STUDENT }),
        },
    }
    const handler = new LookupCheckInCardHandler(
        prisma as never,
        new RbacService(prisma as never),
    )
    const run = (
        card: string,
        caller: { userId: string; roleName: string | null } = {
            userId: COACH,
            roleName: 'coach',
        },
    ) =>
        handler.execute(
            new LookupCheckInCardFeature(
                { card },
                'w1',
                SESSION,
                caller.userId,
                caller.roleName,
                false,
            ),
        )
    return { prisma, run }
}

const cardOf = (id: string) => signCheckInCard(id, SECRET)

describe('LookupCheckInCardHandler', () => {
    it('resolves a member of the group, not yet marked', async () => {
        const { run, prisma } = setup()
        await expect(run(cardOf(STUDENT))).resolves.toEqual({
            userId: STUDENT,
            name: 'Аня Смирнова',
            photoUrl: 'https://cdn/x.jpg',
            isDependent: true,
            inGroup: true,
            alreadyMarked: false,
        })
        expect(prisma.attendanceRecord.findUnique.mock.calls[0][0].where).toEqual({
            sessionId_userId: { sessionId: SESSION, userId: STUDENT },
        })
    })

    it('says alreadyMarked when the visit is on the roster', async () => {
        const { run } = setup({ record: true })
        await expect(run(cardOf(STUDENT))).resolves.toMatchObject({ alreadyMarked: true })
    })

    it('marks a guest (not in the group) as inGroup: false', async () => {
        const { run } = setup({ inGroup: false })
        await expect(run(cardOf(STUDENT))).resolves.toMatchObject({ inGroup: false })
    })

    it('answers inGroup: null for a session with no group', async () => {
        const { run, prisma } = setup({
            session: {
                id: SESSION,
                workspaceId: 'w1',
                groupId: null,
                slotId: null,
                occurrenceKey: 'e',
                workspaceEventId: 'ev1',
                checkInCode: null,
                coachId: COACH,
                isPersonal: false,
                startAt: new Date(),
                timezone: 'UTC',
                workspaceEvent: { coachId: COACH },
            },
        })
        await expect(run(cardOf(STUDENT))).resolves.toMatchObject({ inGroup: null })
        expect(prisma.groupMember.findFirst).not.toHaveBeenCalled()
    })

    it('refuses a coach of another group without «отмечать в чужих группах»', async () => {
        const { run, prisma } = setup()
        await expect(
            run(cardOf(STUDENT), { userId: OTHER_COACH, roleName: 'coach' }),
        ).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.workspaceMember.findFirst).not.toHaveBeenCalled()
    })

    it('lets a coach of another group scan when the club allows marking any class', async () => {
        const { run } = setup({ coachesMarkAnyClass: true })
        await expect(
            run(cardOf(STUDENT), { userId: OTHER_COACH, roleName: 'coach' }),
        ).resolves.toMatchObject({ userId: STUDENT })
    })

    it('refuses a student', async () => {
        const { run } = setup()
        await expect(
            run(cardOf(STUDENT), { userId: STUDENT, roleName: 'user' }),
        ).rejects.toBeInstanceOf(ForbiddenError)
    })

    it('lets the owner (no member row) scan', async () => {
        const { run } = setup()
        await expect(
            run(cardOf(STUDENT), { userId: OWNER, roleName: null }),
        ).resolves.toMatchObject({ userId: STUDENT })
    })

    it('is NotFound for an unknown session', async () => {
        const { run } = setup({ session: null })
        await expect(run(cardOf(STUDENT))).rejects.toBeInstanceOf(NotFoundError)
    })

    it('refuses something that is not a ClubSpace card (400)', async () => {
        const { run, prisma } = setup()
        await expect(run('https://example.com')).rejects.toThrow(
            new BadRequestError({ message: 'Это не карта участника ClubSpace' }),
        )
        await expect(run(signCheckInCard(STUDENT, 'forged'))).rejects.toBeInstanceOf(
            BadRequestError,
        )
        expect(prisma.workspaceMember.findFirst).not.toHaveBeenCalled()
    })

    it('is NotFound with no name for someone outside the club', async () => {
        const { run } = setup({ member: null })
        const err = await run(cardOf(STUDENT)).catch((e: Error) => e)
        expect(err).toBeInstanceOf(NotFoundError)
        expect((err as Error).message).toBe('Этого человека нет в клубе')
        expect((err as Error).message).not.toContain('Аня')
    })

    it('is NotFound for a card of a deleted account', async () => {
        const { run } = setup({ user: null })
        await expect(run(cardOf(STUDENT))).rejects.toBeInstanceOf(NotFoundError)
    })

    it('refuses a blocked member, naming them', async () => {
        const { run } = setup({ member: { status: 'BLOCKED' } })
        await expect(run(cardOf(STUDENT))).rejects.toThrow(
            'Аня Смирнова не активен в клубе — отметить нельзя',
        )
    })

    it('resolves the owner as the scanned person (no member row)', async () => {
        const { run } = setup({
            member: null,
            user: { firstname: 'Олег', lastname: null, email: 'o@x.io', profilePhotoUrl: null } as never,
        })
        await expect(run(cardOf(OWNER))).resolves.toMatchObject({
            userId: OWNER,
            name: 'Олег',
            isDependent: false,
        })
    })
})
