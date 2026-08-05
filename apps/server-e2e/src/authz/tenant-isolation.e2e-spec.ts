import * as fs from 'fs'
import * as path from 'path'

import { signIn } from '../support/actors'
import { addMember, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

// Multi-tenancy is the one thing that must never fail: a club reading or
// writing another club's data is not a bug report, it's an incident.
//
// Rather than hand-listing routes — which goes stale the moment someone adds a
// controller — this walks every workspace-scoped operation in the committed
// open-api.json (itself drift-gated in CI) and points an outsider at it. A new
// endpoint that forgets its guards fails here without anyone remembering to
// write a test for it.
type SpecParameter = {
    name: string
    in: string
    required?: boolean
    schema?: { format?: string; type?: string }
}
type Operation = { method: string; path: string; query: string }

// Required query parameters, filled from the spec's own declared format.
// Without this a route like GET /schedule (from + to are required) answers 400
// for everyone, including the club's own owner — which would quietly weaken
// the negative control below into "everything is refused, therefore secure".
const buildQuery = (params: SpecParameter[]): string => {
    const pairs = params
        .filter((p) => p.in === 'query' && p.required)
        .map((p) => {
            const format = p.schema?.format
            if (format === 'date') return `${p.name}=2026-01-01`
            if (format === 'date-time') return `${p.name}=2026-01-01T00:00:00.000Z`
            if (p.schema?.type === 'number' || p.schema?.type === 'integer') {
                return `${p.name}=1`
            }
            return `${p.name}=1`
        })
    return pairs.length ? `?${pairs.join('&')}` : ''
}

const loadWorkspaceOperations = (): Operation[] => {
    const specPath = path.resolve(__dirname, '../../../../open-api.json')
    const spec = JSON.parse(fs.readFileSync(specPath, 'utf8')) as {
        paths: Record<
            string,
            Record<string, { parameters?: SpecParameter[] }>
        >
    }

    const ops: Operation[] = []
    for (const [route, methods] of Object.entries(spec.paths)) {
        if (!route.includes('{workspaceId}')) continue
        // The platform console is a deliberately different tier: it is gated on
        // isSuperAdmin, not on club membership, and has its own spec.
        if (route.startsWith('/platform/')) continue
        for (const [method, operation] of Object.entries(methods)) {
            ops.push({
                method: method.toUpperCase(),
                path: route,
                query: buildQuery(operation.parameters ?? []),
            })
        }
    }
    return ops
}

const OPERATIONS = loadWorkspaceOperations()

// Any uuid the victim club does not own. Sub-resource ids are filled with this
// so the request is well-formed enough to reach the guards.
const ABSENT_ID = '00000000-0000-4000-8000-000000000000'

const buildUrl = (op: Operation, workspaceId: string) =>
    op.path
        .replace('{workspaceId}', workspaceId)
        .replace(/\{[^}]+\}/g, ABSENT_ID) + op.query

describe('cross-club isolation', () => {
    let ctx: TestApp
    let victimWorkspaceId: string
    let victimOwnerAuth: [string, string]
    let outsiderAuth: [string, string]
    let strangerAuth: [string, string]

    beforeAll(async () => {
        ctx = await createTestApp()
        await resetDatabase(ctx.prisma)
        await ctx.seed.onApplicationBootstrap()

        // The club being probed, with a member so it isn't trivially empty.
        const victim = await createWorkspace(ctx, { name: 'Victim Club' })
        victimWorkspaceId = victim.workspace.id
        await addMember(ctx, { workspaceId: victim.workspace.id })
        victimOwnerAuth = (await signIn(ctx, victim.owner.email)).auth

        // Owner of a different club: authenticated, privileged in their own
        // club, entitled to nothing here.
        const outsider = await createWorkspace(ctx, { name: 'Outsider Club' })
        const outsiderActor = await signIn(ctx, outsider.owner.email)
        outsiderAuth = outsiderActor.auth

        // A signed-in user with no club at all.
        const strangerActor = await signIn(ctx, 'stranger@example.com')
        strangerAuth = strangerActor.auth
    })

    afterAll(async () => {
        await ctx?.close()
    })

    it('found the workspace-scoped surface to probe', () => {
        // Guards against the loader silently matching nothing and every
        // it.each below vacuously passing.
        expect(OPERATIONS.length).toBeGreaterThan(60)
    })

    // The negative control, and the reason this file is worth trusting.
    //
    // "Outsider gets 4xx" is satisfied just as well by a URL that matches no
    // route at all, or by a club that doesn't exist. If the sweep is real,
    // then the same URLs must succeed for someone entitled to them. Only GETs
    // whose sole parameter is {workspaceId} are checked — everything else
    // carries a deliberately absent sub-resource id and would 404 for anyone.
    it('is not vacuous: the victim club\'s own owner gets through', async () => {
        const ownReads = OPERATIONS.filter(
            (op) =>
                op.method === 'GET' &&
                (op.path.match(/\{[^}]+\}/g) ?? []).length === 1,
        )
        expect(ownReads.length).toBeGreaterThan(8)

        const refused: string[] = []
        for (const op of ownReads) {
            const res = await ctx
                .http()
                .get(buildUrl(op, victimWorkspaceId))
                .set(...victimOwnerAuth)
            if (res.status >= 400) {
                refused.push(`${op.path} → ${res.status}`)
            }
        }

        expect(refused).toEqual([])
    })

    const request = (op: Operation, auth?: [string, string]) => {
        const url = buildUrl(op, victimWorkspaceId)
        const req = ctx.http()[
            op.method.toLowerCase() as 'get' | 'post' | 'patch' | 'delete'
        ](url)
        return auth ? req.set(...auth).send({}) : req.send({})
    }

    describe.each(OPERATIONS.map((op) => [`${op.method} ${op.path}`, op]))(
        '%s',
        (_label, op) => {
            it('refuses the owner of another club', async () => {
                const res = await request(op, outsiderAuth)

                // 2xx means the outsider got in. 4xx is the correct refusal.
                // 5xx is also a failure: an unhandled crash on a hostile
                // request is how a guard gets bypassed by accident later.
                expect(res.status).toBeGreaterThanOrEqual(400)
                expect(res.status).toBeLessThan(500)
            })

            it('refuses a signed-in user with no club', async () => {
                const res = await request(op, strangerAuth)

                expect(res.status).toBeGreaterThanOrEqual(400)
                expect(res.status).toBeLessThan(500)
            })

            it('refuses an unauthenticated caller', async () => {
                const res = await request(op)

                expect(res.status).toBe(401)
            })
        },
    )
})
