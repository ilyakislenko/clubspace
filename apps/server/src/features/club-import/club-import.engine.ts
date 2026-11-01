import { Injectable, Logger } from '@nestjs/common'

import { AuditService } from '../../domains/audit/services/audit.service'
import { NotificationProducerService } from '../../domains/notifications/services/notification-producer.service'
import { RankService } from '../../domains/ranks/services/rank.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import {
    sameScope,
    scopeDirectionIds,
    scopeSnapshotCreate,
    subscriptionScopeIdsSelect,
} from '../../domains/subscriptions/current-subscriptions'
import { isSubscriptionUsable } from '../../domains/subscriptions/subscription-status'
import {
    placeInGroup,
    WorkspaceInvitationService,
} from '../../domains/workspace/services/workspace-invitation.service'
import {
    PrismaService,
    type PrismaTransactionClientType,
} from '../../infrastructure/prisma'
import { localDateInTz, wallClockToUtc } from '../attendance/attendance-utils'
import { dateOfBirthToDate } from '../dependents/dependents-utils'
import {
    ClubImportCatalog,
    type CatalogDirection,
    type CatalogGroup,
    type CatalogGym,
    type CatalogLadder,
    type CatalogLevel,
    type CatalogPlan,
    type CreateSpec,
    MISSING_KIND,
    type Resolved,
} from './club-import-catalog'
import type { ClubImportMapping } from './club-import-fields'
import { type ClubImportRecord, readRecord } from './club-import-record'
import type {
    ClubImportMissing,
    ClubImportRowResult,
    ClubImportSummary,
} from './schemas'

export type ClubImportMode = 'preview' | 'apply'

const DAY = 24 * 60 * 60 * 1000
// Progress is written every CHUNK rows: often enough for the bar to move,
// rarely enough not to cost a write per row.
const CHUNK = 50

const shiftYmd = (ymd: string, days: number): string =>
    new Date(Date.parse(`${ymd}T00:00:00Z`) + days * DAY)
        .toISOString()
        .slice(0, 10)

// YYYY-MM-DD → «31.12.2025», the way the file writes it.
const ruDay = (ymd: string): string => ymd.split('-').reverse().join('.')

const ymdOf = (d: Date | null): string | null =>
    d ? d.toISOString().slice(0, 10) : null

const fullName = (first: string | null, last: string | null) =>
    [last, first].filter(Boolean).join(' ')

const USER_SELECT = {
    id: true,
    email: true,
    status: true,
    firstname: true,
    lastname: true,
    dateOfBirth: true,
    phone: true,
} as const

type UserRow = {
    id: string
    email: string | null
    status: string
    firstname: string | null
    lastname: string | null
    dateOfBirth: Date | null
    phone: string | null
}

type SubRef = {
    planId: string
    planName: string
    // Direction set of the abonement (empty = club-wide).
    scope: string[]
    startDay: string | null
    endDay: string | null
    usable: boolean
}

// A club member as this run knows it: loaded from the database on first
// sight, or created by an earlier row. Later rows for the same person (one
// line per direction is common) see what earlier rows added.
type MemberState = {
    kind: 'member'
    // Placeholders until a new person is written (and for good in a dry run).
    userId: string
    memberId: string
    isNew: boolean
    // The account to create on the first row of a new person; null after.
    pendingCreate: {
        email: string | null
        firstname: string | null
        lastname: string | null
        dateOfBirth: string | null
        phone: string | null
    } | null
    // The file's phone belongs to someone else's account (not stored).
    phoneTaken: boolean
    isDependent: boolean
    // Set when the member row is an applicant (INVITED) the import admits.
    activate: boolean
    firstname: string | null
    lastname: string | null
    dateOfBirth: string | null
    phone: string | null
    hasOtherClubs: boolean
    notes: string | null
    groupIds: Set<string>
    ranks: Map<string, { levelId: string; stripes: number }>
    subs: SubRef[]
    // E-mails of the dependent's guardians (confirmed or pending).
    guardianEmails: Set<string>
    line: number
}

type PersonOutcome =
    | { kind: 'member'; state: MemberState }
    | { kind: 'invite'; user: UserRow }
    | { kind: 'done'; action: 'skip' | 'error'; message: string }

type Op =
    | {
          type: 'createUser'
          email: string | null
          firstname: string | null
          lastname: string | null
          dateOfBirth: string | null
          phone: string | null
      }
    | { type: 'linkGuardian'; parentEmail: string }
    | { type: 'activate' }
    | {
          type: 'profile'
          data: {
              firstname?: string
              lastname?: string
              dateOfBirth?: Date
              phone?: string
          }
      }
    | { type: 'group'; group: CatalogGroup }
    | {
          type: 'rank'
          ladderId: string
          levelId: string
          stripes: number
          raiseMaxTo: number | null
      }
    | {
          type: 'subscription'
          plan: CatalogPlan
          startDate: Date
          endDate: Date
          expired: boolean
          paid: boolean
          classesTotal: number | null
          classesRemaining: number | null
      }
    | { type: 'notes'; notes: string }

type Refs = {
    gym: Resolved<CatalogGym> | null
    direction: Resolved<CatalogDirection> | null
    group: Resolved<CatalogGroup> | null
    plan: Resolved<CatalogPlan> | null
    level:
        | { existing: { ladder: CatalogLadder; level: CatalogLevel } }
        | { create: CreateSpec }
        | null
}

type RunContext = {
    importId: string
    mode: ClubImportMode
    workspace: { id: string; name: string; ownerId: string; timezone: string }
    actorId: string
    roleId: string
    createMissing: boolean
    overwrite: boolean
    now: Date
    today: string
    catalog: ClubImportCatalog
    // Rank levels this run created: their stripe cap follows the file.
    createdLevelIds: Set<string>
    // Run-level person cache: «e:<email>», «p:<phone>», «n:<name>|<dob>».
    persons: Map<string, MemberState | { kind: 'invited'; line: number }>
    // Parent accounts by e-mail (id null: none yet, the import creates it).
    parents: Map<string, { id: string | null; blocked: boolean }>
    phonesTaken: Set<string>
    missing: Record<keyof ClubImportMissing, Set<string>>
    summary: ClubImportSummary
    createdUserIds: string[]
    placeholderSeq: number
}

