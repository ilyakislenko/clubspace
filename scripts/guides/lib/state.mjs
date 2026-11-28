// What a scenario has to undo (ids of the rows it created or changed), kept in
// <work>/<id>/cleanup.json until the undo succeeds: a run that failed midway
// is cleaned up by the next one.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { config } from './env.mjs'

const file = (id) => join(config.workDir, id, 'cleanup.json')

export function recall(id) {
    return existsSync(file(id)) ? JSON.parse(readFileSync(file(id), 'utf8')) : null
}

export function remember(id, data) {
    mkdirSync(join(config.workDir, id), { recursive: true })
    writeFileSync(file(id), JSON.stringify(data, null, 2))
}

export function forget(id) {
    rmSync(file(id), { force: true })
}
