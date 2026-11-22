import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'

// Static guard for the payments journal (docs/design/2026-11-15-payments-journal.md
// §3.3): it orders and filters sales on paidAt alone, so every write that
// sets a sale's isPaid must set paidAt in the same data — or the sale would
// count in revenue (paidOn falls back to createdAt) and be missing from the
// journal. The demo generators build their rows as plain objects; their
// pushes must date the payment and name who recorded it.

const SRC = join(__dirname, '..', '..')

const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
        const full = join(dir, name)
        if (statSync(full).isDirectory()) return name === 'generated' ? [] : walk(full)
        return full.endsWith('.ts') && !full.endsWith('.spec.ts') ? [full] : []
    })

// The argument list of the call opening at `open` (the index of its '(').
const callArgs = (src: string, open: number): string => {
    let depth = 0
    for (let i = open; i < src.length; i++) {
        if (src[i] === '(') depth++
        if (src[i] === ')' && --depth === 0) return src.slice(open, i + 1)
    }
    return src.slice(open)
}

const files = walk(SRC).map((file) => ({ file: relative(SRC, file), src: readFileSync(file, 'utf8') }))

const WRITE = /\b(subscription|eventRegistration)\.(create|createMany|update|updateMany|upsert)\(/g

const writes = files.flatMap(({ file, src }) =>
    [...src.matchAll(WRITE)].map((m) => {
        const args = callArgs(src, (m.index as number) + m[0].length - 1)
        const data = args.slice(Math.max(args.indexOf('data:'), 0))
        return { where: `${file} ${m[1]}.${m[2]}`, data }
    }),
)

describe('sale writers keep paidAt with isPaid', () => {
    it('finds the writers', () => {
        // grantFromPlanInTx, markPaid, unmarkPaid, club import, the ticket
        // mark / unmark / online mark / refund.
        expect(writes.filter((w) => /\bisPaid:/.test(w.data)).length).toBeGreaterThanOrEqual(7)
    })

    it('every data that sets isPaid sets paidAt too', () => {
        const bad = writes.filter((w) => /\bisPaid:/.test(w.data) && !/\bpaidAt:/.test(w.data))
        expect(bad.map((w) => w.where)).toEqual([])
    })

    it('every demo abonement row dates its payment and names who recorded it', () => {
        const pushes = files
            .filter(({ file }) => file.startsWith(join('domains', 'demo')))
            .flatMap(({ file, src }) =>
                [...src.matchAll(/\bsubscriptions\.push\(/g)].map((m) => ({
                    file,
                    args: callArgs(src, (m.index as number) + m[0].length - 1),
                })),
            )
            .filter((p) => /\bisPaid:/.test(p.args))
        // The academy and the dance studio.
        expect(pushes.length).toBeGreaterThanOrEqual(2)
        expect(
            pushes.filter((p) => !/\bpaidAt:/.test(p.args) || !/\bmarkedPaidById:/.test(p.args)).map((p) => p.file),
        ).toEqual([])
    })
})
