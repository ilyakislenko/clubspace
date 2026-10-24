import { RolesEnum } from '../../../server/src/shared/interfaces/shared.intefaces'
import type { TestApp } from './test-app'

let counter = 0
const uniq = (prefix: string) => `${prefix}-${Date.now()}-${counter++}`

export const createUser = async (
    ctx: TestApp,
    overrides: { email?: string; isSuperAdmin?: boolean; firstname?: string } = {},
) => {
    return ctx.prisma.user.create({
        data: {
            email: overrides.email ?? `${uniq('user')}@example.com`,
            status: 'ACTIVE',
            language: 'EN',
            isSuperAdmin: overrides.isSuperAdmin ?? false,
            firstname: overrides.firstname ?? null,
        },
    })
}

const roleIdByName = async (ctx: TestApp, name: string) => {
    const role = await ctx.prisma.role.findUnique({
        where: { name },
        select: { id: true },
    })
    if (!role) {
        throw new Error(
            `Role "${name}" is missing. The suite truncates everything except ` +
                `seed-owned tables — call ctx.seed.onApplicationBootstrap() in ` +
                `beforeEach if you reset those too.`,
        )
    }
    return role.id
}

/**
 * A club with its owner.
 *
 * By default the owner also gets an `admin` WorkspaceMember row, because that
 * is what the platform console does when it creates a club and hands it over.
 *
 * Pass `ownerMembership: false` for the other shape — ownership recorded only
 * in `Workspace.ownerId`. That is the invariant every membership gate is
 * written to special-case, and it is worth testing precisely because nothing
 * enforces it: an owner without the row was refused on their own club until
 * AuthGuard learned to resolve them (see owner-access.e2e-spec.ts).
 */
export const createWorkspace = async (
    ctx: TestApp,
    overrides: {
        key?: string
        name?: string
        ownerId?: string
        isActive?: boolean
        ownerMembership?: boolean
    } = {},
) => {
    const owner = overrides.ownerId
        ? await ctx.prisma.user.findUniqueOrThrow({ where: { id: overrides.ownerId } })
        : await createUser(ctx, { email: `${uniq('owner')}@example.com` })

    const workspace = await ctx.prisma.workspace.create({
        data: {
            key: overrides.key ?? uniq('club'),
            name: overrides.name ?? 'Test Club',
            type: 'GRAPPLING',
            isActive: overrides.isActive ?? true,
            ownerId: owner.id,
        },
    })

    if (overrides.ownerMembership !== false) {
        await ctx.prisma.workspaceMember.create({
            data: {
                userId: owner.id,
                workspaceId: workspace.id,
                roleId: await roleIdByName(ctx, 'admin'),
                status: 'ACTIVE',
            },
        })
    }

    return { workspace, owner }
}

export const addMember = async (
    ctx: TestApp,
    params: {
        workspaceId: string
        userId?: string
        role?: RolesEnum
        status?: 'ACTIVE' | 'INVITED' | 'BLOCKED'
        accessUntil?: Date | null
    },
) => {
    const user = params.userId
        ? await ctx.prisma.user.findUniqueOrThrow({ where: { id: params.userId } })
        : await createUser(ctx)

    const roleName = (params.role ?? RolesEnum.USER).toLowerCase()
    const member = await ctx.prisma.workspaceMember.create({
        data: {
            userId: user.id,
            workspaceId: params.workspaceId,
            roleId: await roleIdByName(ctx, roleName),
            status: params.status ?? 'ACTIVE',
            accessUntil: params.accessUntil ?? null,
        },
    })

    return { member, user }
}

export const createPlan = async (
    ctx: TestApp,
    params: {
        workspaceId: string
        name?: string
        price?: number
        durationDays?: number
        classCount?: number | null
        isFreeTrial?: boolean
        isActive?: boolean
    },
) =>
    ctx.prisma.plan.create({
        data: {
            workspaceId: params.workspaceId,
            name: params.name ?? '8 занятий',
            price: params.price ?? 400000,
            currency: 'RUB',
            durationDays: params.durationDays ?? 30,
            classCount: params.classCount === undefined ? 8 : params.classCount,
            isFreeTrial: params.isFreeTrial ?? false,
            isActive: params.isActive ?? true,
        },
    })

/**
 * A group with one weekly slot, anchored at a gym. The coach is both
 * `Group.coachId` and the primary GroupCoach row, the way create-group writes it.
 */
export const createGroupWithSlot = async (
    ctx: TestApp,
    params: {
        workspaceId: string
        coachUserId: string
        dayOfWeek: number
        startTime?: string
        durationMin?: number
        gymTimezone?: string | null
        name?: string
    },
) => {
    const gym = await ctx.prisma.gym.create({
        data: {
            workspaceId: params.workspaceId,
            name: 'Test Gym',
            address: 'Test street 1',
            timezone:
                params.gymTimezone === undefined
                    ? 'Asia/Tomsk'
                    : params.gymTimezone,
        },
    })
    const group = await ctx.prisma.group.create({
        data: {
            workspaceId: params.workspaceId,
            name: params.name ?? uniq('group'),
            gymId: gym.id,
            coachId: params.coachUserId,
        },
    })
    await ctx.prisma.groupCoach.create({
        data: {
            groupId: group.id,
            userId: params.coachUserId,
            role: 'primary',
        },
    })
    const slot = await ctx.prisma.groupScheduleSlot.create({
        data: {
            groupId: group.id,
            dayOfWeek: params.dayOfWeek,
            startTime: params.startTime ?? '19:00',
            durationMin: params.durationMin ?? 90,
        },
    })
    return { gym, group, slot }
}
