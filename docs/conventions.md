# Repo conventions (authoritative)

Read the section for the area you're touching **before** writing code, and copy
the nearest existing sibling file — do not invent patterns. If unsure, `grep` for
2–3 existing examples and follow the majority. Determinism > cleverness.

Exact commands are pinned on purpose. Use them verbatim.

---

## 0. Global (applies everywhere)

- **Package manager / runner:** `nx`. Project names: `@clubspace/server`,
  `@clubspace/admin`, `@clubspace/mobile`, `@clubspace/api-client`.
- **Git:**
  - **Never** add tool-generated attribution or "Generated with…" trailers to
    commits or PR bodies.
  - **Always** `git branch --show-current` immediately before any commit — the
    working copy switches branches out-of-band. Never commit to `main`; branch first.
  - PRs are **squash-merged**. One feature = one branch = one PR.
  - Recover an accidental `main` commit by moving pointers (`git branch -f`), never
    `git reset --hard` (the sandbox blocks it anyway).
- **Prisma / DB:** schema changes go via `npx prisma db push --schema apps/server/prisma/schema.prisma`.
  **Do NOT create or commit `apps/server/prisma/migrations/`** (no prod data yet).
  After editing the schema: `npx prisma validate …` then `npx prisma generate …`.
  Give new required columns a `@default(...)` so `db push` backfills cleanly.
- **Tests:** `npx nx test @clubspace/server -- <path-substring>`.
  **Do not** run bare `jest` (the `.cts` config fails under ts-node).
- **Typecheck (the nx target hits a "workspace out of sync" gate — use tsc directly):**
  - server: `npx tsc -p apps/server/tsconfig.app.json --noEmit`
  - admin: `npx tsc -p apps/admin/tsconfig.json --noEmit`
  - mobile: `npx tsc -p apps/mobile/tsconfig.app.json --noEmit`
    (⚠️ `tsconfig.json` in mobile is a **false-clean** — always use `tsconfig.app.json`).
- **Definition of done for a task:** relevant jest green + the area's tsc clean +
  (if endpoints changed) contract regenerated (§Contract) + committed on a feature branch.

---

## 1. Server — NestJS feature slices

Reference feature to copy: `apps/server/src/features/manage-workspace-events/`.
Reference authz: `apps/server/src/shared/services/rbac.service.ts`.

### Anatomy
One slice per folder `apps/server/src/features/<kebab-name>/`:
- `<name>.feature.ts` — zod input/output schemas + a command class + a Response type.
- `<name>.handler.ts` — `@Feature(X)` class `implements IFeatureHandler<X, Response>`.
- `<name>.controller.ts` — HTTP surface (one controller may host several routes).
- `schemas.ts` — shared zod output schemas + `serialize*` mappers.
- `<name>-utils.ts` — pure helpers (unit-tested directly).
- `<name>.handler.spec.ts` — jest, Prisma mocked as a plain object.

### feature.ts
```ts
export const XInputSchema = z.object({ /* ... */ })
export const XOutputSchema = /* a schema from schemas.ts */
export class XFeature {
  constructor(
    readonly payload: z.infer<typeof XInputSchema>,
    readonly workspaceId: string,
    readonly invokerUserId: string,
    readonly roleName: string | null,     // pass user.role?.name ?? null
    readonly isSuperAdmin: boolean,
  ) {}
}
export type XFeatureResponse = z.infer<typeof XOutputSchema>
```
- **No `z.discriminatedUnion` in a DTO** — `createZodDto` can't build a class from a
  union. Use a flat `z.object` with a `kind` enum + `.superRefine(...)` and narrow in
  the handler with explicit throws. Keeps the contract free of `oneOf`.

### handler.ts
```ts
@Feature(XFeature)
export class XHandler implements IFeatureHandler<XFeature, XFeatureResponse> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,      // + AuditService / SubscriptionService as needed
  ) {}
  async execute(f: XFeature) { /* ... */ return serializeX(row) }
}
```
- **Authorize in the handler, never trust `@Roles` alone.** Resolve scope once:
  `const ctx = await this.rbac.resolveCoachScope({ userId, workspaceId, roleName, isSuperAdmin })`.
  Then: group writes → `await this.rbac.assertCanWriteGroup(ctx, groupId)`; workspace-admin
  actions → `assertWorkspaceAdmin(this.rbac, {...})` (`shared/access/assert-admin-scope.ts`);
  scoped reads → `this.rbac.canSeeAllGroups(ctx)`. The **owner bypass** lives inside
  `resolveCoachScope` (owner → `admin`). The workspace **owner has no `WorkspaceMember` row** —
  special-case `userId === workspace.ownerId` when a member row is required.
