import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'

// Static guard: the @Roles tier on a route must agree with the authorization
// check inside its handler. A handler that calls assertWorkspaceAdmin() can
// never be passed by a coach, so the route must not advertise COACHING_ROLES.

const FEATURES_DIR = join(__dirname, '..', '..', 'features')

// Routes that are WORKSPACE_ADMINS at the controller but have no
// assertWorkspaceAdmin() in the handler (the tier itself is the gate).
// Frozen: this list may only shrink.
const RULE_B_EXCEPTIONS = [
    'CreateGymFeature',
    'DeleteGymFeature',
    'UpdateGymFeature',
    'ListRolesFeature',
    'UpdateMemberNotesFeature',
]

// Controller methods allowed to carry @AllowExpiredAccess (they skip the
// accessUntil check in WorkspaceMemberGuard). Keep it to what the lock screen
// needs; do not let it spread.
const EXPECTED_ALLOW_EXPIRED_ACCESS = [
    'club-about/club-about.controller.ts getClubAbout',
    // «Оплатить онлайн» on the lock screen: paying is how access comes back.
    'online-payments/my-payments.controller.ts getOnlinePurchaseOptions',
    'online-payments/my-payments.controller.ts getMyPayment',
    'online-payments/payments.controller.ts createPayment',
]

// Controller methods allowed to carry @AllowSuspendedWorkspace (they stay open
// in a suspended club). Only what the admin needs to show the state and get
// the club paid for.
const EXPECTED_ALLOW_SUSPENDED = [
    'club-legal/workspace-legal.controller.ts acceptWorkspaceLegal',
    'get-my-workspace-membership/get-my-workspace-membership.controller.ts getMyMembership',
    'workspace-billing/workspace-billing.controller.ts getWorkspaceBilling',
    'workspace-billing/workspace-billing.controller.ts getWorkspaceBillingPayment',
    'workspace-billing/workspace-billing.controller.ts listWorkspaceBillingPayments',
    'workspace-billing/workspace-billing.controller.ts removeWorkspaceBillingCard',
    'workspace-billing/workspace-billing.controller.ts setWorkspaceBillingPeriod',
    'workspace-billing/workspace-billing.controller.ts startWorkspaceBillingCheckout',
]

// User-level routes (no workspace in the request) that accept X-Act-As — a
// guardian acting for a dependent. Workspace-scoped member routes accept it
// without the decorator; everything else (account, devices, notifications,
// the guardian's own «Дети» routes) must keep acting as the signed-in person.
const EXPECTED_ACT_AS_ALLOWED = [
    'export-my-data/export-my-data.controller.ts exportMyData',
    'get-me/get-me.controller.ts getMe',
    'get-my-workspaces/get-my-workspaces.controller.ts getMyWorkspaces',
    'get-video-playback/get-video-playback.controller.ts getPlayback',
    'get-web-playback/get-web-playback.controller.ts getWebPlayback',
    'join-workspace/join-workspace.controller.ts joinWorkspaceByCode',
    'join-workspace/list-my-join-requests.controller.ts listMyJoinRequests',
    'my-agenda/my-agenda.controller.ts getMyAgenda',
    'save-video-progress/save-video-progress.controller.ts save',
    'set-video-favorite/set-video-favorite.controller.ts setFavorite',
]

const EXPECTED_NON_BUS_ROUTES: Record<string, string | null> = {
    'data-export/export.controller.ts members': 'WORKSPACE_ADMINS',
    'data-export/export.controller.ts renewals': 'WORKSPACE_ADMINS',
    'data-export/export.controller.ts attendance': 'WORKSPACE_ADMINS',
    'data-export/export.controller.ts revenue': 'WORKSPACE_ADMINS',
    'get-video-manifest/get-video-manifest.controller.ts getManifest': null,
    'health/health.controller.ts ?': null,
    'health/health.controller.ts readyz': null,
    // ИИ-ассистент MCP transport: club token auth inside McpServerService.
    'mcp/mcp.controller.ts handleMcpPost': null,
    'mcp/mcp.controller.ts handleMcpGet': null,
    'mcp/mcp.controller.ts handleMcpDelete': null,
}

const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
        const full = join(dir, name)
        return statSync(full).isDirectory() ? walk(full) : [full]
    })

const files = walk(FEATURES_DIR).filter((f) => !f.endsWith('.spec.ts'))

const handlerByFeature = new Map<string, string>()
for (const file of files.filter((f) => f.endsWith('.handler.ts'))) {
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(/@Feature\((\w+)\)/g)) {
        handlerByFeature.set(m[1], src)
    }
}

