import { findMemberCoach } from './member-coach'

const make = (row: unknown) => {
    const db = { groupMember: { findFirst: jest.fn().mockResolvedValue(row) } }
    return db
}

const coachRow = (over: Record<string, unknown> = {}) => ({
    group: {
        coach: {
            id: 'c1',
            firstname: 'Роман',
            lastname: 'Чертовских',
            phone: '+79528849420',
            status: 'ACTIVE',
            ...over,
        },
    },
})

describe('findMemberCoach', () => {
    it('looks at the earliest-joined group of the member in this workspace', async () => {
        const db = make(null)
        await findMemberCoach(db as never, { workspaceId: 'w1', userId: 'u1' })
        const args = db.groupMember.findFirst.mock.calls[0][0]
        expect(args.where).toEqual({
            userId: 'u1',
            group: { workspaceId: 'w1' },
        })
        expect(args.orderBy).toEqual({ joinedAt: 'asc' })
    })

    it('returns null for a member in no group', async () => {
        expect(
            await findMemberCoach(make(null) as never, {
                workspaceId: 'w1',
                userId: 'u1',
            }),
        ).toBeNull()
    })

    it('returns the coach name and phone', async () => {
        expect(
            await findMemberCoach(make(coachRow()) as never, {
                workspaceId: 'w1',
                userId: 'u1',
            }),
        ).toEqual({
            userId: 'c1',
            name: 'Роман Чертовских',
            phone: '+79528849420',
        })
    })

    it('returns null for a deleted coach', async () => {
        expect(
            await findMemberCoach(
                make(coachRow({ status: 'DELETED' })) as never,
                { workspaceId: 'w1', userId: 'u1' },
            ),
        ).toBeNull()
    })

    it('never falls back to the e-mail for the name', async () => {
        const res = await findMemberCoach(
            make(coachRow({ firstname: null, lastname: ' ', phone: null })) as never,
            { workspaceId: 'w1', userId: 'u1' },
        )
        expect(res).toEqual({ userId: 'c1', name: null, phone: null })
    })
})
