#!/usr/bin/env node
// Records the «Видеоинструкции» and assembles the published files.
//
//   node scripts/guides/record.mjs                  # all guides
//   node scripts/guides/record.mjs attendance money # some of them
//   node scripts/guides/record.mjs --assemble-only owner-setup  # re-cut the last recording
//
// Stand, accounts and output: docs/guides.md. Output: <GUIDES_OUT_DIR>/
// <id>-<version>.mp4 / .jpg / .srt and guides.json (the manifest /help reads;
// entries of guides not re-recorded this run are kept).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

import { assemble } from './lib/assemble.mjs'
import { config } from './lib/env.mjs'
import { closeBrowser } from './lib/recorder.mjs'
import invite from './scenarios/invite.mjs'
import ownerSetup from './scenarios/owner-setup.mjs'

// Manifest order = order on /help (grouped by role there). The manifest ids are
// a contract with the admin help panel: owner-setup, invite, attendance,
// video-course, money, student, federation (docs/guides.md).
const GUIDES = [ownerSetup, invite]

const { values: flags, positionals } = parseArgs({
    allowPositionals: true,
    options: { 'assemble-only': { type: 'boolean', default: false } },
})
const unknown = positionals.filter((id) => !GUIDES.some((g) => g.id === id))
if (unknown.length) {
    console.error(`Неизвестные инструкции: ${unknown.join(', ')}. Есть: ${GUIDES.map((g) => g.id).join(', ')}`)
    process.exit(1)
}
const selected = positionals.length ? GUIDES.filter((g) => positionals.includes(g.id)) : GUIDES

const manifestFile = join(config.outDir, 'guides.json')
mkdirSync(config.outDir, { recursive: true })
const previous = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : []

const results = new Map()
let failed = false
try {
    for (const guide of selected) {
        const started = Date.now()
        const recordingFile = join(config.workDir, guide.id, 'recording.json')
        try {
            let recording
            if (flags['assemble-only']) {
                recording = JSON.parse(readFileSync(recordingFile, 'utf8'))
            } else {
                console.log(`▶ ${guide.id}: запись…`)
                recording = await guide.record()
                writeFileSync(recordingFile, JSON.stringify(recording, null, 2))
            }
            console.log(`▶ ${guide.id}: сборка…`)
            const out = await assemble(guide, recording)
            results.set(guide.id, { id: guide.id, role: guide.role, title: guide.title, ...out })
            console.log(`✔ ${guide.id}: ${out.file} — ${out.durationSec} с (${Math.round((Date.now() - started) / 1000)} с)`)
            if (out.durationSec < 60 || out.durationSec > 90) console.warn(`  ⚠ ${guide.id}: длительность вне 60–90 с`)
        } catch (e) {
            failed = true
            console.error(`✗ ${guide.id}: ${e.stack ?? e}`)
        }
    }
} finally {
    await closeBrowser()
}

const manifest = GUIDES.map((g) => {
    const fresh = results.get(g.id)
    if (fresh) return { id: fresh.id, role: fresh.role, title: fresh.title, file: fresh.file, poster: fresh.poster, durationSec: fresh.durationSec }
    return previous.find((p) => p.id === g.id)
}).filter(Boolean)
writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Манифест: ${manifestFile} (${manifest.length} шт.)`)
process.exit(failed ? 1 : 0)
