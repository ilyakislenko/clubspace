import { PrismaService } from '../../infrastructure/prisma'
import { ForbiddenError } from '../errors/shared.errors'
import { assertActiveWorkspaceMembership } from './assert-membership'

const USER = 'user-1'
const WORKSPACE = 'ws-1'

const buildPrisma = (opts: {
    // undefined -> workspace row exists with a different owner; null -> the
    // workspace row itself is missing.
    ownerId?: string | null
    workspaceMissing?: boolean
    // undefined -> a default ACTIVE membership; null -> no membership row.
    membership?: { status: string; accessUntil: Date | null } | null
}) =>
    ({
        workspace: {
            findUnique: jest
                .fn()
                .mockResolvedValue(
                    opts.workspaceMissing
                        ? null
                        : { ownerId: opts.ownerId ?? 'someone-else' },
                ),
        },
        workspaceMember: {
            findUnique: jest
                .fn()
                .mockResolvedValue(
                    opts.membership === undefined
                        ? { status: 'ACTIVE', accessUntil: null }
                        : opts.membership,
                ),
        },
    }) as unknown as PrismaService

const call = (prisma: PrismaService) =>
    assertActiveWorkspaceMembership(prisma, USER, WORKSPACE)

describe('assertActiveWorkspaceMembership', () => {
    it('rejects an authenticated user who is not a member and not the owner', async () => {
        await expect(call(buildPrisma({ membership: null }))).rejects.toBeInstanceOf(
            ForbiddenError,
        )
    })

    it('allows an ACTIVE member with no access window', async () => {
        await expect(call(buildPrisma({}))).resolves.toBeUndefined()
    })

    it('allows an ACTIVE member whose access window has not expired', async () => {
        const future = new Date(Date.now() + 60 * 60 * 1000)
        await expect(
            call(buildPrisma({ membership: { status: 'ACTIVE', accessUntil: future } })),
        ).resolves.toBeUndefined()
    })

    it('rejects an ACTIVE member whose access window has expired', async () => {
        await expect(
            call(
                buildPrisma({
                    membership: {
                        status: 'ACTIVE',
                        accessUntil: new Date('2000-01-01'),
                    },
                }),
            ),
        ).rejects.toBeInstanceOf(ForbiddenError)
    })

    it('rejects a non-ACTIVE (e.g. INVITED) member', async () => {
        await expect(
            call(
                buildPrisma({ membership: { status: 'INVITED', accessUntil: null } }),
            ),
        ).rejects.toBeInstanceOf(ForbiddenError)
    })

    it('allows the owner even with NO membership row (owner bypass precedes the member check)', async () => {
        await expect(
            call(buildPrisma({ ownerId: USER, membership: null })),
        ).resolves.toBeUndefined()
    })

    it('allows the owner even if their membership is expired/inactive', async () => {
        await expect(
            call(
                buildPrisma({
                    ownerId: USER,
                    membership: {
                        status: 'INVITED',
                        accessUntil: new Date('2000-01-01'),
                    },
                }),
            ),
        ).resolves.toBeUndefined()
    })

    it('rejects when the workspace does not exist and the user is not a member', async () => {
        await expect(
            call(buildPrisma({ workspaceMissing: true, membership: null })),
        ).rejects.toBeInstanceOf(ForbiddenError)
    })
})
