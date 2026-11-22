import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// DEMO_LOGIN_CODE from the environment, else from the repo .env (the local
// stack's API reads the same file), so a local run needs no exported secret.
const demoLoginCode = (): string => {
  const fromEnv = process.env.DEMO_LOGIN_CODE?.trim()
  if (fromEnv) return fromEnv
  const dotenv = resolve(__dirname, '../../../.env')
  if (existsSync(dotenv)) {
    const line = readFileSync(dotenv, 'utf8')
      .split('\n')
      .find((l) => l.startsWith('DEMO_LOGIN_CODE='))
    const value = line?.slice('DEMO_LOGIN_CODE='.length).trim().replace(/^["']|["']$/g, '')
    if (value) return value
  }
  return ''
}

export const env = {
  baseUrl: (process.env.ADMIN_E2E_BASE_URL || 'http://localhost:4200').replace(/\/+$/, ''),
  apiUrl: (process.env.ADMIN_E2E_API_URL || 'http://localhost:3000').replace(/\/+$/, ''),
  demoLoginCode: demoLoginCode(),
  // A loader (skeleton, spinner, «Загрузка…») still visible after this long
  // counts as stuck.
  stuckMs: Number(process.env.ADMIN_E2E_STUCK_MS) || 15_000,
}