- **Errors:** throw `BadRequestError`/`NotFoundError`/`ForbiddenError` from
  `../../shared/errors/shared.errors`. No bare `throw new Error`.
- **Return mapped DTOs via a `serialize*` helper**, never a raw Prisma entity. Dates →
  `.toISOString()`. Zod output uses `z.iso.datetime()` / `z.iso.date()`.
- **Timezone:** reuse `wallClockToUtc` + `TZDate`. Precedence: event → `event.timezone`;
  group/slot → `gym?.timezone ?? workspace.timezone`. Don't re-implement.
- **Idempotent create on a compound unique:** Prisma `upsert` isn't atomic there — use
  `create` + `catch (P2002) → findUnique` (check `(e as {code}).code === 'P2002'`).
- **Enum values** are passed as string literals (`status: 'ACTIVE'`), matching the codebase.

### controller.ts
```ts
@Controller('workspaces/:workspaceId/<resource>')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class XController {
  constructor(private bus: FeaturesBus) {}
  // Tier must match the handler's check: assertWorkspaceAdmin => WORKSPACE_ADMINS
  // (enforced by shared/access/route-tier-consistency.spec.ts).
  @Post() @Roles(WORKSPACE_ADMINS) @ZodResponse({ type: XOutputDto })
  async createX(@Param('workspaceId') workspaceId: string, @Body() body: XInputDto,
    @CurrentUser() user: CurrentUserPayload) {
    return this.bus.execute<XFeature, XFeatureResponse>(
      new XFeature(body, workspaceId, user.userId, user.role?.name ?? null, user.isSuperAdmin))
  }
}
```
- **Controller method names must be globally unique** (`createSession`, `assignSubscription`,
  …) — the OpenAPI `operationIdFactory` uses the method key only; generic names collide and
  renumber the whole generated client.
- **DTO class names must be globally unique** (`createZodDto(...)` → schema name). Output DTOs
  get a doubled `Output` suffix in generated types (e.g. `ListPlansOutputOutput`) — expected.
- Guard order is always `AuthGuard, WorkspaceMemberGuard, RoleGuard`; a route of a switchable app
  section adds `FeatureEnabledGuard` right after `WorkspaceMemberGuard` plus `@RequiresFeature('<key>')`
  (paired — enforced by `route-tier-consistency.spec.ts`). It reads the workspace from params or
  query, fails closed without one, and lets owner/staff/super admin through. Never gate a read the
  app fires on every refresh (favorites, achievements): return an empty payload instead. Omit `@Roles` for "any
  workspace member" reads.
- **Tier rule:** a handler that calls `assertWorkspaceAdmin` sits behind
  `@Roles(WORKSPACE_ADMINS)`; coach-scope handlers (`resolveCoachScope`) use `COACHING_ROLES`
  for writes and `STAFF_ROLES` for reads. `shared/access/route-tier-consistency.spec.ts`
  scans every controller and fails on a mismatch (a coach would otherwise see the button and
  always get 403). There is no `moderator` role; the roles a club admin can grant are
  `GRANTABLE_ROLE_NAMES`.

### Registration
Add the controller to the `controllers` array and each handler to the `providers`
`...handlers` list in `apps/server/src/app/app.module.ts`. Domain services (e.g.
`SubscriptionService`) are direct providers next to `RbacService`.

### Tests
Mock Prisma as a plain object of `jest.fn()`s; assert on the `.mock.calls[0][0]` args and on
returned/serialized shape. Provide a full row fixture when the handler serializes the return
(the serializer touches many fields). Pure `*-utils.ts` get their own direct unit spec.

**Every handler gets a spec covering, at minimum:** the authorization refusal (each role that
must be rejected — the owner bypass is a separate case, owners have no `WorkspaceMember` row),
the not-found path, and each branch of the happy path. A handler with only a happy-path spec
passes while the gate it is supposed to enforce is missing.

Fixtures must reflect what the code under test wrote. A static `UPDATED_ROW` constant makes
"the transfer happened" assert against a literal instead of against behaviour, so the spec
stays green when the handler stops transferring anything.

Coverage is ratcheted (`coverageThreshold` in each `jest.config`), so new code without tests
fails the build. Raise the floor in the same commit that adds the tests.

---

## 2. API contract (regenerate when endpoints/DTOs change)

Run **all** of these and commit their output in the same PR, or CI ("OpenAPI spec in sync" +
typecheck) fails:
1. `npx nx run @clubspace/server:open-api:generate` → commit `open-api.json` (headless, no DB).
2. `npx nx run @clubspace/api-client:types:generate` → commit `libs/api-client/src/openapi/{index.ts,types.gen.ts}`.
3. Rebuild the dist so the apps typecheck locally: `npx tsc -p libs/api-client/tsconfig.lib.json`.
- The admin `apps/admin/src/shared/sdk/` axios SDK is **dead/stale — do not regenerate it.**
  Consume the contract via hand-written `shared/api/*.ts` wrappers (§3/§4).
