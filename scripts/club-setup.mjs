#!/usr/bin/env node
// Sets a club up from a JSON description through the public API, the way the
// owner would click it in the admin: gyms, directions and their managers,
// coaches (invited by e-mail), groups with weekly schedule, tariffs, rank
// ladders, the «О клубе» page (rules, contacts, links) and club settings.
// Members come afterwards through «Импорт клуба» (CSV/Excel).
//
//   node scripts/club-setup.mjs club.json --api https://api.example.ru --email owner@club.ru
//   node scripts/club-setup.mjs club.json --dry-run      # only print what it would do
//
// Re-running is safe: everything is matched by name (groups by name + gym,
// slots by day + start time, coaches by e-mail), only what is missing is
// created and changed fields are updated. Nothing is ever deleted — things
// the club has but the file doesn't are listed at the end.
//
// Sign-in is the owner's: the code from the e-mail is asked for in the
// terminal (or CLUBSPACE_CODE). CLUBSPACE_TOKEN skips the sign-in. The club
// must exist already (console «Платформа» → «Новый клуб», or self-serve sign-up)
// and the owner must have signed in to the admin once (personal data consent).
// The format is described in docs/club-setup.md; an example is
// scripts/club-setup.example.json. Needs Node 20+, no packages.

import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'

const USAGE =
    'Использование: node scripts/club-setup.mjs <клуб.json> [--api URL] [--email почта-владельца] [--dry-run]'

const args = process.argv.slice(2)
const flag = (name) => {
    const i = args.indexOf(name)
    if (i === -1) return undefined
    const value = args[i + 1]
    args.splice(i, 2)
    return value
}
const dryRun = args.includes('--dry-run')
if (dryRun) args.splice(args.indexOf('--dry-run'), 1)
const apiArg = flag('--api')
const emailArg = flag('--email')
const file = args[0]
if (!file || args.length > 1) {
    console.error(USAGE)
    process.exit(2)
}

const spec = JSON.parse(readFileSync(file, 'utf8'))
const API = (apiArg || spec.api || process.env.CLUBSPACE_API || 'http://localhost:3000').replace(/\/$/, '')
const OWNER_EMAIL = (emailArg || spec.ownerEmail || process.env.CLUBSPACE_EMAIL || '').trim().toLowerCase()

// ---------------------------------------------------------------- helpers

class SetupError extends Error {}

const fail = (message) => {
    throw new SetupError(message)
}

// Lower-case, «ё» → «е», spaces collapsed: «Дети  старшие» = «дети старшие».
const nameKey = (s) =>
    String(s ?? '')
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/\s+/g, ' ')
        .trim()

const log = {
    created: [],
    updated: [],
    kept: 0,
    warnings: [],
    extra: [],
}
const say = (line) => console.log(line)
const created = (what) => {
    log.created.push(what)
    say(`  + ${what}${dryRun ? ' (пробный прогон)' : ''}`)
}
const updated = (what) => {
    log.updated.push(what)
    say(`  ~ ${what}${dryRun ? ' (пробный прогон)' : ''}`)
}
const warn = (what) => {
    log.warnings.push(what)
    say(`  ! ${what}`)
}

let accessToken = process.env.CLUBSPACE_TOKEN || null
let refreshToken = null

