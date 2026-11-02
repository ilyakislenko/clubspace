import {
    DEMO_ACCOUNTS,
    DEMO_CLUB_KEY,
    DEMO_CLUB_NAME,
    DEMO_PARENT_CHILDREN,
    type DemoAccount,
} from './demo-accounts'
import {
    RITM_ACCOUNTS,
    RITM_CLUB_KEY,
    RITM_CLUB_NAME,
    RITM_PARENT_CHILDREN,
} from './ritm-demo.accounts'

// The in-person demo clubs (docs/demo.md): ACADEMY (единоборства) and «Ритм»
// (танцевальная студия). Each is created, reset and signed into on its own:
// the reset touches only the club holding its key AND flagged isDemo, and the
// fixed demo code opens only its listed accounts, each belonging to nothing but
// its own demo club. Both turn on with the same DEMO_MODE / DEMO_LOGIN_CODE;
// DEMO_WORKSPACE_KEY stays academy-demo (resolveDemoMode).
export const DEMO_CLUB_IDS = ['academy', 'ritm'] as const
export type DemoClubId = (typeof DEMO_CLUB_IDS)[number]

export type DemoClubIdentity = {
    id: DemoClubId
    key: string
    name: string
    timezone: string
    accounts: readonly DemoAccount[]
    // Children have no e-mail and never sign in: the parent account opens them
    // from the «Я / ребёнок» switcher (X-Act-As).
    children: readonly { firstname: string; lastname: string }[]
    // What the parent sees for a child (console «Демо-клубы»).
    childSummary: string
}

export const DEMO_CLUBS: Readonly<Record<DemoClubId, DemoClubIdentity>> = {
    academy: {
        id: 'academy',
        key: DEMO_CLUB_KEY,
        name: DEMO_CLUB_NAME,
        timezone: 'Asia/Tomsk',
        accounts: DEMO_ACCOUNTS,
        children: DEMO_PARENT_CHILDREN,
        childSummary: 'Расписание, посещения, пояс и абонемент ребёнка — у родителя в приложении',
    },
    ritm: {
        id: 'ritm',
        key: RITM_CLUB_KEY,
        name: RITM_CLUB_NAME,
        timezone: 'Asia/Tomsk',
        accounts: RITM_ACCOUNTS,
        children: RITM_PARENT_CHILDREN,
        childSummary: 'Расписание, посещения, абонемент и видео связок ребёнка — у родителя в приложении',
    },
}

export const isDemoClubId = (value: unknown): value is DemoClubId =>
    typeof value === 'string' && (DEMO_CLUB_IDS as readonly string[]).includes(value)

// Every fixed demo address of every demo club, lower-case.
export const DEMO_ACCOUNT_EMAILS: ReadonlySet<string> = new Set(
    DEMO_CLUB_IDS.flatMap((id) => DEMO_CLUBS[id].accounts.map((a) => a.email)),
)

// The demo club a fixed demo address belongs to; null for any other address.
export const demoClubOfAccountEmail = (email: string | null | undefined): DemoClubIdentity | null => {
    const normalized = email?.trim().toLowerCase()
    if (!normalized) return null
    const id = DEMO_CLUB_IDS.find((c) => DEMO_CLUBS[c].accounts.some((a) => a.email === normalized))
    return id ? DEMO_CLUBS[id] : null
}
