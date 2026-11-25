import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'

// Static guard: the @Roles tier on a route must agree with the authorization
// check inside its handler. A handler that calls assertClubAdmin() can never
// be passed by a head coach, so the route must say CLUB_ADMINS; one that calls
// assertSportLead() can never be passed by a coach, so it must say SPORT_LEADS.

const FEATURES_DIR = join(__dirname, '..', '..', 'features')

// The assert each admin tier pairs with.
const TIER_CHECK = {
    CLUB_ADMINS: 'assertClubAdmin(',
    SPORT_LEADS: 'assertSportLead(',
} as const
type AdminTier = keyof typeof TIER_CHECK

// Routes behind an admin tier whose handler has no tier assert (the @Roles
// tier itself is the gate, or the handler gates another way). Frozen: this
// list may only shrink.
const RULE_B_EXCEPTIONS: Record<string, AdminTier> = {
    CreateGymFeature: 'SPORT_LEADS',
    DeleteGymFeature: 'SPORT_LEADS',
    UpdateGymFeature: 'SPORT_LEADS',
    UpdateMemberNotesFeature: 'SPORT_LEADS',
    ListRolesFeature: 'CLUB_ADMINS',
    // ИИ-токены: resolveAiAccess + assertAiTokenManager — the creator's role
    // is re-read on every MCP call, so the gate lives with the token access.
    ListAiTokensFeature: 'CLUB_ADMINS',
    CreateAiTokenFeature: 'CLUB_ADMINS',
    RevokeAiTokenFeature: 'CLUB_ADMINS',
}

// Controller methods allowed to carry @AllowExpiredAccess (they skip the
// accessUntil check in WorkspaceMemberGuard). Keep it to what the lock screen
// needs; do not let it spread.
const EXPECTED_ALLOW_EXPIRED_ACCESS = [
    'club-about/club-about.controller.ts getClubAbout',
    // Member autopay after access ran out (docs/design/2026-11-15-member-autopay.md
    // §3.5): refusing must always work (376-ФЗ); accepting new terms is how a
    // lapsed member's renewal (and access) comes back.
    'member-autopay/my-autopays.controller.ts listMyAutopays',
    'member-autopay/my-autopays.controller.ts cancelMyAutopay',
    'member-autopay/my-autopays.controller.ts acceptMyAutopayTerms',
    // «Оплатить онлайн» on the lock screen: paying is how access comes back.
    'online-payments/my-payments.controller.ts getOnlinePurchaseOptions',
    'online-payments/my-payments.controller.ts getCheckoutQuote',
    'online-payments/my-payments.controller.ts getMyPayment',
    'online-payments/payments.controller.ts createPayment',
]

// Controller methods allowed to carry @AllowSuspendedWorkspace (they stay open
// in a suspended club). Only what the admin needs to show the state and get
// the club paid for — and a member's refusal of autopay (376-ФЗ: the club's
// suspension never blocks it; the charge job skips suspended clubs).
const EXPECTED_ALLOW_SUSPENDED = [
    'club-legal/workspace-legal.controller.ts acceptWorkspaceLegal',
    'get-my-workspace-membership/get-my-workspace-membership.controller.ts getMyMembership',
    'member-autopay/my-autopays.controller.ts cancelMyAutopay',
    'member-autopay/my-autopays.controller.ts listMyAutopays',
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
    'bookmark-reviews/review-my-bookmark.controller.ts reviewMyBookmark',
    'export-my-data/export-my-data.controller.ts exportMyData',
    'get-me/get-me.controller.ts getMe',
    'get-my-workspaces/get-my-workspaces.controller.ts getMyWorkspaces',
    'get-video-playback/get-video-playback.controller.ts getPlayback',
    'get-web-playback/get-web-playback.controller.ts getWebPlayback',
    'join-workspace/join-workspace.controller.ts joinWorkspaceByCode',
    'join-workspace/list-my-join-requests.controller.ts listMyJoinRequests',
    'manage-my-video-bookmarks/my-video-bookmarks.controller.ts listMyVideoBookmarks',
    'manage-my-video-bookmarks/my-video-bookmarks.controller.ts putMyVideoBookmark',
    'manage-my-video-note/my-video-note.controller.ts getMyVideoNote',
    'manage-my-video-note/my-video-note.controller.ts putMyVideoNote',
    'my-agenda/my-agenda.controller.ts getMyAgenda',
    'my-memberships/my-memberships.controller.ts updateMembershipNotifications',
    'save-video-progress/save-video-progress.controller.ts save',
    'set-video-favorite/set-video-favorite.controller.ts setFavorite',
]