interface Route {
    where: string
    tier: string | null
    feature: string
    hasCheck: boolean
    // Calls the direction rule (assertCanManageDirection / assertManagesDirections)
    // without assertWorkspaceAdmin: a direction manager — a coach — must reach it.
    hasDirectionCheck: boolean
}

const HTTP = /@(?:Get|Post|Patch|Put|Delete)\(/g

const routes: Route[] = []
// Routes that don't go through the feature bus (exports, health, …): not
// covered by Rules A/B, so their tier is pinned explicitly below.
const skipped: Record<string, string | null> = {}
const multiRoles: string[] = []
const allowExpired: string[] = []
const allowSuspended: string[] = []
const actAsAllowed: { where: string; tier: string | null }[] = []
for (const file of files.filter((f) => f.endsWith('.controller.ts'))) {
    const src = readFileSync(file, 'utf8')
    const classIdx = src.search(/export class /)
    const classTier =
        src.slice(0, classIdx).match(/@Roles\((\w+)\)/)?.[1] ?? null
    const starts = [...src.matchAll(HTTP)].map((m) => m.index as number)
    starts.forEach((start, i) => {
        const chunk = src.slice(start, starts[i + 1] ?? src.length)
        const feature = chunk.match(/new (\w+Feature)\(/)?.[1]
        const own = [...chunk.matchAll(/@Roles\((\w+)\)/g)]
        const line = src.slice(0, start).split('\n').length
        const method = chunk.match(/async (\w+)\(/)?.[1] ?? '?'
        if (chunk.includes('@AllowExpiredAccess(')) {
            allowExpired.push(`${relative(FEATURES_DIR, file)} ${method}`)
        }
        if (chunk.includes('@AllowSuspendedWorkspace(')) {
            allowSuspended.push(`${relative(FEATURES_DIR, file)} ${method}`)
        }
        if (chunk.includes('@ActAsAllowed(')) {
            actAsAllowed.push({
                where: `${relative(FEATURES_DIR, file)} ${method}`,
                tier: own.length === 1 ? own[0][1] : classTier,
            })
        }
        if (own.length > 1) {
            multiRoles.push(`${relative(FEATURES_DIR, file)}:${line} ${method}`)
        }
        if (!feature) {
            skipped[`${relative(FEATURES_DIR, file)} ${method}`] =
                own.length === 1 ? own[0][1] : classTier
            return
        }
        const handler = handlerByFeature.get(feature)
        routes.push({
            where: `${relative(FEATURES_DIR, file)}:${line} ${method} → ${feature}`,
            tier: own.length === 1 ? own[0][1] : classTier,
            feature,
            hasCheck: handler?.includes('assertWorkspaceAdmin(') ?? false,
            hasDirectionCheck:
                !!handler &&
                !handler.includes('assertWorkspaceAdmin(') &&
                (handler.includes('assertCanManageDirection(') ||
                    handler.includes('assertManagesDirections(')),
        })
    })
}

describe('route tier consistency', () => {
    it('scans enough routes to be meaningful', () => {
        expect(routes.length).toBeGreaterThanOrEqual(199) // real count (+ club-about GET/PUT, + 11 rank-grading/readiness/progress routes, + 5 freeze-request routes)
        expect(
            routes.filter((r) => r.hasCheck && r.tier === 'WORKSPACE_ADMINS')
                .length,
        ).toBeGreaterThanOrEqual(41) // real count (+ 3 direction-manager routes; ladders, gradings, promotions, achievements, announcements, tariffs moved to the direction rule — Rule C)
    })

    it('routes outside the feature bus keep their pinned tier', () => {
        expect(skipped).toEqual(EXPECTED_NON_BUS_ROUTES)
    })

    it('only the pinned routes skip the access-expiry check', () => {
        expect(allowExpired).toEqual(EXPECTED_ALLOW_EXPIRED_ACCESS)
    })

    it('only the pinned routes stay open in a suspended club', () => {
        expect(allowSuspended.sort()).toEqual(EXPECTED_ALLOW_SUSPENDED)
    })

    it('only the pinned user-level routes accept X-Act-As', () => {
        expect(actAsAllowed.map((r) => r.where).sort()).toEqual(
            [...EXPECTED_ACT_AS_ALLOWED].sort(),
        )
    })

    it('no @ActAsAllowed route carries a staff tier', () => {
        expect(actAsAllowed.filter((r) => r.tier !== null)).toEqual([])
    })

    // AuthGuard reads the handler only, like @AllowExpiredAccess.
    it('@ActAsAllowed comes after the class line and the first HTTP decorator', () => {
        const bad = files
            .filter((f) => f.endsWith('.controller.ts'))
            .filter((f) => {
                const src = readFileSync(f, 'utf8')
                const at = src.indexOf('@ActAsAllowed(')
                if (at === -1) return false
                const firstHttp = src.search(HTTP)
                const classAt = src.search(/export class /)
                return at < classAt || at < firstHttp
            })
        expect(bad.map((f) => relative(FEATURES_DIR, f))).toEqual([])
    })

    // The guard reads the handler only, so a class-level or first-route-hoisted
    // decorator would be silently inert (or look like it covers more than it does).
    it('@AllowExpiredAccess comes after the class line and the first HTTP decorator', () => {
        const bad = files
            .filter((f) => f.endsWith('.controller.ts'))
            .filter((f) => {
                const src = readFileSync(f, 'utf8')
                const at = src.indexOf('@AllowExpiredAccess(')
                if (at === -1) return false
                const firstHttp = src.search(HTTP)
                const classAt = src.search(/export class /)
                return at < classAt || at < firstHttp
            })
        expect(bad.map((f) => relative(FEATURES_DIR, f))).toEqual([])
    })

    it('no route declares more than one @Roles', () => {
        expect(multiRoles).toEqual([])
    })

    // A direction manager is a coach plus DirectionManager rows; RoleGuard must
    // let the coach through for the direction rule in the handler to decide.
    it('Rule C: handlers gated by the direction rule sit behind COACHING_ROLES', () => {
        const bad = routes.filter(
            (r) => r.hasDirectionCheck && r.tier !== 'COACHING_ROLES',
        )
        expect(bad.map((r) => `${r.where} (tier ${r.tier})`)).toEqual([])
        // real count: ladders/levels 7, gradings 9, promotions/roster/member ranks 4,
        // achievements 6, announcements 4, events 3, tariffs 3, course audience 1, update-group 1
        expect(routes.filter((r) => r.hasDirectionCheck).length).toBeGreaterThanOrEqual(38)
    })

    it('every route resolves to a handler source', () => {
        const orphans = routes.filter((r) => !handlerByFeature.has(r.feature))
        expect(orphans.map((r) => r.where)).toEqual([])
    })

    it('Rule A: handlers that call assertWorkspaceAdmin sit behind WORKSPACE_ADMINS', () => {
        const bad = routes.filter(
            (r) => r.hasCheck && r.tier !== 'WORKSPACE_ADMINS',
        )
        expect(bad.map((r) => `${r.where} (tier ${r.tier})`)).toEqual([])
    })

    it('Rule B: WORKSPACE_ADMINS routes have the check or are a frozen exception', () => {
        const bad = routes.filter(
            (r) =>
                r.tier === 'WORKSPACE_ADMINS' &&
                !r.hasCheck &&
                !RULE_B_EXCEPTIONS.includes(r.feature),
        )
        expect(bad.map((r) => r.where)).toEqual([])
    })

    it('Rule B exceptions still lack the check (list can only shrink)', () => {
        const stale = RULE_B_EXCEPTIONS.filter((f) =>
            handlerByFeature.get(f)?.includes('assertWorkspaceAdmin('),
        )
        expect(RULE_B_EXCEPTIONS).toHaveLength(5)
        expect(stale).toEqual([])
        expect(
            RULE_B_EXCEPTIONS.filter((f) => !handlerByFeature.has(f)),
        ).toEqual([])
    })

    // @RequiresFeature only marks a route; FeatureEnabledGuard is what enforces
    // it. A controller with one and not the other is silently unprotected.
    it('every @RequiresFeature controller uses FeatureEnabledGuard after WorkspaceMemberGuard', () => {
        const bad = files
            .filter((f) => f.endsWith('.controller.ts'))
            .filter((f) => {
                const src = readFileSync(f, 'utf8')
                const marked = src.includes('@RequiresFeature(')
                const guards = [...src.matchAll(/@UseGuards\(([^)]*)\)/g)].map(
                    (m) => m[1],
                )
                const guarded = guards.some(
                    (g) =>
                        g.indexOf('WorkspaceMemberGuard') !== -1 &&
                        g.indexOf('FeatureEnabledGuard') >
                            g.indexOf('WorkspaceMemberGuard'),
                )
                return marked !== guards.some((g) => g.includes('FeatureEnabledGuard')) ||
                    (marked && !guarded)
            })
        expect(bad.map((f) => relative(FEATURES_DIR, f))).toEqual([])
    })
})
