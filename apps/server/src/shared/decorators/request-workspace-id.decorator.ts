import { createParamDecorator, ExecutionContext } from '@nestjs/common'

import { resolveRequestWorkspaceId } from '../access/resolve-workspace-id'
import { BadRequestError } from '../errors/shared.errors'

// The club for a route that has no `:workspaceId` in its path (admin/videos
// takes it from the query or body). Resolved by the same rule the guards
// authorized with, so the handler can never act on a different club than the
// one AuthGuard/WorkspaceMemberGuard checked. Never read `query.workspaceId` /
// `body.workspaceId` in a controller — workspace-id-source.spec.ts fails on it.
export const RequestWorkspaceId = createParamDecorator(
    (_data: unknown, ctx: ExecutionContext): string => {
        const workspaceId = resolveRequestWorkspaceId(
            ctx.switchToHttp().getRequest(),
        )
        if (!workspaceId) {
            throw new BadRequestError({ message: 'Не указан клуб' })
        }
        return workspaceId
    },
)