const EXPECTED_NON_BUS_ROUTES: Record<string, string | null> = {
    'data-export/export.controller.ts members': 'CLUB_ADMINS',
    'data-export/export.controller.ts renewals': 'CLUB_ADMINS',
    'data-export/export.controller.ts attendance': 'CLUB_ADMINS',
    'data-export/export.controller.ts payments': 'CLUB_ADMINS',
    'data-export/export.controller.ts payroll': 'CLUB_ADMINS',
    'data-export/export.controller.ts leads': 'CLUB_ADMINS',
    'get-video-manifest/get-video-manifest.controller.ts getManifest': null,
    'health/health.controller.ts ?': null,
    'health/health.controller.ts readyz': null,
    // ИИ-ассистент MCP transport: club token auth inside McpServerService.
    'mcp/mcp.controller.ts handleMcpPost': null,
    'mcp/mcp.controller.ts handleMcpGet': null,
    'mcp/mcp.controller.ts handleMcpDelete': null,
    // «Разбор видео» HLS proxy: playback token + member/staff re-check inside.
    'video-reviews/review-clip-manifest.controller.ts getReviewClipManifest': null,
}

const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
        const full = join(dir, name)
        return statSync(full).isDirectory() ? walk(full) : [full]
    })

const files = walk(FEATURES_DIR).filter((f) => !f.endsWith('.spec.ts'))

// Feature → the source of its own handler class (from its @Feature decorator
// to the next one), so a file holding several handlers is judged per handler.
const handlerByFeature = new Map<string, string>()
for (const file of files.filter((f) => f.endsWith('.handler.ts'))) {
    const src = readFileSync(file, 'utf8')
    const marks = [...src.matchAll(/@Feature\((\w+)\)/g)]
    marks.forEach((m, i) => {
        const start = m.index as number
        handlerByFeature.set(m[1], src.slice(start, marks[i + 1]?.index ?? src.length))
    })
}

// The admin tier the handler itself enforces. A sport-lead assert wins: such a
// handler may additionally refuse a sport lead for some inputs (a staff role),
// but the route must still let the sport lead in.
const checkOf = (handler: string | undefined): AdminTier | null => {
    if (!handler) return null
    if (handler.includes(TIER_CHECK.SPORT_LEADS)) return 'SPORT_LEADS'
    if (handler.includes(TIER_CHECK.CLUB_ADMINS)) return 'CLUB_ADMINS'
    return null
}

interface Route {
    where: string
    tier: string | null
    feature: string
    check: AdminTier | null
    // Calls the direction rule (assertCanManageDirection / assertManagesDirections)
    // without a tier assert: a direction manager — a coach — must reach it.
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
// Federation hub org console (docs/design/2026-11-26-federation-hub-mvp.md
// §3.2): @OrgRoles on every route behind OrganizationMemberGuard.
const orgRoutes: {
    where: string
    orgTier: string | null
    orgTierCount: number
    handler: string | undefined
    memberGuarded: boolean
}[] = []
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
        const orgOwn = [...chunk.matchAll(/@OrgRoles\((\w+)\)/g)]
        const memberGuarded = /@UseGuards\([^)]*OrganizationMemberGuard/.test(src)
        if (memberGuarded || orgOwn.length > 0) {
            orgRoutes.push({
                where: `${relative(FEATURES_DIR, file)}:${line} ${method}`,
                orgTier: orgOwn[0]?.[1] ?? null,
                orgTierCount: orgOwn.length,
                handler: feature ? handlerByFeature.get(feature) : undefined,
                memberGuarded,
            })
        }
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
        const check = checkOf(handler)
        routes.push({
            where: `${relative(FEATURES_DIR, file)}:${line} ${method} → ${feature}`,
            tier: own.length === 1 ? own[0][1] : classTier,
            feature,
            check,
            hasDirectionCheck:
                !!handler &&
                check === null &&
                (handler.includes('assertCanManageDirection(') ||
                    handler.includes('assertManagesDirections(')),
        })
    })
}

