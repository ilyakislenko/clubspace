# bjj-academy — working agreement

Multi-tenant training-club platform (NestJS + Prisma/Postgres server, Next.js admin,
Expo mobile, generated typed API client). Intentionally multi-discipline
(`WorkspaceType`: GRAPPLING/FITNESS/YOGA/CUSTOM) — **keep new models sport-agnostic**.

## Read before coding
**`docs/conventions.md` is authoritative.** Read the section for the area you touch and
copy the nearest sibling file. Do not invent patterns. Determinism > cleverness.

## Non-negotiables (the ones that bite)
- **Git:** never commit to `main` — branch first; run `git branch --show-current` right
  before every commit (the working copy switches branches out-of-band). PRs squash-merge.
  **No Claude attribution** in commits/PRs. Recover a bad `main` commit by moving pointers,
  never `git reset --hard`.
- **DB:** `prisma db push` only — **never create/commit `migrations/`** (no prod data yet).
- **Tests:** `npx nx test @clubspace/server -- <substring>` (bare `jest` fails).
- **Typecheck** (nx target is out-of-sync-gated; use tsc directly):
  server `tsc -p apps/server/tsconfig.app.json`, admin `tsc -p apps/admin/tsconfig.json`,
  mobile `tsc -p apps/mobile/tsconfig.app.json` (mobile `tsconfig.json` is false-clean).
- **Contract:** if endpoints/DTOs change, regenerate + commit `open-api.json` and
  `libs/api-client/src/openapi/*` (see conventions §2), or CI's drift gate fails.
- **Server:** feature slices (`*.feature/handler/controller.ts`); authorize **in the handler**
  via `RbacService` (owner has no `WorkspaceMember` row — special-case it); return `serialize*`
  DTOs, not raw Prisma; typed errors from `shared/errors`; unique controller-method & DTO names.

## Agent workflow (token tiering)
Strong model designs + reviews; cheap model implements from a detailed plan. See
`.claude/agents/README.md`. Agents: `bjj-architect` (opus, design), `bjj-implementer`
(sonnet, execute one task), `bjj-reviewer` (opus, gate before merge), `bjj-explorer`
(haiku, search). The reviewer always runs before merge.
