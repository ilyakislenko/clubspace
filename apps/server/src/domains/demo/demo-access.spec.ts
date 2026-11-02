import { findDemoWorkspace, isDemoOnlyAccount } from './demo-access'

const build = (
    o: { isDemo?: boolean; email?: string | null; demo?: boolean; owned?: number; member?: number } = {},
) => ({
    user: {
        findUnique: jest.fn().mockResolvedValue({
            isDemo: o.isDemo ?? true,
            email: o.email === undefined ? 'owner@academy.demo' : o.email,
        }),
    },
    workspace: {
        findFirst: jest.fn().mockResolvedValue(o.demo === false ? null : { id: 'w-demo' }),
        count: jest.fn().mockResolvedValue(o.owned ?? 0),
    },
    workspaceMember: { count: jest.fn().mockResolvedValue(o.member ?? 0) },
})

describe('findDemoWorkspace', () => {
    it.each([
        ['academy', 'academy-demo'],
        ['ritm', 'ritm-demo'],
    ] as const)('looks for the %s demo key AND the demo flag', async (club, key) => {
        const prisma = build()
        await findDemoWorkspace(prisma as never, club)
        expect(prisma.workspace.findFirst.mock.calls[0][0].where).toEqual({ key, isDemo: true })
    })
})

describe('isDemoOnlyAccount', () => {
    const user = { id: 'u1', isSuperAdmin: false }

    it('opens a generated account that belongs to the demo club only', async () => {
        const prisma = build()
        await expect(isDemoOnlyAccount(prisma as never, user)).resolves.toBe(true)
        expect(prisma.workspaceMember.count.mock.calls[0][0].where).toEqual({
            userId: 'u1',
            workspaceId: { not: 'w-demo' },
        })
    })

    it.each([
        ['owner@ritm.demo'],
        ['pedagog@ritm.demo'],
        ['student@ritm.demo'],
        ['parent@ritm.demo'],
    ])('pins the studio account %s to the studio demo club', async (email) => {
        const prisma = build({ email })
        await expect(isDemoOnlyAccount(prisma as never, user)).resolves.toBe(true)
        expect(prisma.workspace.findFirst.mock.calls[0][0].where).toEqual({ key: 'ritm-demo', isDemo: true })
    })

    it('never opens a platform admin', async () => {
        const prisma = build()
        await expect(isDemoOnlyAccount(prisma as never, { ...user, isSuperAdmin: true })).resolves.toBe(false)
        expect(prisma.user.findUnique).not.toHaveBeenCalled()
    })

    it.each([
        ['a real (non-generated) account', { isDemo: false }],
        ['an account when there is no demo club', { demo: false }],
        ['the owner of another club', { owned: 1 }],
        ['a member of another club', { member: 1 }],
        ['a generated studio student without a fixed address', { email: 'daria.mironova.7@ritm.demo' }],
        ['an address of no demo club', { email: 'owner@ritm.example' }],
        ['an account without an address', { email: null }],
    ])('refuses %s', async (_label, o) => {
        const prisma = build(o)
        await expect(isDemoOnlyAccount(prisma as never, user)).resolves.toBe(false)
    })
})