// Money and system (docs/design/2026-11-08-admin-cleanup.md §1): every feature
// behind CLUB_ADMINS. Pinned so a route cannot slide back to the head coach
// (SPORT_LEADS) or open wider without this list changing in review.
const EXPECTED_CLUB_ADMIN_FEATURES = [
    'AcceptOrganizationInviteFeature',
    'AcceptWorkspaceLegalFeature',
    'AddPayrollAdjustmentFeature',
    'ApplyClubImportFeature',
    'AssignDirectionManagerFeature',
    'CheckPaymentConnectionFeature',
    'ClosePayrollMonthFeature',
    'CreateAiTokenFeature',
    'CreateClubLogoUploadFeature',
    'CreateDirectionFeature',
    'CreateDiscountFeature',
    'CreatePlanFeature',
    'CreateRefundFeature',
    'DeclineOrganizationInviteFeature',
    'DeleteDirectionFeature',
    'DeleteDiscountFeature',
    'DeletePaymentSettingsFeature',
    'DeletePayrollAdjustmentFeature',
    'DeletePlanFeature',
    'DeleteRefundFeature',
    'GetClubImportFeature',
    'GetClubImportTemplateFeature',
    'GetClubPublicProfileFeature',
    'GetPaymentJournalEntryFeature',
    'GetPaymentSettingsFeature',
    'GetPayrollMonthFeature',
    'GetPlanFeature',
    'GetRevenueForecastFeature',
    'GetWorkspaceBillingFeature',
    'GetWorkspaceBillingPaymentFeature',
    'GetWorkspaceOnboardingFeature',
    'GetWorkspaceOnboardingHelpFeature',
    'LeaveOrganizationFeature',
    'ListAiTokensFeature',
    'ListAuditEventsFeature',
    'ListClubImportRowsFeature',
    'ListClubOrganizationsFeature',
    'ListCoachRatesFeature',
    'ListDirectionManagersFeature',
    'ListDiscountsFeature',
    'ListPaymentJournalFeature',
    'ListPayrollClassesFeature',
    'ListRolesFeature',
    'ListWorkspaceBillingPaymentsFeature',
    'PreviewClubImportFeature',
    'RemoveDirectionManagerFeature',
    'RemoveWorkspaceBillingCardFeature',
    'ReopenPayrollMonthFeature',
    'RequestWorkspaceOnboardingHelpFeature',
    'RevokeAiTokenFeature',
    'SetCoachRateFeature',
    'SetWorkspaceBillingModuleFeature',
    'SetWorkspaceBillingPeriodFeature',
    'StartWorkspaceBillingCardCheckFeature',
    'StartWorkspaceBillingCheckoutFeature',
    'UpdateClubAboutFeature',
    'UpdateClubPublicProfileFeature',
    'UpdateDirectionFeature',
    'UpdateDiscountFeature',
    'UpdateMemberRoleFeature',
    'UpdateOrganizationSharingFeature',
    'UpdatePaymentSettingsFeature',
    'UpdatePlanFeature',
    'UpdateWorkspaceSettingsFeature',
    'UploadClubImportFeature',
]