const emptySummary = (rows: number): ClubImportSummary => ({
    rows,
    create: 0,
    update: 0,
    invite: 0,
    skip: 0,
    error: 0,
    children: 0,
    groupMemberships: 0,
    subscriptions: 0,
    ranks: 0,
    createdGyms: 0,
    createdDirections: 0,
    createdGroups: 0,
    createdPlans: 0,
    createdRanks: 0,
})

const placeholder = (ctx: RunContext, kind: string) =>
    `new:${kind}:${++ctx.placeholderSeq}`

// Runs one «Импорт клуба» pass over the stored file. A preview and an apply
// go through the very same decisions; only apply writes (each row in its own
// transaction, so one bad row never half-imports a person). Matching makes a
// re-run of the same file a no-op: a person by e-mail, else phone, else
// name + date of birth; group places, ranks, abonements and notes are only
// added when missing (overwrite: names, birth date, notes, rank).
@Injectable()
export class ClubImportEngine {
    private readonly logger = new Logger(ClubImportEngine.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly ranks: RankService,
        private readonly invitations: WorkspaceInvitationService,
        private readonly notifications: NotificationProducerService,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async run(importId: string, mode: ClubImportMode, now = new Date()): Promise<void> {
        const job = await this.prisma.clubImport.findUnique({
            where: { id: importId },
        })
        if (!job) return
        const rows = job.rows as string[][]
        const mapping = (job.mapping ?? {}) as ClubImportMapping
        const ctx = await this.loadContext(job, mode, rows.length, now)
        const results: ClubImportRowResult[] = []

        for (let i = 0; i < rows.length; i++) {
            results.push(await this.processRow(ctx, i + 2, rows[i], mapping))
            if ((i + 1) % CHUNK === 0) {
                await this.prisma.clubImport.update({
                    where: { id: importId },
                    data: { processed: i + 1 },
                })
            }
        }

        const missing = Object.fromEntries(
            Object.entries(ctx.missing).map(([k, v]) => [k, [...v]]),
        ) as ClubImportMissing
        await this.prisma.clubImport.update({
            where: { id: importId },
            data: {
                status: mode === 'apply' ? 'APPLIED' : 'PREVIEWED',
                processed: rows.length,
                summary: ctx.summary,
                missing,
                rowResults: results,
                ...(mode === 'apply' ? { appliedAt: new Date() } : { previewedAt: new Date() }),
            },
        })

        if (mode === 'apply') {
            await this.audit.record({
                action: 'club.import',
                targetType: 'workspace',
                targetId: ctx.workspace.id,
                workspaceId: ctx.workspace.id,
                actorId: ctx.actorId,
                metadata: { importId, fileName: job.fileName, ...ctx.summary },
            })
            this.realtime.invalidate(ctx.workspace.id, [
                'members',
                'groups',
                'ranks',
                'subscription',
                'directions',
            ])
            this.realtime.joinWorkspaceRoom(ctx.createdUserIds, ctx.workspace.id)
        }
    }

    private async loadContext(
        job: {
            id: string
            workspaceId: string
            createdById: string | null
            createMissing: boolean
            overwrite: boolean
        },
        mode: ClubImportMode,
        rowCount: number,
        now: Date,
    ): Promise<RunContext> {
        const workspace = await this.prisma.workspace.findUniqueOrThrow({
            where: { id: job.workspaceId },
            select: { id: true, name: true, ownerId: true, timezone: true },
        })
        const role = await this.prisma.role.findUniqueOrThrow({
            where: { name: 'user' },
            select: { id: true },
        })
        const [gyms, directions, groups, plans, ladders] = await Promise.all([
            this.prisma.gym.findMany({
                where: { workspaceId: workspace.id },
                select: { id: true, name: true },
            }),
            this.prisma.direction.findMany({
                where: { workspaceId: workspace.id },
                select: { id: true, name: true },
                orderBy: { order: 'asc' },
            }),
            this.prisma.group.findMany({
                where: { workspaceId: workspace.id },
                select: { id: true, name: true, gymId: true, directionId: true, coachId: true },
            }),
            this.prisma.plan
                .findMany({
                    where: { workspaceId: workspace.id },
                    select: {
                        id: true,
                        name: true,
                        directions: { select: { directionId: true } },
                        price: true,
                        currency: true,
                        durationDays: true,
                        classCount: true,
                        isActive: true,
                    },
                    orderBy: { name: 'asc' },
                })
                .then((rows) =>
                    rows.map(({ directions: scope, ...p }) => ({
                        ...p,
                        directionIds: scope.map((d) => d.directionId),
                    })),
                ),
            this.prisma.rankLadder.findMany({
                where: { workspaceId: workspace.id },
                select: {
                    id: true,
                    name: true,
                    directionId: true,
                    audience: true,
                    levels: {
                        select: { id: true, name: true, order: true, maxStripes: true, isActive: true },
                        orderBy: { order: 'asc' },
                    },
                },
                orderBy: { order: 'asc' },
            }),
        ])
        return {
            importId: job.id,
            mode,
            workspace,
            actorId: job.createdById ?? workspace.ownerId,
            roleId: role.id,
            createMissing: job.createMissing,
            overwrite: job.overwrite,
            now,
            today: localDateInTz(now, workspace.timezone),
            catalog: new ClubImportCatalog({ gyms, directions, groups, plans, ladders }),
            createdLevelIds: new Set(),
            persons: new Map(),
            parents: new Map(),
            phonesTaken: new Set(),
            missing: {
                gyms: new Set(),
                directions: new Set(),
                groups: new Set(),
                plans: new Set(),
                ranks: new Set(),
            },
            summary: emptySummary(rowCount),
            createdUserIds: [],
            placeholderSeq: 0,
        }
    }

    private async processRow(
        ctx: RunContext,
        line: number,
        cells: string[],
        mapping: ClubImportMapping,
    ): Promise<ClubImportRowResult> {
        const { record, errors, warnings } = readRecord(cells, mapping, ctx.now)
        const result: ClubImportRowResult = {
            line,
            name: fullName(record.firstname, record.lastname) || record.email || '—',
            email: record.email,
            action: 'skip',
            changes: [],
            messages: [],
        }
        const finish = (action: ClubImportRowResult['action'], ...messages: string[]) => {
            result.action = action
            result.messages.push(...messages, ...warnings)
            ctx.summary[action]++
            return result
        }
        if (errors.length > 0) return finish('error', ...errors)

        const isChild = !record.email && !!record.parentEmail
        const refs = this.resolveRefs(ctx, record, isChild)
        if ('error' in refs) return finish('error', refs.error)
        const missing = this.missingSpecs(refs)
        for (const spec of missing) ctx.missing[MISSING_KIND[spec.kind]].add(spec.label)
        if (missing.length > 0 && !ctx.createMissing) {
            return finish(
                'skip',
                `Нет в клубе: ${missing.map((s) => s.label).join(', ')} — отметьте «Создать недостающие» или поправьте название`,
            )
        }

        let outcome: PersonOutcome
        try {
            outcome = await this.resolvePerson(ctx, record, line)
        } catch (e) {
            this.logger.error(e)
            return finish('error', 'Не удалось проверить строку')
        }
        if (outcome.kind === 'done') return finish(outcome.action, outcome.message)

        try {
            await this.materialize(ctx, refs, record)
        } catch (e) {
            this.logger.error(e)
            return finish('error', 'Не удалось создать группу, тариф или пояс для этой строки')
        }

        if (outcome.kind === 'invite') {
            return this.invite(ctx, outcome.user, record, refs, result, finish)
        }

        const state = outcome.state
        const { ops, changes, notes } = await this.plan(ctx, state, record, refs)
        warnings.push(...notes)
        result.changes.push(...changes)
        if (ops.length === 0) {
            return finish('skip', state.line < line ? `Без изменений (тот же человек, что в строке ${state.line})` : 'Без изменений')
        }
        if (ctx.mode === 'apply') {
            try {
                await this.execute(ctx, state, ops)
            } catch (e) {
                this.logger.error(e)
                this.forget(ctx, state)
                result.changes = []
                return finish('error', 'Не удалось сохранить строку — попробуйте ещё раз')
            }
        }
        this.count(ctx, ops)
        return finish(state.isNew && state.line === line ? 'create' : 'update')
    }

    private resolveRefs(
        ctx: RunContext,
        r: ClubImportRecord,
        isChild: boolean,
    ): Refs | { error: string } {
        const cat = ctx.catalog
        const gym = r.gym ? cat.resolveGym(r.gym) : null
        const direction = r.direction ? cat.resolveDirection(r.direction) : null
        let group: Refs['group'] = null
        if (r.group) {
            const g = cat.resolveGroup(r.group, gym, direction)
            if ('error' in g) return g
            group = g
        }
        const plan = r.plan ? cat.resolvePlan(r.plan, direction) : null
        let level: Refs['level'] = null
        if (r.rank) {
            const lv = cat.resolveLevel(r.rank, direction, isChild)
            if ('error' in lv) return lv
            level = lv
        }
        return { gym, direction, group, plan, level }
    }

    // Every entity the row needs created, the parents of a group or ladder
    // included (a new group in a new gym lists both).
    private missingSpecs(refs: Refs): CreateSpec[] {
        const specs: CreateSpec[] = []
        for (const ref of [refs.gym, refs.direction, refs.group, refs.plan, refs.level]) {
            if (ref && 'create' in ref) specs.push(ref.create)
        }
        return specs
    }

    // Creates what the row needs (or, in a dry run, reserves a placeholder),
    // once per name: the catalog learns it, so later rows find it.
    private async materialize(ctx: RunContext, refs: Refs, r: ClubImportRecord) {
        const apply = ctx.mode === 'apply'
        const ws = ctx.workspace.id
        const cat = ctx.catalog

        const gym = async (ref: Resolved<CatalogGym> | null): Promise<CatalogGym | null> => {
            if (!ref) return null
            if ('existing' in ref) return ref.existing
            const again = cat.resolveGym(ref.create.name)
            if ('existing' in again) return again.existing
            const row = apply
                ? await this.prisma.gym.create({
                      data: { workspaceId: ws, name: ref.create.name, address: '' },
                      select: { id: true, name: true },
                  })
                : { id: placeholder(ctx, 'gym'), name: ref.create.name }
            cat.data.gyms.push(row)
            ctx.summary.createdGyms++
            return row
        }
        const direction = async (
            ref: Resolved<CatalogDirection> | null,
        ): Promise<CatalogDirection | null> => {
            if (!ref) return null
            if ('existing' in ref) return ref.existing
            const again = cat.resolveDirection(ref.create.name)
            if ('existing' in again) return again.existing
            const row = apply
                ? await this.prisma.direction.create({
                      data: {
                          workspaceId: ws,
                          name: ref.create.name,
                          order: cat.data.directions.length,
                      },
                      select: { id: true, name: true },
                  })
                : { id: placeholder(ctx, 'direction'), name: ref.create.name }
            cat.data.directions.push(row)
            ctx.summary.createdDirections++
            return row
        }

        const g = await gym(refs.gym)
        const d = await direction(refs.direction)
        // Re-point the row's refs at what now exists (by name: a spec made
        // before an earlier row created it resolves the same way now).
        if (refs.gym) refs.gym = g ? { existing: g } : null
        if (refs.direction) refs.direction = d ? { existing: d } : null

        if (refs.group && 'create' in refs.group) {
            const again = cat.resolveGroup(r.group as string, refs.gym, refs.direction)
            if ('existing' in again) {
                refs.group = again
            } else {
                const data = {
                    workspaceId: ws,
                    name: r.group as string,
                    gymId: g?.id ?? null,
                    directionId: d?.id ?? null,
                    coachId: ctx.actorId,
                }
                const row: CatalogGroup = apply
                    ? await this.prisma.$transaction(async (tx) => {
                          const created = await tx.group.create({
                              data,
                              select: { id: true, name: true, gymId: true, directionId: true, coachId: true },
                          })
                          await tx.groupCoach.create({
                              data: { groupId: created.id, userId: ctx.actorId, role: 'primary' },
                          })
                          return created
                      })
                    : { id: placeholder(ctx, 'group'), ...data }
                cat.data.groups.push(row)
                ctx.summary.createdGroups++
                refs.group = { existing: row }
            }
        }

        if (refs.plan && 'create' in refs.plan) {
            const again = cat.resolvePlan(r.plan as string, refs.direction)
            if ('existing' in again) {
                refs.plan = again
            } else {
                const directionIds = d ? [d.id] : []
                const data = {
                    workspaceId: ws,
                    name: r.plan as string,
                    price: 0,
                    currency: cat.data.plans[0]?.currency ?? 'RUB',
                    durationDays: 30,
                    classCount: null,
                    isActive: true,
                }
                const row: CatalogPlan = apply
                    ? {
                          ...(await this.prisma.plan.create({
                              data: { ...data, directions: scopeSnapshotCreate(directionIds) },
                              select: {
                                  id: true,
                                  name: true,
                                  price: true,
                                  currency: true,
                                  durationDays: true,
                                  classCount: true,
                                  isActive: true,
                              },
                          })),
                          directionIds,
                      }
                    : { id: placeholder(ctx, 'plan'), ...data, directionIds }
                cat.data.plans.push(row)
                ctx.summary.createdPlans++
                refs.plan = { existing: row }
            }
        }

        if (refs.level && 'create' in refs.level) {
            const again = cat.resolveLevel(r.rank as string, refs.direction, !r.email && !!r.parentEmail)
            if ('existing' in again) {
                refs.level = again
            } else if ('create' in again && again.create.kind === 'level') {
                const spec = again.create
                let ladder = spec.ladder
                if (!ladder) {
                    const data = {
                        workspaceId: ws,
                        name: spec.ladderName,
                        directionId: d?.id ?? null,
                        order: cat.data.ladders.length,
                    }
                    ladder = apply
                        ? {
                              ...(await this.prisma.rankLadder.create({
                                  data,
                                  select: { id: true, name: true, directionId: true, audience: true },
                              })),
                              levels: [],
                          }
                        : { id: placeholder(ctx, 'ladder'), name: data.name, directionId: data.directionId, audience: null, levels: [] }
                    cat.data.ladders.push(ladder)
                }
                const order = Math.max(-1, ...ladder.levels.map((l) => l.order)) + 1
                const levelData = {
                    ladderId: ladder.id,
                    name: r.rank as string,
                    order,
                    maxStripes: r.stripes ?? 0,
                }
                const level: CatalogLevel = apply
                    ? await this.prisma.rankLevel.create({
                          data: levelData,
                          select: { id: true, name: true, order: true, maxStripes: true, isActive: true },
                      })
                    : { id: placeholder(ctx, 'level'), name: levelData.name, order, maxStripes: levelData.maxStripes, isActive: true }
                ladder.levels.push(level)
                ctx.createdLevelIds.add(level.id)
                ctx.summary.createdRanks++
                refs.level = { existing: { ladder, level } }
            }
        }
    }

    // Who the row is. An e-mail is an account (global); without one, a
    // phone or name + birth date finds a member of THIS club only — never a
    // stranger's account.
    private async resolvePerson(
        ctx: RunContext,
        r: ClubImportRecord,
        line: number,
    ): Promise<PersonOutcome> {
        const keys = this.personKeys(r)
        for (const key of keys) {
            const known = ctx.persons.get(key)
            if (known?.kind === 'invited') {
                return {
                    kind: 'done',
                    action: 'skip',
                    message: `Приглашение уже отправлено (строка ${known.line})`,
                }
            }
            if (known) return { kind: 'member', state: known }
        }

        if (r.email) {
            const user = await this.prisma.user.findUnique({
                where: { email: r.email },
                select: USER_SELECT,
            })
            if (user) return this.existingAccount(ctx, user, line, r)
            // No account with this e-mail, but the phone or name + birth
            // date is someone already in the club (or earlier in the file):
            // a typo or a second address, not a new person.
            const twinInRun = this.personKeys({ ...r, email: null })
                .map((key) => ctx.persons.get(key))
                .find((p): p is MemberState => p?.kind === 'member')
            const twin = twinInRun
                ? { user: { firstname: twinInRun.firstname, lastname: twinInRun.lastname }, by: `строка ${twinInRun.line}` }
                : await this.findClubMember(ctx, r)
            if ('error' in twin) return { kind: 'done', action: 'error', message: twin.error }
            if (twin.user) {
                return {
                    kind: 'done',
                    action: 'error',
                    message: `Похоже, это ${fullName(twin.user.firstname, twin.user.lastname) || 'участник клуба'} (${twin.by}), но e-mail в клубе другой — проверьте e-mail`,
                }
            }
            return { kind: 'member', state: this.register(ctx, await this.newPerson(ctx, r, line, false), r) }
        }

        const twin = await this.findClubMember(ctx, r)
        if ('error' in twin) return { kind: 'done', action: 'error', message: twin.error }
        if (twin.user) return this.existingAccount(ctx, twin.user, line, r)

        if (!r.parentEmail) {
            return {
                kind: 'done',
                action: 'skip',
                message:
                    'Нет e-mail: у взрослого укажите его e-mail, у ребёнка — e-mail родителя. Без этого человек не сможет войти в приложение',
            }
        }
        if (!r.firstname) {
            return { kind: 'done', action: 'error', message: 'Для ребёнка нужно имя' }
        }
        if (!r.dateOfBirth) {
            return {
                kind: 'done',
                action: 'error',
                message: 'Для ребёнка нужна дата рождения (по ней ребёнок находится при повторном импорте)',
            }
        }
        if ((await this.loadParent(ctx, r.parentEmail)).blocked) {
            return {
                kind: 'done',
                action: 'error',
                message: 'Аккаунт родителя заблокирован — укажите другой e-mail',
            }
        }
        return { kind: 'member', state: this.register(ctx, await this.newPerson(ctx, r, line, true), r) }
    }

    private async loadParent(ctx: RunContext, email: string) {
        let parent = ctx.parents.get(email)
        if (!parent) {
            const user = await this.prisma.user.findUnique({
                where: { email },
                select: { id: true, status: true },
            })
            parent = {
                id: user?.id ?? null,
                blocked: user?.status === 'BLOCKED' || user?.status === 'DELETED',
            }
            ctx.parents.set(email, parent)
        }
        return parent
    }

    // Cache keys for a row: its e-mail (the account) when it has one, else
    // phone and name + birth date.
    private personKeys(r: ClubImportRecord): string[] {
        if (r.email) return [`e:${r.email}`]
        const keys: string[] = []
        if (r.phone) keys.push(`p:${r.phone}`)
        if (r.firstname && r.dateOfBirth) {
            const name = `${r.firstname}|${r.lastname ?? ''}`.toLowerCase().replace(/ё/g, 'е')
            keys.push(`n:${name}|${r.dateOfBirth}`)
        }
        return keys
    }

    // Later rows find this person by any of the row's keys — a row without
    // the e-mail but with the same phone joins the same person.
    private register(ctx: RunContext, state: MemberState, r: ClubImportRecord): MemberState {
        for (const key of this.personKeys({ ...r, email: null })) {
            if (!ctx.persons.has(key)) ctx.persons.set(key, state)
        }
        if (r.email) ctx.persons.set(`e:${r.email}`, state)
        return state
    }

    private forget(ctx: RunContext, state: MemberState) {
        for (const [key, value] of ctx.persons) if (value === state) ctx.persons.delete(key)
    }

    // A member of this club found by phone, else by name + date of birth.
    private async findClubMember(
        ctx: RunContext,
        r: ClubImportRecord,
    ): Promise<{ user: UserRow | null; by?: string } | { error: string }> {
        const inClub = { workspaceMemberships: { some: { workspaceId: ctx.workspace.id } } }
        if (r.phone) {
            const user = await this.prisma.user.findFirst({
                where: { phone: r.phone, ...inClub },
                select: USER_SELECT,
            })
            if (user) return { user, by: 'совпал телефон' }
        }
        if (r.firstname && r.dateOfBirth) {
            const users = await this.prisma.user.findMany({
                where: {
                    firstname: { equals: r.firstname, mode: 'insensitive' },
                    ...(r.lastname
                        ? { lastname: { equals: r.lastname, mode: 'insensitive' } }
                        : {}),
                    dateOfBirth: dateOfBirthToDate(r.dateOfBirth),
                    ...inClub,
                },
                select: USER_SELECT,
                take: 2,
            })
            if (users.length > 1) {
                return {
                    error: 'В клубе несколько участников с таким именем и датой рождения — укажите e-mail или телефон',
                }
            }
            if (users[0]) return { user: users[0], by: 'совпали имя и дата рождения' }
        }
        return { user: null }
    }

    private async existingAccount(
        ctx: RunContext,
        user: UserRow,
        line: number,
        r?: ClubImportRecord,
    ): Promise<PersonOutcome> {
        if (user.status === 'BLOCKED' || user.status === 'DELETED') {
            return { kind: 'done', action: 'error', message: 'Аккаунт заблокирован' }
        }
        if (user.id === ctx.workspace.ownerId) {
            return { kind: 'done', action: 'skip', message: 'Это владелец клуба — пропущен' }
        }
        const member = await this.prisma.workspaceMember.findUnique({
            where: { userId_workspaceId: { userId: user.id, workspaceId: ctx.workspace.id } },
            select: { id: true, status: true, notes: true },
        })
        if (!member) {
            const pending = await this.prisma.workspaceInvitation.findUnique({
                where: { workspaceId_userId: { workspaceId: ctx.workspace.id, userId: user.id } },
                select: { id: true },
            })
            if (user.email) ctx.persons.set(`e:${user.email}`, { kind: 'invited', line })
            if (pending) {
                return {
                    kind: 'done',
                    action: 'skip',
                    message: 'Приглашение уже отправлено — человек ещё не принял его в приложении',
                }
            }
            return { kind: 'invite', user }
        }
        if (member.status === 'SUSPENDED' || member.status === 'BLOCKED') {
            return { kind: 'done', action: 'skip', message: 'Участник заблокирован в клубе — пропущен' }
        }

        const [groups, promotions, subs, guardians, otherMemberships, ownsOther] = await Promise.all([
            this.prisma.groupMember.findMany({
                where: { userId: user.id, group: { workspaceId: ctx.workspace.id } },
                select: { groupId: true },
            }),
            this.prisma.rankPromotion.findMany({
                where: { workspaceId: ctx.workspace.id, userId: user.id },
                orderBy: { awardedAt: 'desc' },
                select: { ladderId: true, levelId: true, stripes: true },
            }),
            this.prisma.subscription.findMany({
                where: { workspaceMemberId: member.id },
                select: {
                    planId: true,
                    startDate: true,
                    endDate: true,
                    status: true,
                    plan: { select: { name: true } },
                    ...subscriptionScopeIdsSelect,
                },
            }),
            this.prisma.guardianship.findMany({
                where: { dependentId: user.id },
                select: { guardian: { select: { email: true } } },
            }),
            this.prisma.workspaceMember.count({
                where: { userId: user.id, workspaceId: { not: ctx.workspace.id } },
            }),
            this.prisma.workspace.count({
                where: { ownerId: user.id, id: { not: ctx.workspace.id } },
            }),
        ])
        const ranks = new Map<string, { levelId: string; stripes: number }>()
        for (const p of promotions) if (!ranks.has(p.ladderId)) ranks.set(p.ladderId, p)
        const tz = ctx.workspace.timezone
        const state: MemberState = {
            kind: 'member',
            userId: user.id,
            memberId: member.id,
            isNew: false,
            pendingCreate: null,
            phoneTaken: false,
            isDependent: user.email === null,
            activate: member.status === 'INVITED',
            firstname: user.firstname,
            lastname: user.lastname,
            dateOfBirth: ymdOf(user.dateOfBirth),
            phone: user.phone,
            hasOtherClubs: otherMemberships + ownsOther > 0,
            notes: member.notes,
            groupIds: new Set(groups.map((g) => g.groupId)),
            ranks,
            subs: subs.map((s) => ({
                planId: s.planId,
                planName: s.plan.name,
                scope: scopeDirectionIds(s),
                startDay: s.startDate ? localDateInTz(s.startDate, tz) : null,
                endDay: s.endDate ? localDateInTz(s.endDate, tz) : null,
                usable: isSubscriptionUsable(s, ctx.now),
            })),
            guardianEmails: new Set(
                guardians.flatMap((g) => (g.guardian.email ? [g.guardian.email] : [])),
            ),
            line,
        }
        if (user.email) ctx.persons.set(`e:${user.email}`, state)
        if (r) this.register(ctx, state, r)
        return { kind: 'member', state }
    }

    private async newPerson(
        ctx: RunContext,
        r: ClubImportRecord,
        line: number,
        isChild: boolean,
    ): Promise<MemberState> {
        let phone = r.phone
        if (phone) {
            const taken =
                ctx.phonesTaken.has(phone) ||
                !!(await this.prisma.user.findUnique({ where: { phone }, select: { id: true } }))
            if (taken) phone = null
            else ctx.phonesTaken.add(phone)
        }
        return {
            kind: 'member',
            userId: placeholder(ctx, 'user'),
            memberId: placeholder(ctx, 'member'),
            isNew: true,
            pendingCreate: {
                email: r.email,
                firstname: r.firstname,
                lastname: r.lastname,
                dateOfBirth: r.dateOfBirth,
                phone,
            },
            phoneTaken: !!r.phone && !phone,
            isDependent: isChild,
            activate: false,
            firstname: r.firstname,
            lastname: r.lastname,
            dateOfBirth: r.dateOfBirth,
            phone,
            hasOtherClubs: false,
            notes: null,
            groupIds: new Set(),
            ranks: new Map(),
            subs: [],
            guardianEmails: new Set(),
            line,
        }
    }

    // What the row changes for this member, without writing anything. The
    // state is updated as if it happened, so the next row for the same
    // person continues from here.
    private async plan(
        ctx: RunContext,
        s: MemberState,
        r: ClubImportRecord,
        refs: Refs,
    ): Promise<{ ops: Op[]; changes: string[]; notes: string[] }> {
        const ops: Op[] = []
        const changes: string[] = []
        const notes: string[] = []
        const tz = ctx.workspace.timezone

        if (s.pendingCreate) {
            if (s.phoneTaken) {
                notes.push('Телефон не сохранён: он уже указан у другого пользователя')
            }
            ops.push({ type: 'createUser', ...s.pendingCreate })
            changes.push(s.isDependent ? 'новый ребёнок' : 'новый участник')
            s.pendingCreate = null
        } else {
            if (s.activate) {
                ops.push({ type: 'activate' })
                changes.push('заявка в клуб одобрена')
                s.activate = false
            }
            const profile: Extract<Op, { type: 'profile' }>['data'] = {}
            const fill = (field: 'firstname' | 'lastname' | 'dateOfBirth', label: string) => {
                const next = r[field]
                const cur = s[field]
                if (!next || cur === next) return
                if (cur && !ctx.overwrite) {
                    if ((cur ?? '').toLowerCase() !== next.toLowerCase()) {
                        notes.push(`${label} не изменено (в клубе «${field === 'dateOfBirth' ? ruDay(cur) : cur}»; включите «Перезаписать»)`)
                    }
                    return
                }
                if (field === 'dateOfBirth') profile.dateOfBirth = dateOfBirthToDate(next)
                else profile[field] = next
                s[field] = next
                changes.push(label.toLowerCase())
            }
            fill('firstname', 'Имя')
            fill('lastname', 'Фамилия')
            fill('dateOfBirth', 'Дата рождения')
            if (r.phone && !s.phone) {
                const taken =
                    ctx.phonesTaken.has(r.phone) ||
                    !!(await this.prisma.user.findUnique({
                        where: { phone: r.phone },
                        select: { id: true },
                    }))
                if (s.hasOtherClubs) {
                    notes.push('Телефон не сохранён: человек состоит и в других клубах — он укажет его сам')
                } else if (taken) {
                    notes.push('Телефон не сохранён: он уже указан у другого пользователя')
                } else {
                    ctx.phonesTaken.add(r.phone)
                    profile.phone = r.phone
                    s.phone = r.phone
                    changes.push('телефон')
                }
            }
            if (Object.keys(profile).length > 0) ops.push({ type: 'profile', data: profile })
        }

        if (r.parentEmail && !s.guardianEmails.has(r.parentEmail)) {
            if (!s.isDependent) {
                notes.push('E-mail родителя не использован: у участника свой аккаунт')
            } else if ((await this.loadParent(ctx, r.parentEmail)).blocked) {
                notes.push('Родитель не привязан: его аккаунт заблокирован')
            } else {
                ops.push({ type: 'linkGuardian', parentEmail: r.parentEmail })
                changes.push(`родитель ${r.parentEmail} (подтвердит в приложении)`)
                s.guardianEmails.add(r.parentEmail)
            }
        }

        if (refs.group && 'existing' in refs.group) {
            const group = refs.group.existing
            if (group.coachId === s.userId) {
                notes.push(`В группу «${group.name}» не добавлен: он её тренер`)
            } else if (!s.groupIds.has(group.id)) {
                ops.push({ type: 'group', group })
                changes.push(`группа «${group.name}»`)
                s.groupIds.add(group.id)
            }
        }

        if (refs.level && 'existing' in refs.level) {
            const { ladder, level } = refs.level.existing
            let stripes = r.stripes ?? 0
            let raiseMaxTo: number | null = null
            if (stripes > level.maxStripes) {
                if (ctx.createdLevelIds.has(level.id)) {
                    raiseMaxTo = stripes
                    level.maxStripes = stripes
                } else {
                    notes.push(`У пояса «${level.name}» не больше ${level.maxStripes} полосок — записано ${level.maxStripes}`)
                    stripes = level.maxStripes
                }
            }
            const cur = s.ranks.get(ladder.id)
            const same =
                cur && cur.levelId === level.id && (r.stripes === null || cur.stripes === stripes)
            if (!same) {
                if (cur && !ctx.overwrite) {
                    notes.push('Пояс не изменён: в клубе уже указан другой (включите «Перезаписать»)')
                } else {
                    ops.push({ type: 'rank', ladderId: ladder.id, levelId: level.id, stripes, raiseMaxTo })
                    changes.push(`пояс «${level.name}»${stripes ? `, ${stripes} пол.` : ''}`)
                    s.ranks.set(ladder.id, { levelId: level.id, stripes })
                }
            }
        }

        if (refs.plan && 'existing' in refs.plan) {
            const plan = refs.plan.existing
            const startDay =
                r.startDate ??
                (r.endDate ? shiftYmd(r.endDate, -plan.durationDays) : ctx.today)
            const endDay = r.endDate ?? shiftYmd(startDay, plan.durationDays)
            const match = s.subs.find(
                (sub) =>
                    sub.planId === plan.id &&
                    (r.startDate
                        ? sub.startDay === startDay
                        : r.endDate
                          ? sub.endDay === endDay
                          : sub.usable),
            )
            if (!match) {
                const startDate = wallClockToUtc(`${startDay}T00:00`, tz)
                const endDate = wallClockToUtc(`${endDay}T00:00`, tz)
                const expired = endDate.getTime() <= ctx.now.getTime()
                // Several abonements may run at once, but not two of the same
                // direction set (the «оформить абонемент» rule).
                const live = s.subs.find(
                    (sub) => sub.usable && sameScope(sub.scope, plan.directionIds),
                )
                if (!expired && live) {
                    notes.push(
                        `Абонемент «${plan.name}» не добавлен: у участника уже есть действующий «${live.planName}»`,
                    )
                } else {
                    let total = plan.classCount
                    const remaining = r.classesLeft ?? plan.classCount
                    if (remaining !== null && (total === null || remaining > total)) total = remaining
                    const paid = r.paid ?? true
                    ops.push({
                        type: 'subscription',
                        plan,
                        startDate,
                        endDate,
                        expired,
                        paid,
                        classesTotal: total,
                        classesRemaining: remaining,
                    })
                    changes.push(
                        `абонемент «${plan.name}» ${ruDay(startDay)}–${ruDay(endDay)}${remaining !== null ? `, осталось ${remaining}` : ''}${paid ? '' : ', не оплачен'}${expired ? ' (истёк)' : ''}`,
                    )
                    s.subs.push({
                        planId: plan.id,
                        planName: plan.name,
                        scope: plan.directionIds,
                        startDay,
                        endDay,
                        usable: !expired,
                    })
                }
            }
        }

        if (r.notes && r.notes !== s.notes) {
            if (s.notes && !ctx.overwrite) {
                notes.push('Заметки не изменены: в клубе уже есть другие (включите «Перезаписать»)')
            } else {
                ops.push({ type: 'notes', notes: r.notes })
                changes.push('заметки')
                s.notes = r.notes
            }
        }

        if (!r.group && (r.gym || r.direction) && !r.plan && !r.rank) {
            notes.push('Зал и направление сохраняются через группу — укажите группу')
        }
        return { ops, changes, notes }
    }

    private async execute(ctx: RunContext, s: MemberState, ops: Op[]) {
        const ws = ctx.workspace
        const createdIds: string[] = []
        const notify: { parentId: string; linkId: string; childName: string }[] = []
        const createdParents: [string, string][] = []
        await this.prisma.$transaction(
            async (tx: PrismaTransactionClientType) => {
                let userId = s.userId
                let memberId = s.memberId
                for (const op of ops) {
                    switch (op.type) {
                        case 'createUser': {
                            const user = await tx.user.create({
                                data: {
                                    email: op.email,
                                    status: 'ACTIVE',
                                    language: 'RU',
                                    firstname: op.firstname,
                                    lastname: op.lastname,
                                    dateOfBirth: op.dateOfBirth ? dateOfBirthToDate(op.dateOfBirth) : null,
                                    phone: op.phone,
                                },
                                select: { id: true },
                            })
                            const member = await tx.workspaceMember.create({
                                data: { status: 'ACTIVE', workspaceId: ws.id, userId: user.id, roleId: ctx.roleId },
                                select: { id: true },
                            })
                            userId = user.id
                            memberId = member.id
                            createdIds.push(user.id)
                            break
                        }
                        case 'linkGuardian': {
                            // A parent without an account gets one (as
                            // «Добавить ребёнка» does); it sees the child to
                            // confirm after its first sign-in.
                            const known = ctx.parents.get(op.parentEmail)?.id
                            const parentId =
                                known ??
                                (
                                    await tx.user.upsert({
                                        where: { email: op.parentEmail },
                                        update: {},
                                        create: { email: op.parentEmail, status: 'ACTIVE', language: 'RU' },
                                        select: { id: true },
                                    })
                                ).id
                            if (!known) createdParents.push([op.parentEmail, parentId])
                            const link = await tx.guardianship.upsert({
                                where: { guardianId_dependentId: { guardianId: parentId, dependentId: userId } },
                                update: {},
                                create: {
                                    guardianId: parentId,
                                    dependentId: userId,
                                    relation: 'PARENT',
                                    invitedByWorkspaceId: ws.id,
                                    invitedById: ctx.actorId,
                                },
                                select: { id: true },
                            })
                            if (known) {
                                notify.push({ parentId, linkId: link.id, childName: s.firstname ?? 'ребёнка' })
                            }
                            break
                        }
                        case 'activate':
                            await tx.workspaceMember.update({
                                where: { id: memberId },
                                data: { status: 'ACTIVE' },
                            })
                            createdIds.push(userId)
                            break
                        case 'profile':
                            await tx.user.update({ where: { id: userId }, data: op.data })
                            break
                        case 'group':
                            await placeInGroup(tx, {
                                group: { id: op.group.id, coachId: op.group.coachId },
                                userId,
                                roleName: 'user',
                            })
                            break
                        case 'rank':
                            if (op.raiseMaxTo !== null) {
                                await tx.rankLevel.updateMany({
                                    where: { id: op.levelId, maxStripes: { lt: op.raiseMaxTo } },
                                    data: { maxStripes: op.raiseMaxTo },
                                })
                            }
                            await this.ranks.promoteInTx(tx, {
                                workspaceId: ws.id,
                                userId,
                                ladderId: op.ladderId,
                                levelId: op.levelId,
                                stripes: op.stripes,
                                awardedById: ctx.actorId,
                                note: 'Импорт',
                            })
                            break
                        case 'subscription': {
                            await tx.subscription.create({
                                data: {
                                    workspaceId: ws.id,
                                    planId: op.plan.id,
                                    workspaceMemberId: memberId,
                                    status: op.expired ? 'EXPIRED' : 'ACTIVE',
                                    startDate: op.startDate,
                                    endDate: op.endDate,
                                    startsOnFirstVisit: false,
                                    durationDays: op.plan.durationDays,
                                    amountPaid: op.plan.price,
                                    currency: op.plan.currency,
                                    isPaid: op.paid,
                                    paidAt: op.paid ? op.startDate : null,
                                    classesTotal: op.classesTotal,
                                    classesRemaining: op.classesRemaining,
                                    source: 'MANUAL',
                                    directions: scopeSnapshotCreate(op.plan.directionIds),
                                },
                                select: { id: true },
                            })
                            if (!op.expired) {
                                const current = await tx.workspaceMember.findUniqueOrThrow({
                                    where: { id: memberId },
                                    select: { accessUntil: true },
                                })
                                const accessUntil =
                                    current.accessUntil && current.accessUntil > op.endDate
                                        ? current.accessUntil
                                        : op.endDate
                                await tx.workspaceMember.update({
                                    where: { id: memberId },
                                    data: { accessUntil },
                                })
                            }
                            break
                        }
                        case 'notes':
                            await tx.workspaceMember.update({
                                where: { id: memberId },
                                data: { notes: op.notes },
                            })
                            break
                    }
                }
                s.userId = userId
                s.memberId = memberId
            },
            { timeout: 30_000 },
        )
        for (const [email, id] of createdParents) ctx.parents.set(email, { id, blocked: false })
        ctx.createdUserIds.push(...createdIds)
        for (const n of notify) {
            await this.notifications.notifyUser({
                userId: n.parentId,
                kind: 'guardian.invite',
                refId: n.linkId,
                topic: 'Подтвердите профиль ребёнка',
                message: `Клуб «${ws.name}» добавил ребёнка ${n.childName} и указал вас родителем. Подтвердите в разделе «Дети».`,
                metadata: { dependentId: s.userId, invitedByWorkspaceId: ws.id },
            })
        }
    }

    private async invite(
        ctx: RunContext,
        user: UserRow,
        r: ClubImportRecord,
        refs: Refs,
        result: ClubImportRowResult,
        finish: (action: ClubImportRowResult['action'], ...m: string[]) => ClubImportRowResult,
    ): Promise<ClubImportRowResult> {
        const group = refs.group && 'existing' in refs.group ? refs.group.existing : null
        result.changes.push(
            'приглашение в клуб (у человека уже есть аккаунт — вступит, когда примет его в приложении)',
        )
        if (group) result.changes.push(`группа «${group.name}» после принятия`)
        const left = [r.plan && 'абонемент', r.rank && 'пояс', r.notes && 'заметки'].filter(Boolean)
        const messages = left.length
            ? [`Не перенесено до принятия приглашения: ${left.join(', ')} — повторите импорт или добавьте вручную`]
            : []
        if (ctx.mode === 'apply' && user.email) {
            try {
                await this.invitations.invite({
                    workspace: { id: ctx.workspace.id, name: ctx.workspace.name },
                    user: { id: user.id, email: user.email },
                    roleName: 'user',
                    groupId: group?.id ?? null,
                    invitedById: ctx.actorId,
                    sendEmail: false,
                })
            } catch (e) {
                this.logger.error(e)
                result.changes = []
                return finish('error', 'Не удалось отправить приглашение')
            }
        }
        return finish('invite', ...messages)
    }

    private count(ctx: RunContext, ops: Op[]) {
        for (const op of ops) {
            if (op.type === 'group') ctx.summary.groupMemberships++
            else if (op.type === 'subscription') ctx.summary.subscriptions++
            else if (op.type === 'rank') ctx.summary.ranks++
            else if (op.type === 'createUser' && !op.email) ctx.summary.children++
        }
    }
}
