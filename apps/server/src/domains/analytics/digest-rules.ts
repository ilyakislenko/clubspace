// «Аналитика за неделю»: three facts and three concrete actions for the
// owner and admins, picked by fixed rules from the reports (no LLM). Each
// list takes its first three candidates in the order below; the paths are
// the admin screens under /workspace/<id>/.
import {
    isoDayOfWeek,
    localMinuteInTz,
} from '../../features/attendance/attendance-utils'
import { displayName } from '../../features/attendance/schemas'
import { pluralRu } from '../../shared/utils/plural-ru'
import { ymdToDbDate } from '../subscriptions/freeze-dates'
import type {
    ChurnReport,
    CohortReport,
    ForecastReport,
    OccupancyReport,
} from './analytics-reports'
import { formatMoney } from './money'
import { slotLabel } from './occupancy'

// Monday, 09:00-09:59 club time (the coaches' «Кому позвонить» goes at 10).
export const analyticsDigestSlot = (
    now: Date,
    tz: string,
): { due: boolean; weekYmd: string } => {
    const local = localMinuteInTz(now, tz)
    const weekYmd = local.slice(0, 10)
    return {
        due:
            isoDayOfWeek(ymdToDbDate(weekYmd)) === 1 &&
            Number(local.slice(11, 13)) === 9,
        weekYmd,
    }
}

export type DigestAction = { text: string; path: string }
export type WeeklyDigest = { facts: string[]; actions: DigestAction[] }

const MONTHS_PREP = [
    'январе', 'феврале', 'марте', 'апреле', 'мае', 'июне',
    'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре',
]

const pct = (x: number): string => `${Math.round(x * 100)}%`

const students = (n: number): string =>
    `${n} ${pluralRu(n, 'ученик', 'ученика', 'учеников')}`

export const buildWeeklyDigest = (r: {
    churn: ChurnReport
    forecast: ForecastReport
    occupancy: OccupancyReport
    cohorts: CohortReport
}): WeeklyDigest => {
    const facts: string[] = []
    const actions: DigestAction[] = []
    const ccy = r.forecast.currency ?? r.churn.summary.currency
    const s = r.churn.summary

    facts.push(
        s.total > 0
            ? `${students(s.total)} под риском ухода (высокий риск — ${s.high}), на кону ${formatMoney(s.moneyAtStake, ccy)} в месяц`
            : 'Под риском ухода никого — ученики ходят стабильно',
    )
    const f30 = r.forecast.horizons.find((h) => h.days === 30)
    if (f30 && f30.potential > 0) {
        facts.push(
            `Прогноз продлений на 30 дней: ${formatMoney(f30.expected, ccy)} из ${formatMoney(f30.potential, ccy)} возможных (продлевают ${pct(r.forecast.renewal.scopeRate ?? r.forecast.renewal.clubRate)})`,
        )
    }
    const mature = [...r.cohorts.cohorts]
        .reverse()
        .find((c) => c.cells[0].rate !== null && !c.cells[0].partial && c.size >= 3)
    if (mature) {
        const month = MONTHS_PREP[Number(mature.month.slice(5, 7)) - 1]
        facts.push(
            `Из пришедших впервые в ${month} через месяц ходят ${pct(mature.cells[0].rate!)} (${mature.cells[0].retained} из ${mature.cells[0].eligible})`,
        )
    }
    const top = r.occupancy.strongest[0]
    if (top && top.fill !== null) {
        facts.push(
            `Самое заполненное занятие — ${slotLabel(top)} «${top.groupName}»: в среднем ${top.avgAttendance} из ${top.capacity}`,
        )
    }
    const t = r.forecast.trial
    if (t.trials > 0 && t.rate !== null) {
        facts.push(
            `Пробные: абонемент купили ${t.converted} из ${t.trials} (${pct(t.rate)})${t.medianDaysToPay !== null ? `, обычно через ${t.medianDaysToPay} ${pluralRu(t.medianDaysToPay, 'день', 'дня', 'дней')}` : ''}`,
        )
    }
    // Always true, so a quiet club still gets its facts.
    facts.push(
        `Активных учеников: ${r.forecast.members}, вместе они платят ${formatMoney(r.forecast.monthlyRecurring, ccy)} в месяц`,
    )

    const open = r.churn.entries.filter((e) => !e.contactedRecently)
    if (open.length > 0) {
        const names = open.slice(0, 3).map((e) => displayName(e))
        const money = open.slice(0, 3).reduce((sum, e) => sum + e.monthlySpend, 0)
        actions.push({
            text: `Позвоните сегодня: ${names.join(', ')}${money > 0 ? ` — на кону ${formatMoney(money, ccy)} в месяц` : ''}`,
            path: 'analytics/churn',
        })
    }
    const renewals = open.filter((e) =>
        e.reasons.some((x) => x.code === 'expired' || x.code === 'ending_soon' || x.code === 'out_of_classes'),
    ).length
    if (renewals > 0) {
        actions.push({
            text: `Предложите продление ${renewals} ${pluralRu(renewals, 'ученику', 'ученикам', 'ученикам')}: абонемент закончился или заканчивается`,
            path: 'analytics/churn',
        })
    }
    const add = r.occupancy.suggestions.find((x) => x.kind === 'add_class')
    if (add) actions.push({ text: add.text, path: 'analytics/occupancy' })
    const weak = r.occupancy.suggestions.find((x) => x.kind === 'rethink_slot')
    if (weak) actions.push({ text: weak.text, path: 'analytics/occupancy' })
    if (t.trials > 0 && t.rate !== null && t.rate < 0.5) {
        actions.push({
            text: `Пробные покупают абонемент в ${pct(t.rate)} случаев — позвоните тем, кто был на пробном и не купил`,
            path: 'analytics/forecast',
        })
    }
    actions.push({
        text: 'Посмотрите, как удерживаются новички по месяцам',
        path: 'analytics/cohorts',
    })
    actions.push({
        text: 'Сравните удержание и продления по тренерам',
        path: 'analytics/coaches',
    })

    return { facts: facts.slice(0, 3), actions: actions.slice(0, 3) }
}