- Keep the contract free of `oneOf` (see the discriminated-union rule in §1).

---

## 3. Admin — Next.js (`apps/admin`)

Reference page: `.../workspace/[workspaceId]/events/page.tsx`.
Reference wrapper: `apps/admin/src/shared/api/events.ts`.

- **API wrappers** in `apps/admin/src/shared/api/<resource>.ts`:
  ```ts
  import type { ApiTypes } from "@clubspace/api-client"
  import { getApiClient } from "./client"
  export type X = ApiTypes.XOutputDtoOutput
  export const listX = async (p: { workspaceId: string }) =>
    getApiClient().request<{ data: X[] }>({ method: "get", url: `/workspaces/${p.workspaceId}/x` })
  ```
  Signature: `getApiClient().request<TResponse, TBody>({ method, url, params, data })`.
  Derive types from `ApiTypes.*` (never redefine server shapes by hand).
- **Pages** are `"use client"`, `useState`/`useEffect` (no react-query), `useParams()` for ids.
  UI from `@clubspace/ui-kit/ui` (`Button`, `Select`, …). Errors via `errorMessage(e, "…")`
  from `shared/lib/error-message`. Tailwind with tokens: `border`, `muted-foreground`, `card`,
  `primary`, `destructive`. Gate admin actions with `isWorkspaceAdmin(useMyMembership(...))`.
  Sections the server restricts to `WORKSPACE_ADMINS` get `adminOnly: true` on their nav item
  (filtered by `visibleNavItems`) and a tiny `"use client"` `layout.tsx` wrapping children in
  `AdminOnlyGate` (`shared/workspace/admin-only-gate.tsx`), so a coach opening the URL sees a
  notice and the page never mounts.
- Prefer a self-contained component (own fetch) over threading state through a large page.
- Verify: `npx tsc -p apps/admin/tsconfig.json --noEmit`. Visual QA needs the app running.

---

## 4. Mobile — Expo / React Native (`apps/mobile`)

Reference screen: `src/features/schedule/ClubScheduleScreen.tsx`.
Reference wrapper: `src/shared/api/groups.ts`.

- **API wrappers** in `src/shared/api/<resource>.ts`, same `getApiClient().request` pattern,
  types from `ApiTypes.*`.
- **Screens:** `useAuth()` → `{ workspace }`; theming via `useTheme()` +
  `useThemedStyles(makeStyles)` (never hard-code colors — use `theme.colors.*`,
  `theme.spacing()`, `theme.radius`, `theme.typography`). Navigation: the five bottom tabs
  (`MainTabs`, `MainTabParamList`) sit under one `Main` screen of the root NativeStack; every
  non-tab screen lives on the **root stack** — add the route to `RootStackParamList` in
  `src/app/navigation.ts` and register it in `src/app/App.tsx`. Tabs are entered only via
  `navigateToTab` / `navigate("Main", { screen }, { pop: true })` — never `navigate("<Tab>")`
  from a pushed screen (it would push a second tab bar). Tab screens stay mounted for the
  app's lifetime, so never memoize "now"/today in a tab (derive dates per render and put the
  date in the cache key). Plain `async` fetch + `useState`; render `<ErrorRetry>` on failure.
  Coach-of-a-group detection: `getMyGroups()` entries where `role === 'coach'`.
- Verify: `npx tsc -p apps/mobile/tsconfig.app.json --noEmit`. Metro strips types,
  so a type error is a runtime crash — never skip the tsc. Behavioral QA needs Expo running.

---

## 5. Prisma schema design (`apps/server/prisma/schema.prisma`)

- Multi-tenant root is `Workspace` (`WorkspaceType` enum: GRAPPLING/FITNESS/YOGA/CUSTOM — the
  platform is intentionally multi-discipline; keep new models sport-agnostic).
- Rosters key on **`User`**, not `WorkspaceMember` (matches `GroupMember`, `Group.coachId`;
  survives member removal; owner has no member row).
- Two relations between the same pair of models must both be `@relation("Name")`.
- `onDelete`: `SetNull` to preserve history when a parent is deleted (denormalize display
  fields so the row still renders); `Cascade` for owned children; `Restrict` for audit actors.
- Add `@@index` for every filtered/ordered read path; denormalize `workspaceId` onto hot
  child tables when a read is workspace-scoped but the FK path is indirect.
- New enums use string-literal values in queries. Future sport-variable data (ranks, etc.)
  should be **config-driven per workspace**, not a global enum.
