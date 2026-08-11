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
        'POST /admin/videos/{id}/thumbnail-upload': {
            workspaceId,
            contentType: 'image/jpeg',
        },
        'POST /admin/videos/{id}/complete-upload': { workspaceId },
    })[label] ?? {}

// Creation takes no existing resource id, so there is nothing of the victim's
// to point at — a different test, not this one.
const NOT_A_RESOURCE_PROBE = new Set([
    'POST /admin/videos',
    'POST /admin/videos/bulk',
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
        'POST /admin/videos/{id}/complete-upload',
        'expects the raw upload to exist in the bucket before it will queue a transcode',
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
    let outsiderWorkspaceId: string
    let victimVideoId: string
    let outsiderVideoId: string
    let victimOwnerAuth: [string, string]
    let outsiderAuth: [string, string]
    let strangerAuth: [string, string]

    const buildUrl = (op: Operation, workspaceId: string) => {
        const url = op.path
            .replace('{videoId}', victimVideoId)
            .replace('{id}', victimVideoId)
        return op.needsWorkspaceQuery ? `${url}?workspaceId=${workspaceId}` : url
    }

    const request = (
        op: Operation,
        auth?: [string, string],
        claimedWorkspaceId?: string,
    ) => {
        const workspaceId = claimedWorkspaceId ?? victimWorkspaceId
        const req = ctx.http()[
            op.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete'
        ](buildUrl(op, workspaceId))
        const body = bodyFor(`${op.method} ${op.path}`, workspaceId)
        return auth ? req.set(...auth).send(body) : req.send(body)
    }

    // Routes that take both a club the caller can state truthfully and a
    // resource id they can lie about. A collection route naming your own club
    // is just a list of your own videos, answered 200 quite correctly.
    const pairsWorkspaceWithResource = (op: Operation) =>
        /\{(id|videoId)\}/.test(op.path) &&
        (op.needsWorkspaceQuery ||
            'workspaceId' in bodyFor(`${op.method} ${op.path}`, victimWorkspaceId))

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
                // The offline download only signs a URL for the raw object, it
                // never fetches it — so with these two set the club's own owner
                // gets a real 200 and that route keeps a positive control.
                rawBucket: 'test-bucket',
                rawKey: `videos/${victimWorkspaceId}/raw/source.mp4`,
                duration: 120,
            },
            select: { id: true },
        })
        victimVideoId = video.id

        const outsider = await createWorkspace(ctx, { name: 'Outsider Club' })
        outsiderWorkspaceId = outsider.workspace.id
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

    // A loader matching nothing would make every case below pass while testing
    // air — but so would a loader matching one route fewer. Rename a video
    // route out of the /videos prefix and the sweep would quietly shrink, with
    // every remaining assertion still green, so the count is pinned exactly.
    it('found the resource-scoped surface to probe', () => {
        expect(OPERATIONS.length).toBe(11)
    })

    // The exclusion lists are the other way the sweep can shrink in silence:
    // an entry that matches no live route excludes nothing today and hides a
    // real route tomorrow if the name comes back.
    it('excludes only routes that still exist', () => {
        const spec = JSON.parse(
            fs.readFileSync(
                path.resolve(__dirname, '../../../../open-api.json'),
                'utf8',
            ),
        ) as { paths: Record<string, Record<string, unknown>> }

        const live = new Set(
            Object.entries(spec.paths).flatMap(([route, methods]) =>
                Object.keys(methods).map(
                    (method) => `${method.toUpperCase()} ${route}`,
                ),
            ),
        )

        const stale = [
            ...NOT_A_RESOURCE_PROBE,
            ...NO_POSITIVE_CONTROL.keys(),
        ].filter((label) => !live.has(label))

        expect(stale).toEqual([])
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
        // 403 exactly, not any 4xx. Three of these routes have no positive
        // control, and two authorize inside the handler — after the Zod pipe.
        // Add a required field to one of those schemas and a loose assertion
        // would keep passing on a 400 that has nothing to do with tenancy.
        it('refuses the owner of another club', async () => {
            const res = await request(op, outsiderAuth)

            expect(res.status).toBe(403)
        })

        it('refuses a signed-in user with no club', async () => {
            const res = await request(op, strangerAuth)

            expect(res.status).toBe(403)
        })

        // The request an attacker actually sends. Naming the victim's club is
        // stopped by WorkspaceMemberGuard at the door; naming your own club and
        // handing over someone else's video id walks past the guard, and the
        // only thing left is the workspace clause in the service's query.
        // Simplify that to findUnique({ id }) and every other case here still
        // passes — this is the one that notices.
        if (pairsWorkspaceWithResource(op)) {
            it('refuses their own club paired with a foreign video', async () => {
                const res = await request(
                    op,
                    outsiderAuth,
                    outsiderWorkspaceId,
                )

                expect(res.status).toBe(404)
            })
        }

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
    // 401 exactly, never a generic 4xx. Serving the real playlist needs an
    // object in the bucket that this fixture does not create, so the honest
    // alternative outcome here is a 5xx from storage — and a loose assertion
    // would let a deleted token check pass on an empty bucket.
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

        // Asked for a path outside the video's own prefix: the route rejects
        // that with 400 *after* verifying the token and before touching S3, so
        // a 400 here means the token was accepted — proven without an object in
        // the bucket, and without a storage stack trace in every run's output.
        it('is accepted for the video it was minted for', async () => {
            const token = await mintToken(victimVideoId, victimOwnerAuth)

            const res = await ctx
                .http()
                .get(
                    `/videos/${victimVideoId}/manifest.m3u8?token=${encodeURIComponent(token)}&path=${encodeURIComponent('videos/elsewhere/master.m3u8')}`,
                )

            expect(res.status).toBe(400)
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
            // Swapping the last character for a different one, rather than
            // overwriting it with a constant: base64url's final character of a
            // 256-bit signature has 16 possible values, so a fixed replacement
            // leaves the token unchanged roughly once in a thousand runs, and
            // the "forgery" would then be accepted.
            const forged =
                token.slice(0, -1) + (token.endsWith('A') ? 'E' : 'A')
            expect(forged).not.toBe(token)

            const res = await ctx
                .http()
                .get(
                    `/videos/${victimVideoId}/manifest.m3u8?token=${encodeURIComponent(forged)}`,
                )

            expect(res.status).toBe(401)
        })

        // A valid token names one video, but `path` names an S3 key outright —
        // the one input on this route that could reach another club's bytes
        // while the token itself checks out. The route pins it to the video's
        // own HLS prefix; these are the three ways past a careless version of
        // that check.
        it.each([
            ['another club, stated outright', 'hls/master.m3u8'],
            ['traversal back out of the prefix', 'hls/../../%%WS%%/hls/master.m3u8'],
            ['a prefix that merely starts the same', 'hls-evil/master.m3u8'],
        ])('refuses a path pointing at %s', async (_label, suffix) => {
            const token = await mintToken(outsiderVideoId, outsiderAuth)
            const target = `videos/${victimWorkspaceId}/${suffix.replace('%%WS%%', victimWorkspaceId)}`

            const res = await ctx
                .http()
                .get(
                    `/videos/${outsiderVideoId}/manifest.m3u8?token=${encodeURIComponent(token)}&path=${encodeURIComponent(target)}`,
                )

            expect(res.status).toBe(400)
        })
    })
})
