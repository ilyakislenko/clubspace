import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'

// The ИИ-ассистент and MCP tools send what they read to an external model; a
// date of birth adds personal data there without a use
// (docs/design/2026-11-26-door-checkin-and-birthdays.md §6). Pinned on the
// source: no tool, prompt or chat path may select or mention it, nor the
// member check-in card.
const ROOTS = [
    join(__dirname),
    join(__dirname, '..', 'ai-chat'),
    join(__dirname, '..', '..', 'domains', 'ai-assistant'),
]

const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
        const full = join(dir, name)
        return statSync(full).isDirectory() ? walk(full) : [full]
    })

describe('AI tools never read a date of birth or a check-in card', () => {
    const files = ROOTS.flatMap(walk).filter(
        (f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'),
    )

    it('scans the tool sources', () => {
        expect(files.length).toBeGreaterThan(10)
    })

    it.each(['dateOfBirth', 'check-in-card', 'CheckInCard'])('no source mentions %s', (word) => {
        const hits = files
            .filter((f) => readFileSync(f, 'utf8').includes(word))
            .map((f) => relative(join(__dirname, '..', '..'), f))
        expect(hits).toEqual([])
    })
})
