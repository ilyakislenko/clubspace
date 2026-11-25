import type { DemoAccount } from './demo-accounts'

// The third demo club «Беркут» (docs/demo.md, «Федерация»): a small generated
// grappling club that is the second member of the demo federation next to
// ACADEMY. Entirely fictional — the club, its coaches, students and address
// are made up.

export const BERKUT_CLUB_KEY = 'berkut-demo'
export const BERKUT_CLUB_NAME = 'Беркут'
export const BERKUT_EMAIL_DOMAIN = 'berkut.demo'
// Join-code alphabet: no 0/O, 1/I/L.
export const BERKUT_JOIN_CODE = 'BERKUT24'

export const BERKUT_ACCOUNTS: readonly DemoAccount[] = [
    {
        key: 'owner',
        email: `owner@${BERKUT_EMAIL_DOMAIN}`,
        firstname: 'Игорь',
        lastname: 'Ветров',
        roleLabel: 'Владелец клуба (демо)',
        summary:
            'Админка на Mac: «Настройки → Федерация» (клуб открыл федерации «Регулярный доход»), «Пояса» со стандартом федерации',
    },
    {
        key: 'coach',
        email: `coach@${BERKUT_EMAIL_DOMAIN}`,
        firstname: 'Алексей',
        lastname: 'Мартынов',
        roleLabel: 'Тренер',
        summary: 'Телефон: «События» — записать своих учеников на турнир федерации',
    },
]

// Children have parents in the generated roster, none of them signs in.
export const BERKUT_PARENT_CHILDREN: readonly { firstname: string; lastname: string }[] = []
