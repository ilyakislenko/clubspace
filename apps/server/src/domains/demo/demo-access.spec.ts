import { findDemoWorkspace, isDemoOnlyAccount } from './demo-access'

const build = (o: { isDemo?: boolean; demo?: boolean; owned?: number; member?: number } = {}) => ({
    user: { findUnique: jest.fn().mockResolvedValue({ isDemo: o.isDemo ?? true }) },
    workspace: {
        findFirst: jest.fn().mockResolvedValue(o.demo === false ? null : { id: 'w-demo' }),
        count: jest.fn().mockResolvedValue(o.owned ?? 0),
    },
    workspaceMember: { count: jest.fn().mockResolvedValue(o.member ?? 0) },
})

describe('findDemoWorkspace', () => {
    it('looks for the demo key AND the demo flag', async () => {
        const prisma = build()
        await findDemoWorkspace(prisma as never)
        expect(prisma.workspace.findFirst.mock.calls[0][0].where).toEqual({
            key: 'arsenal-demo',
            isDemo: true,
        })
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
    ])('refuses %s', async (_label, o) => {
        await expect(isDemoOnlyAccount(build(o) as never, user)).resolves.toBe(false)
    })
})
