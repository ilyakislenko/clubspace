import { createParamDecorator, ExecutionContext } from '@nestjs/common'

export interface CurrentUserPayload {
    userId: string
    workspaceId: string
    // Platform powers in this session — false for a super admin whose
    // session lacks the required second factor (see superAdminMfaMissing).
    isSuperAdmin: boolean
    // A super-admin account signed in without its authenticator while
    // PLATFORM_ADMIN_MFA_REQUIRED is on: an ordinary user here, and
    // SuperAdminGuard answers PLATFORM_MFA_REQUIRED instead of a plain 403.
    superAdminMfaMissing?: boolean
    // The signed-in guardian while they act for a dependent (X-Act-As); then
    // `userId` is the dependent's. Null/absent otherwise.
    guardianId?: string | null
    role: {
        id: string
        name: string
        superuser: boolean
    } | null
    permissions: {
        id: string
        key: string
        editable: boolean
        group: string | null
        description: string | null
        allowed: boolean
    }[]
}

export const CurrentUser = createParamDecorator(
    (data, ctx: ExecutionContext) => {
        return ctx.switchToHttp().getRequest().user
    },
)
