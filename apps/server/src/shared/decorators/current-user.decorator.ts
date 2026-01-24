import { createParamDecorator, ExecutionContext } from '@nestjs/common'

export interface CurrentUserPayload {
    userId: string
    workspaceId: string
    isSuperAdmin: boolean
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
