// The in-person demo club (docs/demo.md): its key, its name and the accounts
// the founder signs in with on the Mac and the phones. Everything the demo kit
// touches is keyed off these constants — the reset refuses any club whose key
// is not DEMO_CLUB_KEY or that was not generated as a demo (Workspace.isDemo).

export const DEMO_CLUB_KEY = 'arsenal-demo'
export const DEMO_CLUB_NAME = 'Академия единоборств «Арсенал»'
// A reserved-looking, non-routable domain: no code is ever mailed anywhere
// real for a generated account.
export const DEMO_EMAIL_DOMAIN = 'arsenal.demo'
// Fixed so the founder can print it on a card next to the QR.
export const DEMO_JOIN_CODE = 'ARSENA77'

export type DemoAccountKey =
    | 'owner'
    | 'admin'
    | 'directionManager'
    | 'coach'
    | 'student'
    | 'parent'

export type DemoAccount = {
    key: DemoAccountKey
    email: string
    firstname: string
    lastname: string
    roleLabel: string
    // Where the account shines in the demo script.
    summary: string
}

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
    {
        key: 'owner',
        email: `owner@${DEMO_EMAIL_DOMAIN}`,
        firstname: 'Артём',
        lastname: 'Орлов',
        roleLabel: 'Владелец клуба',
        summary:
            'Админка на Mac: дашборд и выручка, риск оттока, продления, импорт, направления, тарифы',
    },
    {
        key: 'admin',
        email: `admin@${DEMO_EMAIL_DOMAIN}`,
        firstname: 'Ольга',
        lastname: 'Кузнецова',
        roleLabel: 'Администратор',
        summary: 'Ученики, абонементы, долги, заявки на заморозку и в клуб',
    },
    {
        key: 'directionManager',
        email: `bjj@${DEMO_EMAIL_DOMAIN}`,
        firstname: 'Дмитрий',
        lastname: 'Волков',
        roleLabel: 'Руководитель направления БЖЖ (тренер)',
        summary: 'Аттестация на пояса, готовность учеников, объявления и тарифы БЖЖ',
    },
    {
        key: 'coach',
        email: `coach@${DEMO_EMAIL_DOMAIN}`,
        firstname: 'Сергей',
        lastname: 'Лебедев',
        roleLabel: 'Тренер',
        summary: 'Телефон: занятия каждый день, отметка посещений в 3 касания',
    },
    {
        key: 'student',
        email: `student@${DEMO_EMAIL_DOMAIN}`,
        firstname: 'Максим',
        lastname: 'Иванов',
        roleLabel: 'Ученик (БЖЖ + ММА)',
        summary:
            'Расписание, абонемент, пояс и готовность к аттестации, достижения, рейтинг, курсы',
    },
    {
        key: 'parent',
        email: `parent@${DEMO_EMAIL_DOMAIN}`,
        firstname: 'Елена',
        lastname: 'Соколова',
        roleLabel: 'Родитель (и ученица ОФП)',
        summary: 'Переключатель «Я / ребёнок»: Миша (БЖЖ, дети) и Аня (самбо, дети)',
    },
]

// Children have no e-mail and never sign in: the parent opens them from the
// «Я / ребёнок» switcher (X-Act-As).
export const DEMO_PARENT_CHILDREN: readonly { firstname: string; lastname: string }[] = [
    { firstname: 'Миша', lastname: 'Соколов' },
    { firstname: 'Аня', lastname: 'Соколова' },
]

export const demoAccount = (key: DemoAccountKey): DemoAccount =>
    DEMO_ACCOUNTS.find((a) => a.key === key) as DemoAccount

export const DEMO_ACCOUNT_EMAILS: ReadonlySet<string> = new Set(
    DEMO_ACCOUNTS.map((a) => a.email),
)