const request = async (method, path, body, { auth = true, retry = true } = {}) => {
    const res = await fetch(API + path, {
        method,
        headers: {
            'content-type': 'application/json',
            ...(auth && accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    let data = null
    try {
        data = text ? JSON.parse(text) : null
    } catch {
        data = text
    }
    if (res.status === 401 && auth && retry && refreshToken) {
        const fresh = await request('POST', '/refresh-token', { refreshToken }, { auth: false, retry: false })
        accessToken = fresh.accessToken
        refreshToken = fresh.refreshToken ?? refreshToken
        return request(method, path, body, { auth, retry: false })
    }
    if (!res.ok) {
        if (data?.code === 'CONSENT_REQUIRED') {
            fail(
                'Владелец ещё не принял согласие на обработку персональных данных. ' +
                    'Войдите один раз в админку этой почтой, примите согласие и запустите скрипт снова.',
            )
        }
        const message = typeof data === 'object' && data?.message ? data.message : text.slice(0, 300)
        fail(`${method} ${path} → ${res.status}: ${message}`)
    }
    return data
}

// Writes are skipped in a dry run; the caller gets a stand-in id so later
// steps can still be planned against it.
let fakeSeq = 0
const write = async (method, path, body) => {
    if (dryRun) return { id: `dry-${++fakeSeq}`, userId: `dry-${++fakeSeq}` }
    return request(method, path, body)
}

const DAYS = { пн: 1, вт: 2, ср: 3, чт: 4, пт: 5, сб: 6, вс: 7 }
const DAY_NAMES = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

const toMinutes = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number)
    return h * 60 + m
}
const pad = (n) => String(n).padStart(2, '0')
const normTime = (t) => {
    const m = /^(\d{1,2})[:.](\d{2})$/.exec(String(t).trim())
    if (!m) fail(`Время «${t}» — нужен формат ЧЧ:ММ`)
    return `${pad(Number(m[1]))}:${m[2]}`
}

// «Пн Ср Пт 20:00–21:30», «Сб 14:00 60» or { days: [...], time, minutes }.
const parseSchedule = (entry, where) => {
    if (typeof entry === 'string') {
        const parts = entry.replace(/[–—]/g, '-').replace(/,/g, ' ').split(/\s+/).filter(Boolean)
        const days = []
        let time = null
        let minutes = null
        for (const part of parts) {
            const d = DAYS[part.toLowerCase().slice(0, 2)]
            if (d && /^[а-яё]+$/i.test(part)) {
                days.push(d)
            } else if (/^\d{1,2}[:.]\d{2}-\d{1,2}[:.]\d{2}$/.test(part)) {
                const [from, to] = part.split('-').map(normTime)
                time = from
                minutes = toMinutes(to) - toMinutes(from)
            } else if (/^\d{1,2}[:.]\d{2}$/.test(part)) {
                time = normTime(part)
            } else if (/^\d+$/.test(part) && time) {
                minutes = Number(part)
            } else {
                fail(`${where}: не понял «${part}» в расписании «${entry}»`)
            }
        }
        if (!days.length || !time || !minutes || minutes <= 0) {
            fail(`${where}: в «${entry}» нужны дни, время начала и конец (или длительность в минутах)`)
        }
        return days.map((dayOfWeek) => ({ dayOfWeek, startTime: time, durationMin: minutes }))
    }
    const days = (entry.days ?? []).map((d) => (typeof d === 'number' ? d : DAYS[String(d).toLowerCase().slice(0, 2)]))
    if (!days.length || days.some((d) => !d)) fail(`${where}: непонятные дни ${JSON.stringify(entry.days)}`)
    return days.map((dayOfWeek) => ({
        dayOfWeek,
        startTime: normTime(entry.time),
        durationMin: Number(entry.minutes),
    }))
}

const ask = async (question) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    try {
        return (await rl.question(question)).trim()
    } finally {
        rl.close()
    }
}

// ---------------------------------------------------------------- steps

const signIn = async () => {
    if (accessToken) return
    if (!OWNER_EMAIL) fail('Укажите почту владельца: --email или "ownerEmail" в файле')
    say(`Вход: ${OWNER_EMAIL} → ${API}`)
    const envCode = process.env.CLUBSPACE_CODE
    if (!envCode) {
        try {
            await request('POST', '/send-auth-code', { email: OWNER_EMAIL, language: 'RU' }, { auth: false })
        } catch (e) {
            // A code was sent less than a minute ago (e.g. the admin sign-in
            // just now): the one from that e-mail is still valid.
            if (!(e instanceof SetupError) || !/позже/.test(e.message)) throw e
            say('Код уже отправлялся меньше минуты назад — введите код из последнего письма.')
        }
    }
    for (let attempt = 1; ; attempt++) {
        const code = envCode ?? (await ask('Код из письма: ')).replace(/\D/g, '')
        try {
            const tokens = await request('POST', '/sign-in', { email: OWNER_EMAIL, code }, { auth: false })
            accessToken = tokens.accessToken
            refreshToken = tokens.refreshToken
            return
        } catch (e) {
            if (!(e instanceof SetupError) || envCode || attempt >= 3) throw e
            say(`Код не подошёл (${e.message.replace(/^.*?: /, '')}). Попробуйте ещё раз.`)
        }
    }
}

const findClub = async () => {
    const club = spec.club ?? fail('В файле нет раздела "club"')
    const mine = await request('POST', '/get-my-workspaces', {})
    const list = mine.data ?? []
    const hit =
        list.find((w) => club.key && w.key === club.key) ??
        list.find((w) => nameKey(w.name) === nameKey(club.name))
    if (!hit) {
        fail(
            `Клуб «${club.name}» не найден среди клубов ${OWNER_EMAIL || 'этого аккаунта'}` +
                (list.length ? ` (есть: ${list.map((w) => w.name).join(', ')})` : '') +
                '. Создайте его в консоли платформы или через регистрацию клуба.',
        )
    }
    if (hit.roleName !== 'admin' && !hit.isOwner) {
        fail(`В клубе «${hit.name}» у этого аккаунта роль «${hit.roleName}» — нужен владелец или администратор`)
    }
    return hit.workspaceId
}

const setupSettings = async (W) => {
    const want = { ...(spec.club.settings ?? {}) }
    if (spec.club.timezone) want.timezone = spec.club.timezone
    if (!Object.keys(want).length) return
    say('Настройки клуба')
    const cur = await request('GET', `/workspaces/${W}/settings`)
    const diff = Object.fromEntries(Object.entries(want).filter(([k, v]) => cur[k] !== v))
    if (Object.keys(diff).length) {
        await write('PATCH', `/workspaces/${W}/settings`, diff)
        updated(`настройки: ${Object.keys(diff).join(', ')}`)
    } else log.kept++
}

const setupAbout = async (W) => {
    if (!spec.about) return
    say('О клубе (правила, контакты, ссылки)')
    const cur = await request('GET', `/workspaces/${W}/about`)
    const want = {
        contacts: spec.about.contacts ?? cur.contacts ?? [],
        links: spec.about.links ?? cur.links ?? [],
        rules: spec.about.rules ?? cur.rules ?? '',
    }
    // The server stores phones as +7XXXXXXXXXX: «8-996-…» in the file is the same number.
    const phoneKey = (p) => String(p).replace(/\D/g, '').replace(/^8(\d{10})$/, '7$1')
    const contactsKey = (list) => JSON.stringify((list ?? []).map((c) => [c.label, phoneKey(c.phone)]))
    const same =
        contactsKey(want.contacts) === contactsKey(cur.contacts) &&
        JSON.stringify(want.links) === JSON.stringify(cur.links) &&
        (want.rules ?? '') === (cur.rules ?? '')
    if (same) {
        log.kept++
        return
    }
    await write('PUT', `/workspaces/${W}/about`, want)
    updated('страница «О клубе»')
}

const setupGyms = async (W) => {
    say(`Залы (${(spec.gyms ?? []).length})`)
    const cur = (await request('GET', `/workspaces/${W}/gyms`)).data
    const byKey = new Map()
    for (const g of spec.gyms ?? []) {
        let gym = cur.find((c) => nameKey(c.name) === nameKey(g.name))
        if (!gym) {
            gym = await write('POST', `/workspaces/${W}/gyms`, {
                name: g.name,
                address: g.address ?? '',
                ...(g.timezone ? { timezone: g.timezone } : {}),
            })
            created(`зал «${g.name}»`)
        } else if (g.address !== undefined && (gym.address ?? '') !== g.address) {
            await write('PATCH', `/workspaces/${W}/gyms/${gym.id}`, { address: g.address })
            updated(`адрес зала «${g.name}»`)
        } else log.kept++
        byKey.set(g.key ?? g.name, gym.id)
        byKey.set(nameKey(g.name), gym.id)
    }
    for (const c of cur) {
        if (!(spec.gyms ?? []).some((g) => nameKey(g.name) === nameKey(c.name))) log.extra.push(`зал «${c.name}»`)
    }
    return byKey
}

const setupDirections = async (W) => {
    say(`Направления (${(spec.directions ?? []).length})`)
    const cur = (await request('GET', `/workspaces/${W}/directions`)).data
    const byKey = new Map()
    for (const [i, d] of (spec.directions ?? []).entries()) {
        let dir = cur.find((c) => nameKey(c.name) === nameKey(d.name))
        if (!dir) {
            dir = await write('POST', `/workspaces/${W}/directions`, {
                name: d.name,
                ...(d.color ? { color: d.color } : {}),
                ...(d.icon ? { icon: d.icon } : {}),
                order: i,
            })
            created(`направление «${d.name}»`)
        } else {
            const diff = {}
            if (d.color && dir.color !== d.color) diff.color = d.color
            if (d.icon && dir.icon !== d.icon) diff.icon = d.icon
            if (Object.keys(diff).length) {
                await write('PATCH', `/workspaces/${W}/directions/${dir.id}`, diff)
                updated(`направление «${d.name}»: ${Object.keys(diff).join(', ')}`)
            } else log.kept++
        }
        byKey.set(d.key ?? d.name, dir.id)
        byKey.set(nameKey(d.name), dir.id)
    }
    return byKey
}

// Staff come in as coaches (a fresh account is created and put in the club at
// once); head coach / admin are set afterwards. Someone who already has an
// account elsewhere only gets an invitation to accept in the app — until then
// they can't be a group's coach.
const setupStaff = async (W) => {
    const staff = spec.staff ?? []
    say(`Тренеры и сотрудники (${staff.length})`)
    const roles = (await request('GET', `/workspaces/${W}/roles`)).data
    const roleId = (name) => roles.find((r) => r.name === name)?.id ?? fail(`Роль «${name}» не найдена`)
    const members = (await request('GET', `/workspaces/${W}/members`)).data
    const byEmail = new Map(members.filter((m) => m.email).map((m) => [m.email.toLowerCase(), m]))
    const byKey = new Map()
    for (const p of staff) {
        const email = String(p.email ?? '').trim().toLowerCase()
        if (!email) fail(`У сотрудника «${p.lastname ?? p.key}» нет e-mail`)
        const role = p.role ?? 'coach'
        if (!['coach', 'head_coach', 'admin'].includes(role)) fail(`Роль «${role}» у ${email}: нужна coach, head_coach или admin`)
        const label = [p.lastname, p.firstname].filter(Boolean).join(' ') || email
        let m = byEmail.get(email)
        if (m && m.status !== 'ACTIVE') m = null
        let userId = m?.userId
        if (!m) {
            let res
            try {
                res = await write('POST', `/workspaces/${W}/members/invite`, {
                    email,
                    ...(p.firstname ? { firstname: p.firstname } : {}),
                    ...(p.lastname ? { lastname: p.lastname } : {}),
                    role: 'coach',
                    sendEmail: spec.sendInvites === true,
                })
            } catch (e) {
                if (!(e instanceof SetupError)) throw e
                warn(`${label} (${email}): ${e.message}`)
                continue
            }
            userId = res.userId
            if (res.outcome === 'invited') {
                warn(
                    `${label} (${email}) уже зарегистрирован в ClubSpace — ему ушло приглашение в клуб; ` +
                        'пока он его не примет, его группы не создаются. Запустите скрипт снова после принятия.',
                )
                continue
            }
            created(`${role === 'coach' ? 'тренер' : role === 'head_coach' ? 'главный тренер' : 'администратор'} ${label} (${email})`)
        }
        const currentRole = m?.roleName ?? 'coach'
        if (!m?.isOwner && currentRole !== role) {
            await write('PATCH', `/workspaces/${W}/members/${userId}/role`, { roleId: roleId(role) })
            if (m) updated(`роль ${label}: ${currentRole} → ${role}`)
        } else if (m) log.kept++
        byKey.set(p.key ?? email, userId)
        byKey.set(email, userId)
    }
    return byKey
}

const setupManagers = async (W, dirs, staff) => {
    const wanted = (spec.directions ?? []).flatMap((d) =>
        (d.managers ?? []).map((m) => ({ dir: d, who: m })),
    )
    if (!wanted.length) return
    say(`Руководители направлений (${wanted.length})`)
    const cur = (await request('GET', `/workspaces/${W}/direction-managers`)).data
    for (const { dir, who } of wanted) {
        const directionId = dirs.get(dir.key ?? dir.name)
        const userId = staff.get(who) ?? staff.get(String(who).toLowerCase())
        if (!userId) {
            warn(`Руководитель «${who}» направления «${dir.name}» не найден среди сотрудников — пропущен`)
            continue
        }
        const has = cur.some(
            (c) => (c.directionId ?? c.direction?.id) === directionId && (c.userId ?? c.user?.id) === userId,
        )
        if (has) {
            log.kept++
            continue
        }
        await write('POST', `/workspaces/${W}/direction-managers`, { directionId, userId })
        created(`руководитель направления «${dir.name}»: ${who}`)
    }
}

const setupGroups = async (W, gyms, dirs, staff) => {
    const groups = spec.groups ?? []
    say(`Группы и расписание (${groups.length})`)
    const cur = (await request('GET', `/workspaces/${W}/groups`)).data
    const seen = new Set()
    for (const g of groups) {
        const where = `группа «${g.name}»`
        const gymId = gyms.get(g.gym) ?? gyms.get(nameKey(g.gym)) ?? fail(`${where}: нет зала «${g.gym}»`)
        const directionId = g.direction
            ? dirs.get(g.direction) ?? dirs.get(nameKey(g.direction)) ?? fail(`${where}: нет направления «${g.direction}»`)
            : undefined
        const coachId = staff.get(g.coach) ?? staff.get(String(g.coach).toLowerCase())
        const label = `«${g.name}» (${spec.gyms.find((x) => (x.key ?? x.name) === g.gym)?.name ?? g.gym})`
        if (!coachId) {
            warn(`Группа ${label} пропущена: тренер «${g.coach}» ещё не в клубе`)
            continue
        }
        const slots = (g.schedule ?? []).flatMap((s) => parseSchedule(s, where))
        let group = cur.find((c) => nameKey(c.name) === nameKey(g.name) && c.gym?.id === gymId)
        if (!group) {
            group = await write('POST', `/workspaces/${W}/groups`, {
                name: g.name,
                gymId,
                coachId,
                ...(directionId ? { directionId } : {}),
            })
            group = { ...group, slots: [], coaches: [] }
            created(`группа ${label}`)
        } else {
            seen.add(group.id)
            const diff = {}
            if (group.coach?.id !== coachId) diff.coachId = coachId
            if (directionId && group.direction?.id !== directionId) diff.directionId = directionId
            if (Object.keys(diff).length) {
                await write('PATCH', `/workspaces/${W}/groups/${group.id}`, diff)
                updated(`группа ${label}: ${Object.keys(diff).join(', ')}`)
            } else log.kept++
        }
        seen.add(group.id)
        for (const extra of g.coaches ?? []) {
            const userId = staff.get(extra) ?? staff.get(String(extra).toLowerCase())
            if (!userId) {
                warn(`${label}: второй тренер «${extra}» ещё не в клубе`)
                continue
            }
            if (userId === coachId || (group.coaches ?? []).some((c) => c.userId === userId)) continue
            await write('POST', `/workspaces/${W}/groups/${group.id}/coaches`, { userId })
            created(`${label}: второй тренер ${extra}`)
        }
        for (const s of slots) {
            const hit = (group.slots ?? []).find(
                (c) => c.dayOfWeek === s.dayOfWeek && c.startTime === s.startTime && !c.effectiveUntil,
            )
            const when = `${DAY_NAMES[s.dayOfWeek]} ${s.startTime}`
            if (!hit) {
                await write('POST', `/workspaces/${W}/groups/${group.id}/schedule/slots`, s)
                created(`${label}: ${when}, ${s.durationMin} мин`)
            } else if (hit.durationMin !== s.durationMin) {
                await write('PATCH', `/workspaces/${W}/groups/${group.id}/schedule/slots/${hit.id}`, {
                    durationMin: s.durationMin,
                })
                updated(`${label}: ${when} — ${hit.durationMin} → ${s.durationMin} мин`)
            } else log.kept++
        }
        for (const c of group.slots ?? []) {
            if (c.effectiveUntil) continue
            if (!slots.some((s) => s.dayOfWeek === c.dayOfWeek && s.startTime === c.startTime)) {
                log.extra.push(`занятие ${label} ${DAY_NAMES[c.dayOfWeek]} ${c.startTime}`)
            }
        }
    }
    for (const c of cur) {
        if (!seen.has(c.id)) log.extra.push(`группа «${c.name}» (${c.gym?.name ?? 'без зала'})`)
    }
}

const setupPlans = async (W, dirs) => {
    const plans = spec.plans ?? []
    say(`Абонементы (${plans.length})`)
    const cur = (await request('GET', `/workspaces/${W}/plans`)).data
    for (const p of plans) {
        const directionIds = (p.directions ?? []).map(
            (d) => dirs.get(d) ?? dirs.get(nameKey(d)) ?? fail(`Абонемент «${p.name}»: нет направления «${d}»`),
        )
        const body = {
            name: p.name,
            description: p.description ?? undefined,
            price: p.price,
            currency: p.currency ?? 'RUB',
            durationDays: p.days ?? 30,
            classCount: p.classes ?? null,
            isFreeTrial: p.isFreeTrial ?? false,
            startsOnFirstVisit: p.startsOnFirstVisit ?? false,
            isActive: p.isActive ?? true,
            purchasableOnline: p.purchasableOnline ?? false,
            directionIds,
        }
        const hit = cur.find((c) => nameKey(c.name) === nameKey(p.name))
        if (!hit) {
            const { classCount, ...rest } = body
            await write('POST', `/workspaces/${W}/plans`, classCount === null ? rest : body)
            created(`абонемент «${p.name}» — ${p.price} ₽`)
            continue
        }
        const curDirs = (hit.directionIds ?? hit.directions?.map((d) => d.id ?? d.directionId) ?? []).slice().sort()
        const diff = {}
        for (const k of ['description', 'price', 'currency', 'durationDays', 'classCount', 'isFreeTrial', 'startsOnFirstVisit', 'isActive', 'purchasableOnline']) {
            if (body[k] !== undefined && (hit[k] ?? null) !== (body[k] ?? null)) diff[k] = body[k]
        }
        if (JSON.stringify(curDirs) !== JSON.stringify(directionIds.slice().sort())) diff.directionIds = directionIds
        if (Object.keys(diff).length) {
            await write('PATCH', `/workspaces/${W}/plans/${hit.id}`, diff)
            updated(`абонемент «${p.name}»: ${Object.keys(diff).join(', ')}`)
        } else log.kept++
    }
    for (const c of cur) {
        if (c.isActive && !plans.some((p) => nameKey(p.name) === nameKey(c.name))) log.extra.push(`абонемент «${c.name}»`)
    }
}

const setupLadders = async (W, dirs) => {
    const ladders = spec.ladders ?? []
    say(`Пояса и уровни (${ladders.length} шкал)`)
    const cur = (await request('GET', `/workspaces/${W}/rank-ladders`)).data
    for (const [i, l] of ladders.entries()) {
        const directionId = l.direction
            ? dirs.get(l.direction) ?? dirs.get(nameKey(l.direction)) ?? fail(`Шкала «${l.name}»: нет направления «${l.direction}»`)
            : undefined
        let ladder = cur.find((c) => nameKey(c.name) === nameKey(l.name))
        if (!ladder) {
            ladder = await write('POST', `/workspaces/${W}/rank-ladders`, {
                name: l.name,
                ...(l.audience ? { audience: l.audience } : {}),
                order: i,
                ...(directionId ? { directionId } : {}),
            })
            ladder = { ...ladder, levels: [] }
            created(`шкала «${l.name}»`)
        } else log.kept++
        for (const [j, lv] of (l.levels ?? []).entries()) {
            const body = {
                name: lv.name,
                order: j,
                ...(lv.color ? { color: lv.color } : {}),
                maxStripes: lv.maxStripes ?? l.maxStripes ?? 0,
                ...(lv.requirements ? { requirements: lv.requirements } : {}),
                ...(lv.minVisits ? { minVisits: lv.minVisits } : {}),
                ...(lv.minWeeks ? { minWeeks: lv.minWeeks } : {}),
            }
            const hit = (ladder.levels ?? []).find((c) => nameKey(c.name) === nameKey(lv.name))
            if (!hit) {
                await write('POST', `/workspaces/${W}/rank-ladders/${ladder.id}/levels`, body)
                created(`«${l.name}»: ${lv.name}`)
            } else log.kept++
        }
    }
}

// Everything the file can get wrong is checked before the first request, so
// a typo never leaves the club half set up.
const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i
const validate = () => {
    const errors = []
    const check = (ok, message) => {
        if (!ok) errors.push(message)
    }
    const refs = (list) => new Set((list ?? []).flatMap((x) => [x.key ?? x.name, nameKey(x.name)]))
    check(spec.club?.name, 'Нет "club.name" — названия клуба')
    const gyms = refs(spec.gyms)
    const dirs = refs(spec.directions)
    const staff = new Set((spec.staff ?? []).flatMap((p) => [p.key, String(p.email ?? '').toLowerCase()].filter(Boolean)))
    const emails = new Set()
    for (const p of spec.staff ?? []) {
        const email = String(p.email ?? '').trim().toLowerCase()
        const who = [p.lastname, p.firstname].filter(Boolean).join(' ') || p.key
        check(EMAIL.test(email), `Сотрудник ${who}: e-mail «${p.email ?? ''}» не похож на адрес`)
        check(!EMAIL.test(email) || !emails.has(email), `E-mail ${email} указан у двух сотрудников`)
        emails.add(email)
        check(!p.role || ['coach', 'head_coach', 'admin'].includes(p.role), `Сотрудник ${who}: роль «${p.role}» — нужна coach, head_coach или admin`)
    }
    for (const d of spec.directions ?? []) {
        for (const m of d.managers ?? []) {
            check(staff.has(m) || staff.has(String(m).toLowerCase()), `Направление «${d.name}»: руководитель «${m}» не найден в "staff"`)
        }
    }
    for (const g of spec.groups ?? []) {
        const where = `Группа «${g.name}»`
        check(g.gym && (gyms.has(g.gym) || gyms.has(nameKey(g.gym))), `${where}: зал «${g.gym ?? ''}» не найден в "gyms"`)
        check(!g.direction || dirs.has(g.direction) || dirs.has(nameKey(g.direction)), `${where}: направление «${g.direction}» не найдено в "directions"`)
        for (const c of [g.coach, ...(g.coaches ?? [])]) {
            check(c && (staff.has(c) || staff.has(String(c).toLowerCase())), `${where}: тренер «${c ?? ''}» не найден в "staff"`)
        }
        for (const s of g.schedule ?? []) {
            try {
                parseSchedule(s, where)
            } catch (e) {
                errors.push(e.message)
            }
        }
    }
    for (const p of spec.plans ?? []) {
        check(Number.isInteger(p.price) && p.price >= 0, `Абонемент «${p.name}»: цена — целое число рублей`)
        check(
            p.classes === undefined || p.classes === null || (Number.isInteger(p.classes) && p.classes > 0),
            `Абонемент «${p.name}»: "classes" — число занятий или null (безлимит)`,
        )
        for (const d of p.directions ?? []) check(dirs.has(d) || dirs.has(nameKey(d)), `Абонемент «${p.name}»: направление «${d}» не найдено`)
    }
    for (const l of spec.ladders ?? []) {
        check(!l.direction || dirs.has(l.direction) || dirs.has(nameKey(l.direction)), `Шкала «${l.name}»: направление «${l.direction}» не найдено`)
    }
    if (errors.length) fail(`в файле ${errors.length} ошибок:\n  - ${errors.join('\n  - ')}`)
}

// ---------------------------------------------------------------- main

const started = Date.now()
try {
    validate()
    await signIn()
    const W = await findClub()
    say(`Клуб найден${dryRun ? ' — пробный прогон, ничего не меняется' : ''}`)
    await setupSettings(W)
    await setupAbout(W)
    const gyms = await setupGyms(W)
    const dirs = await setupDirections(W)
    const staff = await setupStaff(W)
    await setupManagers(W, dirs, staff)
    await setupGroups(W, gyms, dirs, staff)
    await setupPlans(W, dirs)
    await setupLadders(W, dirs)
    say('')
    say(
        `Готово за ${Math.round((Date.now() - started) / 1000)} с: создано ${log.created.length}, ` +
            `обновлено ${log.updated.length}, без изменений ${log.kept}.`,
    )
    if (log.extra.length) {
        say(`Есть в клубе, но нет в файле (не трогал): ${log.extra.join('; ')}`)
    }
    if (log.warnings.length) {
        say(`Требует внимания (${log.warnings.length}):`)
        for (const w of log.warnings) say(`  ! ${w}`)
        process.exitCode = 1
    }
} catch (e) {
    if (e instanceof SetupError) {
        console.error(`Ошибка: ${e.message}`)
        process.exit(1)
    }
    throw e
}
