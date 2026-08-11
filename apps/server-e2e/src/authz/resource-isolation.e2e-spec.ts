import * as fs from 'fs'
import * as path from 'path'

import { signIn } from '../support/actors'
import { createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

// The companion to tenant-isolation.e2e-spec.ts, which sweeps every route
// carrying {workspaceId} in its path. That leaves a shape it cannot see: routes
// where the club is derived from the resource itself, or arrives as a query
// parameter. Those are exactly the endpoints whose authorization lives deepest
// — inside VideoService rather than in a guard or a handler — so they are the
// ones a path-based sweep is least able to vouch for.
//
// The probe is the same in spirit: point an outsider at a real resource
// belonging to someone else and require a refusal.
type SpecParameter = { name: string; in: string; required?: boolean }
type Operation = { method: string; path: string; needsWorkspaceQuery: boolean }

// An empty body 400s on validation, and a 400 looks like a refusal while
// proving nothing about authorization. PATCH carries the victim's workspaceId
// deliberately: an outsider naming someone else's club is the hostile request
// worth making.
const bodyFor = (label: string, workspaceId: string) =>
    ({
        'POST /videos/{videoId}/progress': { position: 1 },
        'PUT /videos/{videoId}/favorite': { favorite: true },
        'PATCH /admin/videos/{id}': { workspaceId, title: 'probe' },
    })[label] ?? {}

// Creation and upload-completion take no existing resource id, so there is
// nothing of the victim's to point at — a different test, not this one.
const NOT_A_RESOURCE_PROBE = new Set([
    'POST /admin/videos',
    'POST /admin/videos/bulk',
    'POST /admin/videos/{id}/complete-upload',
    'POST /admin/videos/{id}/thumbnail-upload',
    // Authenticated by a playback token in the query string, not by the JWT
    // every other route here uses: the club's own owner is answered 401, so a
    // refusal proves nothing. Covered on its own terms at the end of the file.
    'GET /videos/{id}/manifest.m3u8',
])

// Routes the owning club cannot exercise in this environment either, so their
// refusal below is recorded but not evidence. Kept explicit and short so the
// sweep is never mistaken for total coverage — delete an entry the day the
// route can be driven end to end.
const NO_POSITIVE_CONTROL = new Map([
    [
        'GET /videos/{id}/offline-manifest',
        'reads the HLS master playlist out of S3; the fixture has a row, not an object',
    ],
    [
        'GET /videos/{id}/offline-download',
        'same — enumerates real segment objects',
    ],
])

const loadResourceOperations = (): Operation[] => {
    const specPath = path.resolve(__dirname, '../../../../open-api.json')
    const spec = JSON.parse(fs.readFileSync(specPath, 'utf8')) as {
        paths: Record<
            string,
            Record<string, { parameters?: SpecParameter[] }>
        >
    }

    const ops: Operation[] = []
    for (const [route, methods] of Object.entries(spec.paths)) {
        if (route.includes('{workspaceId}')) continue
        if (!/^\/(admin\/)?videos/.test(route)) continue

        for (const [method, operation] of Object.entries(methods)) {
            const label = `${method.toUpperCase()} ${route}`
            if (NOT_A_RESOURCE_PROBE.has(label)) continue

            ops.push({
                method: method.toUpperCase(),
                path: route,
                needsWorkspaceQuery: (operation.parameters ?? []).some(
                    (p) => p.in === 'query' && p.name === 'workspaceId',
                ),
            })
        }
    }
    return ops
}

const OPERATIONS = loadResourceOperations()

describe('cross-club isolation by resource', () => {
    let ctx: TestApp
    let victimWorkspaceId: string
    let victimVideoId: string
    let outsiderVideoId: string
    let victimOwnerAuth: [string, string]
    let outsiderAuth: [string, string]
    let strangerAuth: [string, string]

    const buildUrl = (op: Operation) => {
        const url = op.path
            .replace('{videoId}', victimVideoId)
            .replace('{id}', victimVideoId)
        return op.needsWorkspaceQuery
            ? `${url}?workspaceId=${victimWorkspaceId}`
            : url
    }

    const request = (op: Operation, auth?: [string, string]) => {
        const req = ctx.http()[
            op.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete'
        ](buildUrl(op))
        const body = bodyFor(`${op.method} ${op.path}`, victimWorkspaceId)
        return auth ? req.set(...auth).send(body) : req.send(body)
    }

    beforeAll(async () => {
        ctx = await createTestApp()
        await resetDatabase(ctx.prisma)
        await ctx.seed.onApplicationBootstrap()

        const victim = await createWorkspace(ctx, { name: 'Victim Club' })
        victimWorkspaceId = victim.workspace.id
        victimOwnerAuth = (await signIn(ctx, victim.owner.email)).auth

        // Transcoded, not merely uploaded: the playback and offline routes
        // refuse anything that isn't ready, and a video refused for that reason
        // would be refused for the outsider too — proving nothing.
        const video = await ctx.prisma.video.create({
            data: {
                workspaceId: victimWorkspaceId,
                title: 'Victim club video',
                url: 'https://example.invalid/victim.mp4',
                status: 'ready',
                hlsBucket: 'test-bucket',
                hlsMasterKey: `videos/${victimWorkspaceId}/hls/master.m3u8`,
                duration: 120,
            },
            select: { id: true },
        })
        victimVideoId = video.id

        const outsider = await createWorkspace(ctx, { name: 'Outsider Club' })
        outsiderAuth = (await signIn(ctx, outsider.owner.email)).auth

        const outsiderVideo = await ctx.prisma.video.create({
            data: {
                workspaceId: outsider.workspace.id,
                title: 'Outsider club video',
                url: 'https://example.invalid/outsider.mp4',
                status: 'ready',
                hlsBucket: 'test-bucket',
                hlsMasterKey: `videos/${outsider.workspace.id}/hls/master.m3u8`,
                duration: 120,
            },
            select: { id: true },
        })
        outsiderVideoId = outsiderVideo.id
        strangerAuth = (await signIn(ctx, 'stranger@example.com')).auth
    })

    afterAll(async () => {
        await ctx?.close()
    })

    it('found the resource-scoped surface to probe', () => {
        // The loader matching nothing would make every case below pass while
        // testing air.
        expect(OPERATIONS.length).toBeGreaterThanOrEqual(8)
    })

    // Without this, "the outsider got 4xx" is equally satisfied by a route that
    // refuses everyone — a video stuck in the wrong status, a URL that matches
    // no handler. The same requests must work for the club that owns the video.
    it('is not vacuous: the video\'s own club can use these routes', async () => {
        const refused: string[] = []

        for (const op of OPERATIONS) {
            // Skipped deliberately: it would delete the fixture the rest of the
            // sweep points at, and its refusal is covered below like any other.
            if (op.method === 'DELETE') continue
            if (NO_POSITIVE_CONTROL.has(`${op.method} ${op.path}`)) continue

            const res = await request(op, victimOwnerAuth)
            if (res.status >= 400) {
                refused.push(`${op.method} ${op.path} → ${res.status}`)
            }
        }

        expect(refused).toEqual([])
    })

    describe.each(
        OPERATIONS.map((op) => [`${op.method} ${op.path}`, op] as const),
    )('%s', (_label, op) => {
        it('refuses the owner of another club', async () => {
            const res = await request(op, outsiderAuth)

            // 2xx means one club reached another's video. 5xx counts as a
            // failure too: crashing on a hostile request is how a check gets
            // quietly removed later.
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
    })

    // The manifest route trades the JWT for a short-lived playback token in the
    // query string, because a video player cannot send an Authorization header.
    // That makes the token the only thing standing between one club's library
    // and another's, so it has to be bound to the video it was minted for —
    // otherwise a member of any club can mint one cheaply and replay it.
    // 401 exactly, never a generic 4xx: the route answers 404 when the video
    // has no transcoded output, which this fixture does not have. Accepting any
    // 4xx would let a removed token check pass as long as S3 stayed empty.
    describe('playback token', () => {
        const mintToken = async (videoId: string, auth: [string, string]) => {
            const minted = await ctx
                .http()
                .get(`/videos/${videoId}/playback`)
                .set(...auth)
                .expect(200)
            const token = new URL(minted.body.hlsUrl).searchParams.get('token')
            expect(token).toBeTruthy()
            return token as string
        }

        it('is accepted for the video it was minted for', async () => {
            const token = await mintToken(victimVideoId, victimOwnerAuth)

            const res = await ctx
                .http()
                .get(
                    `/videos/${victimVideoId}/manifest.m3u8?token=${encodeURIComponent(token)}`,
                )

            // Past the token gate. What happens next is a storage concern.
            expect(res.status).not.toBe(401)
        })

        it('does not open a video it was not minted for', async () => {
            const token = await mintToken(victimVideoId, victimOwnerAuth)

            const res = await ctx
                .http()
                .get(
                    `/videos/${outsiderVideoId}/manifest.m3u8?token=${encodeURIComponent(token)}`,
                )

            expect(res.status).toBe(401)
        })

        it('refuses a token that has been tampered with', async () => {
            const token = await mintToken(victimVideoId, victimOwnerAuth)
            const forged = `${token.slice(0, -2)}00`

            const res = await ctx
                .http()
                .get(
                    `/videos/${victimVideoId}/manifest.m3u8?token=${encodeURIComponent(forged)}`,
                )

            expect(res.status).toBe(401)
        })
    })
})
