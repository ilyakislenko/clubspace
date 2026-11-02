// The in-person demo club (docs/demo.md): its key, its name and the accounts
// the founder signs in with on the Mac and the phones. Everything the demo kit
// touches is keyed off these constants — the reset refuses any club whose key
// is not DEMO_CLUB_KEY or that was not generated as a demo (Workspace.isDemo).
//
// The club mirrors a real network («ACADEMY», Томск + Северск): its branches,
// groups, schedule and coaches are real; students and parents are synthetic.

export const DEMO_CLUB_KEY = 'academy-demo'
export const DEMO_CLUB_NAME = 'ACADEMY'
// A reserved-looking, non-routable domain: no code is ever mailed anywhere
// real for a generated account.
export const DEMO_EMAIL_DOMAIN = 'academy.demo'
// Fixed so the founder can print it on a card next to the QR.
export const DEMO_JOIN_CODE = 'ACADEMY7'

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
    // null when only an initial is known (a real coach).
    firstname: string | null
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
        roleLabel: 'Владелец клуба (демо)',
        summary:
            'Админка на Mac: обзор и выручка, «Кто пропадает», продления, импорт, направления, тарифы',
    },
    {
        key: 'admin',
        email: `admin@${DEMO_EMAIL_DOMAIN}`,
        firstname: 'Ольга',
        lastname: 'Кузнецова',
        roleLabel: 'Администратор',
        summary: 'Участники, абонементы, долги, заявки на заморозку и в клуб',
    },
    {
        key: 'directionManager',
        email: `bjj@${DEMO_EMAIL_DOMAIN}`,
        firstname: 'Д.',
        lastname: 'Решетюк',
        roleLabel: 'Руководитель направления БЖЖ (тренер)',
        summary: 'Аттестация на пояса, готовность учеников, объявления и тарифы БЖЖ; группы в «Юпитере», «Шариках», «Муромце»',
    },
    {
        key: 'coach',
        email: `coach@${DEMO_EMAIL_DOMAIN}`,
        firstname: 'Роман',
        lastname: 'Савельев',
        roleLabel: 'Главный тренер',
        summary: 'Телефон: занятия каждый день («Дворец спорта», Северск), отметка посещений в 3 касания, аттестации',
    },
    {
        key: 'student',
        email: `student@${DEMO_EMAIL_DOMAIN}`,
        firstname: 'Максим',
        lastname: 'Иванов',
        roleLabel: 'Ученик (BJJ + ММА)',
        summary:
            'Расписание, абонемент, пояс и готовность к аттестации, стаж, достижения, рейтинг, курсы',
    },
    {
        key: 'parent',
        email: `parent@${DEMO_EMAIL_DOMAIN}`,
        firstname: 'Елена',
        lastname: 'Соколова',
        roleLabel: 'Родитель (и ученица BJJ утро)',
        summary: 'Переключатель «Я / ребёнок»: Миша (старшие дети) и Аня (младшие дети)',
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

export const demoAccountName = (a: { firstname: string | null; lastname: string }): string =>
    a.firstname ? `${a.firstname} ${a.lastname}` : a.lastname
