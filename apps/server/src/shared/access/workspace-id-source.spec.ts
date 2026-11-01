import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'

// Static guard for C1: the club a handler acts on must be the club the guards
// authorized. Guards resolve it with resolveRequestWorkspaceId; a controller
// gets it from the path (`@Param('workspaceId')`) or from
// `@RequestWorkspaceId()`, never by reading `workspaceId` off a @Query()/@Body()
// DTO — that is how `admin/videos` once listed and deleted another club's
// videos while the guards had checked the caller's own club.

const SRC = join(__dirname, '..', '..')
const FEATURES_DIR = join(SRC, 'features')
const GUARDS_DIR = join(SRC, 'shared', 'guards')

const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
        const full = join(dir, name)
        return statSync(full).isDirectory() ? walk(full) : [full]
    })

// Comments may quote the forbidden patterns while explaining them.
const code = (file: string) =>
    readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1')

const sources = walk(SRC).filter(
    (f) => f.endsWith('.ts') && !f.endsWith('.spec.ts') && !f.includes('generated'),
)
const featureFiles = walk(FEATURES_DIR).filter((f) => !f.endsWith('.spec.ts'))
const controllers = featureFiles.filter((f) => f.endsWith('.controller.ts'))
const handlers = featureFiles.filter((f) => f.endsWith('.handler.ts'))
const where = (f: string) => relative(SRC, f)

const RAW_REQUEST_READ = /\b(?:params|query|body)\??\.workspaceId\b|\b(?:params|query|body)\??\.?\[\s*['"]workspaceId['"]\s*\]/
const HTTP = /@(?:Get|Post|Patch|Put|Delete)\(\s*(?:'([^']*)')?/g

describe('workspaceId has one source', () => {
    it('the club-resolving guards use the shared resolver', () => {
        for (const name of [
            'auth.guard.ts',
            'workspace-member.guard.ts',
            'feature-enabled.guard.ts',
        ]) {
            expect(code(join(GUARDS_DIR, name))).toContain(
                'resolveRequestWorkspaceId(',
            )
        }
    })

    it('no guard reads workspaceId off the request or the token itself', () => {
        const bad = walk(GUARDS_DIR)
            .filter((f) => !f.endsWith('.spec.ts'))
            .filter((f) => {
                const src = code(f)
                return RAW_REQUEST_READ.test(src) || /decodedToken\??\.workspaceId/.test(src)
            })
        expect(bad.map(where)).toEqual([])
    })

    it('no controller reads workspaceId from @Query()/@Body() or the raw request', () => {
        const bad: string[] = []
        for (const file of controllers) {
            const src = code(file)
            if (/@(?:Query|Body)\(\s*['"]workspaceId['"]/.test(src)) {
                bad.push(`${where(file)}: @Query/@Body('workspaceId')`)
            }
            if (/\.(?:query|body)\??\.workspaceId\b/.test(src)) {
                bad.push(`${where(file)}: request.query/body.workspaceId`)
            }
            const dtoVars = [
                ...src.matchAll(/@(?:Query|Body)\(\)\s+(\w+)\s*[:,)]/g),
            ].map((m) => m[1])
            for (const v of dtoVars) {
                const read = new RegExp(`\\b${v}\\??\\.workspaceId\\b`)
                const destructured = new RegExp(
                    `\\{[^}]*\\bworkspaceId\\b[^}]*\\}\\s*=\\s*${v}\\b`,
                )
                if (read.test(src) || destructured.test(src)) {
                    bad.push(`${where(file)}: ${v}.workspaceId`)
                }
            }
        }
        expect(bad).toEqual([])
    })

    it('no handler takes workspaceId from the request payload', () => {
        const bad = handlers.filter((f) => {
            const src = code(f)
            return (
                /\bpayload\??\.workspaceId\b/.test(src) ||
                /\{[^}]*\bworkspaceId\b[^}]*\}\s*=\s*(?:\w+\.)?payload\b/.test(src)
            )
        })
        expect(bad.map(where)).toEqual([])
    })

    it('a member-guarded route without :workspaceId in its path uses @RequestWorkspaceId()', () => {
        const bad: string[] = []
        let resolved = 0
        for (const file of controllers) {
            const src = code(file)
            if (!src.includes('WorkspaceMemberGuard')) continue
            const base = src.match(/@Controller\(\s*'([^']*)'/)?.[1] ?? ''
            const starts = [...src.matchAll(HTTP)]
            starts.forEach((m, i) => {
                const chunk = src.slice(
                    m.index as number,
                    starts[i + 1]?.index ?? src.length,
                )
                const path = `${base}/${m[1] ?? ''}`
                if (path.includes(':workspaceId')) return
                const method = chunk.match(/async (\w+)\(/)?.[1] ?? '?'
                if (chunk.includes('@RequestWorkspaceId()')) {
                    resolved++
                } else {
                    bad.push(`${where(file)} ${method}`)
                }
            })
        }
        expect(bad).toEqual([])
        // admin/videos: list, get, create, update, delete, bulk, complete-upload,
        // thumbnail-upload. Keeps the scan honest if the parsing ever breaks.
        expect(resolved).toBeGreaterThanOrEqual(8)
    })

    // L3: z.coerce.boolean() is Boolean(value) — the string 'false' is true.
    it('no request schema coerces booleans', () => {
        const bad = sources.filter((f) => /z\.coerce\.boolean\(/.test(code(f)))
        expect(bad.map(where)).toEqual([])
    })
})
