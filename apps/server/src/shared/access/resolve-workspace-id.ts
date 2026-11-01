import { BadRequestError } from '../errors/shared.errors'

type WorkspaceIdSource = {
    params?: unknown
    query?: unknown
    body?: unknown
}

const SOURCES = ['params', 'query', 'body'] as const

/**
 * The one rule for "which club is this request about". Every guard that
 * authorizes against a club (AuthGuard, WorkspaceMemberGuard, RoleGuard via
 * AuthGuard's role, FeatureEnabledGuard) and every controller that takes the
 * club from the query or body (`@RequestWorkspaceId()`) reads it here, so the
 * club a handler acts on is always the club the guards checked.
 *
 * Precedence is path param > query > body, but precedence only matters for a
 * request that names the club once: when two places carry DIFFERENT ids the
 * request is refused. Letting one source win would bring back the original
 * hole — guards checking the body while the handler used the query.
 *
 * An empty string counts as absent. Anything other than a string (an array
 * from `?workspaceId=a&workspaceId=b`, an object, a number) is refused.
 * The JWT is deliberately not a source: nothing in a token names a club.
 */
export const resolveRequestWorkspaceId = (
    req: WorkspaceIdSource,
): string | undefined => {
    let resolved: string | undefined
    for (const source of SOURCES) {
        const container = req[source]
        const value =
            container !== null &&
            typeof container === 'object' &&
            !Array.isArray(container) &&
            'workspaceId' in container
                ? container.workspaceId
                : undefined
        if (value === undefined || value === null || value === '') continue
        if (typeof value !== 'string') {
            throw new BadRequestError({
                message: 'Некорректный идентификатор клуба',
            })
        }
        if (resolved === undefined) {
            resolved = value
        } else if (resolved !== value) {
            throw new BadRequestError({
                message: 'В запросе указаны разные клубы',
            })
        }
    }
    return resolved
}
