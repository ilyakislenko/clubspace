import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'

// Static guard for the federation hub's first rule
// (docs/design/2026-11-26-federation-hub-mvp.md §1, §3.1): an organization is
// not a tenant of people. Everything the org console shows about a club comes
// from the allow-listed readers in domains/organizations/* (which use the
// glossary functions of domains/metrics/*), so features/organizations/**
// queries only the org's own tables, global accounts and the audit journal —
// never a club table (workspace, member, promotion, payment, …) directly.

const SRC = join(__dirname, '..', '..')
const ORG_FEATURES = join(SRC, 'features', 'organizations')

const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
        const full = join(dir, name)
        return statSync(full).isDirectory() ? walk(full) : [full]
    })

// Comments may name the forbidden tables while explaining them.
const code = (file: string) =>
    readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1')

const files = walk(ORG_FEATURES).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))

// Prisma delegates (prisma.<model> / tx.<model>) the org side may touch:
// its own tables (organization*, the tournaments it runs — design
// docs/design/2026-11-27-tournaments.md §4.5), accounts, the journal.
const ALLOWED = /^(organization\w*|tournament\w*|user|auditEvent|consentRecord|\$transaction)$/
const DELEGATE = /\b(?:prisma|tx)\.([A-Za-z$]\w*)/g

describe('org console data sources', () => {
    it('scans the org console sources', () => {
        expect(files.length).toBeGreaterThanOrEqual(10)
    })

    it('features/organizations/** queries no club table directly', () => {
        const bad = files.flatMap((f) =>
            [...code(f).matchAll(DELEGATE)]
                .map((m) => m[1])
                .filter((model) => !ALLOWED.test(model))
                .map((model) => `${relative(SRC, f)}: ${model}`),
        )
        expect(bad).toEqual([])
    })

    it('reads club data only through domains/organizations and domains/metrics', () => {
        const DOMAIN_IMPORT = /from '(?:\.\.\/)+domains\/([\w-]+)\//g
        const ALLOWED_DOMAINS = new Set([
            'organizations',
            'metrics',
            // Tournament readers apply the §2.3 visibility rules.
            'tournaments',
            // Not club data: the journal, logo signing/upload rules, delivery.
            'audit',
            'workspace',
            'realtime',
            'notifications',
        ])
        const bad = files.flatMap((f) =>
            [...code(f).matchAll(DOMAIN_IMPORT)]
                .map((m) => m[1])
                .filter((d) => !ALLOWED_DOMAINS.has(d))
                .map((d) => `${relative(SRC, f)}: domains/${d}`),
        )
        expect(bad).toEqual([])
    })
})
