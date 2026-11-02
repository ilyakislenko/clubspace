import type { DemoAccount } from './demo-accounts'

// The second in-person demo club (docs/demo.md, «Танцевальная студия»): a
// dance studio for showing ClubSpace to studios. Entirely fictional — the
// studio, its teachers and students are made up.

export const RITM_CLUB_KEY = 'ritm-demo'
export const RITM_CLUB_NAME = 'Студия танца «Ритм»'
export const RITM_EMAIL_DOMAIN = 'ritm.demo'
// Join-code alphabet: no 0/O, 1/I/L.
export const RITM_JOIN_CODE = 'RTMDANCE'

export const RITM_ACCOUNTS: readonly DemoAccount[] = [
    {
        key: 'owner',
        email: `owner@${RITM_EMAIL_DOMAIN}`,
        firstname: 'Марина',
        lastname: 'Белова',
        roleLabel: 'Владелица студии (демо)',
        summary:
            'Админка на Mac: обзор и выручка, мастер-класс с записью и листом ожидания, тарифы 4/8/12, направления',
    },
    {
        key: 'coach',
        email: `pedagog@${RITM_EMAIL_DOMAIN}`,
        firstname: 'Алина',
        lastname: 'Королёва',
        roleLabel: 'Педагог High heels',
        summary: 'Телефон: «Сегодня вы ведёте», отметка посещений, видео связок для групп',
    },
    {
        key: 'student',
        email: `student@${RITM_EMAIL_DOMAIN}`,
        firstname: 'Дарья',
        lastname: 'Миронова',
        roleLabel: 'Ученица (High heels + Contemporary)',
        summary: 'Расписание, абонемент 8 занятий, запись на мастер-класс, видео связок, достижения',
    },
    {
        key: 'parent',
        email: `parent@${RITM_EMAIL_DOMAIN}`,
        firstname: 'Ирина',
        lastname: 'Лебедева',
        roleLabel: 'Родитель (и ученица High heels)',
        summary: 'Переключатель «Я / ребёнок»: Соня (дети 6–9) и Вика (дети 10–13)',
    },
]

export const RITM_PARENT_CHILDREN: readonly { firstname: string; lastname: string }[] = [
    { firstname: 'Соня', lastname: 'Лебедева' },
    { firstname: 'Вика', lastname: 'Лебедева' },
]
