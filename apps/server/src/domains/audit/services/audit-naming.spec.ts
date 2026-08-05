import * as fs from 'fs'
import * as path from 'path'

// The audit-page filtering UI splits action strings on the first dot
// to derive the entity tab. New actions that don't match
// "<entity>.<camelCaseVerb>" silently break the filter — this test
// scans the AuditAction union and fails CI if anyone slips a stray
// shape through.
describe('AuditAction naming convention', () => {
    const file = path.join(__dirname, 'audit.service.ts')
    const source = fs.readFileSync(file, 'utf8')

    // Capture every quoted string member of the AuditAction union.
    const unionMatch = source.match(/export type AuditAction\s*=\s*([^]+?)\n\n/)
    if (!unionMatch) {
        throw new Error(
            'AuditAction union not found in audit.service.ts — naming check skipped',
        )
    }
    // Strip line comments first. The extractor below takes anything between
    // single quotes, and an apostrophe in prose ("the club's journal") reads
    // as an opening quote — which turned a comment into half a dozen bogus
    // "actions" and failed this test for a reason that had nothing to do with
    // naming. Comments are not part of the union.
    const unionBody = unionMatch[1].replace(/^\s*\/\/.*$/gm, '')
    const actions = Array.from(unionBody.matchAll(/'([^']+)'/g), (m) => m[1])

    it('finds at least a dozen actions defined', () => {
        expect(actions.length).toBeGreaterThan(12)
    })

    it.each(actions.map((a) => [a]))(
        '"%s" matches <entity>.<camelCaseVerb>',
        (action) => {
            // Allows dotted second segments only when the verb itself is
            // a single camelCase word — keeps "group.slotCreate" legal
            // and "group.slot.create" rejected.
            expect(action).toMatch(/^[a-z]+\.[a-z][a-zA-Z]+$/)
        },
    )
})
