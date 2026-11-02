import { DEMO_CLUB_KEY } from '../../domains/demo/demo-accounts'
import { DEMO_ACCOUNT_EMAILS } from '../../domains/demo/demo-clubs'
import { environment } from '../../environments/environment'
import { fixedCodeEquals, isTrivialCode } from './store-review.util'

type DemoModeEnv = { enabled: boolean; workspaceKey?: string; code?: string }

export type DemoModeConfig = { workspaceKey: string; code: string }

// Validates DEMO_MODE. Null when off; throws (the server refuses to boot) when
// it is on but does not name the generated demo club, or the fixed code is
// missing or guessable. Naming the key is the interlock: the operator states
// which club the kit may wipe, and it can only ever be the demo one. The second
// demo club («Ритм», ritm-demo) rides on the same switch with its fixed key —
// no extra variable (demo-clubs.ts).
export const resolveDemoMode = (env: DemoModeEnv): DemoModeConfig | null => {
    if (!env.enabled) return null
    const workspaceKey = env.workspaceKey?.trim()
    if (workspaceKey !== DEMO_CLUB_KEY) {
        throw new Error(
            `[startup] DEMO_MODE=true needs DEMO_WORKSPACE_KEY=${DEMO_CLUB_KEY} — demo mode never acts on another club`,
        )
    }
    const code = env.code?.trim()
    if (!code || !/^\d{6}$/.test(code)) {
        throw new Error(
            '[startup] DEMO_LOGIN_CODE must be exactly 6 digits when DEMO_MODE=true',
        )
    }
    if (isTrivialCode(code)) {
        throw new Error(
            '[startup] DEMO_LOGIN_CODE is too easy to guess (repeated digits, a straight run or a known pattern)',
        )
    }
    return { workspaceKey, code }
}

// Fails closed at runtime: a config that would not boot means "off".
const current = (): DemoModeConfig | null => {
    try {
        return resolveDemoMode(environment.demo)
    } catch {
        return null
    }
}

export const isDemoModeOn = (): boolean => current() !== null

// One of the fixed demo accounts (of any demo club), and only while demo mode
// is on. isDemoOnlyAccount then pins the account to its own demo club.
export const isDemoAccountEmail = (email: string | null): boolean =>
    email !== null &&
    isDemoModeOn() &&
    DEMO_ACCOUNT_EMAILS.has(email.trim().toLowerCase())

export const demoCodeMatches = (code: string): boolean => {
    const config = current()
    return config !== null && fixedCodeEquals(code, config.code)
}