describe('route tier consistency', () => {
    it('scans enough routes to be meaningful', () => {
        expect(routes.length).toBeGreaterThanOrEqual(204) // real count (+ club-about GET/PUT, + 11 rank-grading/readiness/progress routes, + 5 freeze-request routes, + 5 autopay routes)
        // real counts: 46 money/system routes assert CLUB_ADMINS (+ 3 AI-token
        // and the role list gated otherwise); 19 roster/ops routes SPORT_LEADS
        expect(routes.filter((r) => r.check === 'CLUB_ADMINS').length).toBeGreaterThanOrEqual(46)
        expect(routes.filter((r) => r.check === 'SPORT_LEADS').length).toBeGreaterThanOrEqual(19)
    })

    it('money and system routes are exactly the pinned CLUB_ADMINS set', () => {
        expect(
            [...new Set(routes.filter((r) => r.tier === 'CLUB_ADMINS').map((r) => r.feature))].sort(),
        ).toEqual(EXPECTED_CLUB_ADMIN_FEATURES)
    })

    // Discounts (docs/design/2026-11-15-discounts.md §3.7): definitions are
    // club money (pinned above); the sale form's options go with selling
    // (every coaching role); the member's checkout quote is a member route
    // (no @Roles, act-as accepted like checkout).
    it('discount routes keep their tiers', () => {
        const routeOf = (feature: string) => routes.find((r) => r.feature === feature)
        expect(routeOf('ListSaleDiscountsFeature')?.tier).toBe('COACHING_ROLES')
        expect(handlerByFeature.has('GetCheckoutQuoteFeature')).toBe(true)
        expect(routeOf('GetCheckoutQuoteFeature')).toBeDefined()
        expect(routeOf('GetCheckoutQuoteFeature')?.tier).toBeNull()
    })

    // «Сообщения» (docs/design/2026-11-26-broadcast-and-direct-messages.md
    // §4.3): every coach writes to own students, so the staff routes are
    // COACHING_ROLES; «Продлить», «Не оплатили» and «служебное» are sport-lead
    // branches inside (features/club-messages/compose.ts, outside the handler
    // source Rule A reads — pinned here instead). The member's own routes have
    // no @Roles (X-Act-As accepted).
    it('club message routes keep their tiers and the sport-lead branches', () => {
        const tierOf = (feature: string) => routes.find((r) => r.feature === feature)?.tier
        for (const feature of [
            'PreviewClubMessageFeature',
            'SendClubMessageFeature',
            'ListClubMessagesFeature',
            'GetClubMessageFeature',
            'ListClubMessageRecipientsFeature',
            'CancelClubMessageFeature',
        ]) {
            expect(tierOf(feature)).toBe('COACHING_ROLES')
        }
        for (const feature of [
            'ListMyClubMessagesFeature',
            'GetMyClubMessageFeature',
            'MarkClubMessageReadFeature',
        ]) {
            expect(routes.some((r) => r.feature === feature)).toBe(true)
            expect(tierOf(feature)).toBeNull()
        }
        const compose = readFileSync(join(FEATURES_DIR, 'club-messages', 'compose.ts'), 'utf8')
        expect(compose.match(/assertSportLead\(/g)).toHaveLength(2)
        expect(compose).toContain('resolveCoachScope(')
    })

    // «Выплаты тренерам» (docs/design/2026-11-26-coach-payroll.md §3.3): the
    // month, rates, adjustments, close and reopen are club money (pinned
    // above); the coach's own closed months are a coach-scope staff read.
    it('payroll routes keep their tiers', () => {
        const routeOf = (feature: string) => routes.find((r) => r.feature === feature)
        expect(routeOf('GetMyPayrollFeature')?.tier).toBe('STAFF_ROLES')
        expect(handlerByFeature.get('GetMyPayrollFeature')).toContain('resolveCoachScope(')
    })

    // «Пробные» (docs/design/2026-11-26-leads.md §3.4): every staff route is
    // the roster tier with the handler's assertSportLead (strangers' phones);
    // the public form is unguarded like public/demo-requests.
    it('leads routes keep their tiers', () => {
        const leadFeatures = [
            'ListLeadsFeature',
            'GetLeadFeature',
            'CreateLeadFeature',
            'UpdateLeadFeature',
            'SetLeadStatusFeature',
            'LinkLeadMemberFeature',
            'EraseLeadFeature',
            'GetLeadConversionReportFeature',
            'GetTrialLinkFeature',
        ]
        for (const feature of leadFeatures) {
            const route = routes.find((r) => r.feature === feature)
            expect({ feature, tier: route?.tier, check: route?.check }).toEqual({
                feature,
                tier: 'SPORT_LEADS',
                check: 'SPORT_LEADS',
            })
        }
        const tierOf = (feature: string) => routes.find((r) => r.feature === feature)?.tier
        expect(routes.some((r) => r.feature === 'CreatePublicTrialRequestFeature')).toBe(true)
        expect(tierOf('CreatePublicTrialRequestFeature')).toBeNull()
        expect(tierOf('GetPublicTrialFormFeature')).toBeNull()
    })

    // Member autopay (docs/design/2026-11-15-member-autopay.md §3.5): the
    // member's own routes carry no @Roles; staff read and cancel (at the
    // member's request) are the sport side.
    it('autopay routes keep their tiers', () => {
        const tierOf = (feature: string) => routes.find((r) => r.feature === feature)?.tier
        for (const feature of [
            'ListMyAutopaysFeature',
            'CancelMyAutopayFeature',
            'AcceptMyAutopayTermsFeature',
        ]) {
            expect(routes.some((r) => r.feature === feature)).toBe(true)
            expect(tierOf(feature)).toBeNull()
        }
        expect(tierOf('ListMemberAutopaysFeature')).toBe('SPORT_LEADS')
        expect(tierOf('CancelMemberAutopayFeature')).toBe('SPORT_LEADS')
    })

    // Federation hub (docs/design/2026-11-26-federation-hub-mvp.md §3.2): an
    // org console route carries exactly one @OrgRoles tier and its handler
    // repeats that tier — ORG_ADMINS ↔ assertOrgAdmin, ORG_STAFF ↔
    // assertOrgStaff (an org coach would otherwise see a button and get 403,
    // or pass a gate meant for admins).
    describe('org console tiers', () => {
        const ORG_TIER_CHECK: Record<string, string> = {
            ORG_ADMINS: 'assertOrgAdmin(',
            ORG_STAFF: 'assertOrgStaff(',
        }

        it('scans the org console', () => {
            expect(orgRoutes.filter((r) => r.memberGuarded).length).toBeGreaterThanOrEqual(10)
        })

        it('every route behind OrganizationMemberGuard has exactly one known @OrgRoles', () => {
            const bad = orgRoutes.filter(
                (r) =>
                    r.orgTierCount !== 1 ||
                    r.orgTier === null ||
                    !(r.orgTier in ORG_TIER_CHECK) ||
                    !r.memberGuarded,
            )
            expect(bad.map((r) => `${r.where} (${r.orgTier}×${r.orgTierCount})`)).toEqual([])
        })

        it('the handler asserts the route tier and not the other one', () => {
            const bad = orgRoutes.filter((r) => {
                if (!r.orgTier || !r.handler) return true
                const own = ORG_TIER_CHECK[r.orgTier]
                const other = Object.values(ORG_TIER_CHECK).find((c) => c !== own) as string
                return !r.handler.includes(own) || r.handler.includes(other)
            })
            expect(bad.map((r) => `${r.where} (${r.orgTier})`)).toEqual([])
        })

        // ORGANIZATIONS_ENABLED off = 404 before anything else runs.
        it('every federation controller starts with OrganizationsEnabledGuard', () => {
            const bad = files
                .filter((f) => f.endsWith('.controller.ts'))
                .filter((f) => /^(organizations|club-organizations)\//.test(relative(FEATURES_DIR, f)))
                .filter((f) => {
                    const guards = readFileSync(f, 'utf8').match(/@UseGuards\(\s*(\w+)/)
                    return guards?.[1] !== 'OrganizationsEnabledGuard'
                })
            expect(bad.map((f) => relative(FEATURES_DIR, f))).toEqual([])
        })

        it('club-side federation decisions stay club money-and-system routes', () => {
            const tierOf = (feature: string) => routes.find((r) => r.feature === feature)?.tier
            for (const feature of [
                'ListClubOrganizationsFeature',
                'AcceptOrganizationInviteFeature',
                'DeclineOrganizationInviteFeature',
                'UpdateOrganizationSharingFeature',
                'LeaveOrganizationFeature',
            ]) {
                expect({ feature, tier: tierOf(feature) }).toEqual({ feature, tier: 'CLUB_ADMINS' })
            }
        })
    })

    it('no route uses a removed tier name', () => {
        const known = new Set([null, 'STAFF_ROLES', 'COACHING_ROLES', 'SPORT_LEADS', 'CLUB_ADMINS'])
        expect(routes.filter((r) => !known.has(r.tier)).map((r) => `${r.where} (tier ${r.tier})`)).toEqual([])
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
        // real count: ladders/levels 7, gradings 9, member ranks 2,
        // achievements 6, announcements 4, events 3, course audience 1, update-group 1
        // (tariffs left the direction rule: they are CLUB_ADMINS now)
        expect(routes.filter((r) => r.hasDirectionCheck).length).toBeGreaterThanOrEqual(33)
    })

    it('every route resolves to a handler source', () => {
        const orphans = routes.filter((r) => !handlerByFeature.has(r.feature))
        expect(orphans.map((r) => r.where)).toEqual([])
    })

    it('Rule A: a handler that asserts a tier sits behind exactly that tier', () => {
        const bad = routes.filter((r) => r.check !== null && r.tier !== r.check)
        expect(bad.map((r) => `${r.where} (tier ${r.tier}, check ${r.check})`)).toEqual([])
    })

    it('Rule B: admin-tier routes have their assert or are a frozen exception', () => {
        const bad = routes.filter(
            (r) =>
                (r.tier === 'CLUB_ADMINS' || r.tier === 'SPORT_LEADS') &&
                r.check === null &&
                RULE_B_EXCEPTIONS[r.feature] !== r.tier,
        )
        expect(bad.map((r) => `${r.where} (tier ${r.tier})`)).toEqual([])
    })

    it('Rule B exceptions still lack the check (list can only shrink)', () => {
        const names = Object.keys(RULE_B_EXCEPTIONS)
        expect(names).toHaveLength(8)
        expect(names.filter((f) => checkOf(handlerByFeature.get(f)) !== null)).toEqual([])
        expect(names.filter((f) => !handlerByFeature.has(f))).toEqual([])
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
