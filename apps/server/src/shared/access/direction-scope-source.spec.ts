import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'

// Static guard for руководители направлений: a direction manager may write only
// the entities of the directions they run. That rule lives in one place,
// RbacService (assertCanManageDirection; group writes reach it through
// assertCanWriteGroup / assertCanCreateGroupAs). A handler that writes a
// direction-owned entity behind another check would let a БЖЖ manager edit
// ММА — or let a coach in where only admins belonged.

const FEATURES_DIR = join(__dirname, '..', '..', 'features')

const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
        const full = join(dir, name)
        return statSync(full).isDirectory() ? walk(full) : [full]
    })

// Comments may quote the patterns while explaining them.
const code = (file: string) =>
    readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1')

const handlers = walk(FEATURES_DIR)
    .filter((f) => f.endsWith('.handler.ts'))
    .map((f) => ({ where: relative(FEATURES_DIR, f), src: code(f) }))

const featureSource = (feature: string) =>
    handlers.find((h) => h.src.includes(`@Feature(${feature})`))?.src

const DIRECTION_RULE = 'assertCanManageDirection('
const DIRECTION_LIST_GATE = 'assertManagesDirections('
const GROUP_RULES = ['assertCanWriteGroup(', 'assertCanCreateGroupAs(']

// Writes to direction-owned entities (or their children). Each must call the
// shared direction rule itself.
const DIRECTION_WRITES = [
    'CreateLadderFeature',
    'UpdateLadderFeature',
    'DeleteLadderFeature',
    'CreateLevelFeature',
    'UpdateLevelFeature',
    'DeleteLevelFeature',
    'CreateRankGradingFeature',
    'UpdateRankGradingFeature',
    'DeleteRankGradingFeature',
    'AddRankGradingCandidatesFeature',
    'UpdateRankGradingCandidateFeature',
    'RemoveRankGradingCandidateFeature',
    'RecordRankGradingResultsFeature',
    'PromoteMemberFeature',
    'PromoteMembersFeature',
    'CreateAchievementFeature',
    'UpdateAchievementFeature',
    'DeleteAchievementFeature',
    'ReorderAchievementsFeature',
    'SeedDefaultAchievementsFeature',
    'CreateAnnouncementFeature',
    'UpdateAnnouncementFeature',
    'DeleteAnnouncementFeature',
    'CreateWorkspaceEventFeature',
    'UpdateWorkspaceEventFeature',
    'DeleteWorkspaceEventFeature',
    'CreatePlanFeature',
    'UpdatePlanFeature',
    'DeletePlanFeature',
    'UpdateCourseAudienceFeature',
    // A group's coach keeps their rights; a manager moving it is held to the
    // target direction.
    'UpdateGroupFeature',
]

// Admin-side screens opened to managers: filtered to their directions.
const DIRECTION_LISTS = [
    'ListLaddersFeature',
    'ListRankGradingsFeature',
    'ListAchievementsFeature',
    'ListAnnouncementsFeature',
    'GetMemberRanksFeature',
]

// Models whose rows carry a direction, directly or through a parent.
const DIRECTION_OWNED_WRITE =
    /\.(?:group|groupSlot|groupException|groupCoach|rankLadder|rankLevel|rankGrading|rankGradingCandidate|rankPromotion|achievement|plan|workspaceEvent|announcement|courseAudience)\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\(/

// Writes to those models that are not direction management: admin-only club
// tools, member self-service and side effects of another authorized action.
const OTHER_GATES = [
    'assertWorkspaceAdmin(',
    'assertPlatformAdmin(',
]
const NOT_DIRECTION_MANAGEMENT: string[] = []

describe('direction-owned writes go through the direction rule', () => {
    it('every pinned direction write calls assertCanManageDirection', () => {
        const missing = DIRECTION_WRITES.filter(
            (f) => !featureSource(f)?.includes(DIRECTION_RULE),
        )
        expect(missing).toEqual([])
    })

    it('no pinned direction write or list is still admin-only', () => {
        const adminOnly = [...DIRECTION_WRITES, ...DIRECTION_LISTS].filter((f) =>
            featureSource(f)?.includes('assertWorkspaceAdmin('),
        )
        expect(adminOnly).toEqual([])
    })

    it('every pinned direction list filters by the caller directions', () => {
        const missing = DIRECTION_LISTS.filter(
            (f) => !featureSource(f)?.includes(DIRECTION_LIST_GATE),
        )
        expect(missing).toEqual([])
    })

    it('every handler writing a direction-owned model has a gate', () => {
        const ungated = handlers
            .filter((h) => DIRECTION_OWNED_WRITE.test(h.src))
            .filter(
                (h) =>
                    ![DIRECTION_RULE, ...GROUP_RULES, ...OTHER_GATES].some((g) =>
                        h.src.includes(g),
                    ),
            )
            .map((h) => h.where)
            .filter((w) => !NOT_DIRECTION_MANAGEMENT.includes(w))
        expect(ungated).toEqual([])
    })

    it('the exception list holds only real handlers', () => {
        expect(
            NOT_DIRECTION_MANAGEMENT.filter(
                (w) => !handlers.some((h) => h.where === w),
            ),
        ).toEqual([])
    })
})
