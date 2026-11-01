# Умная аналитика клуба («Аналитика»)

Five admin screens and a Monday digest that tell an owner **whom to call, which
classes to move, which coach keeps students and what money is coming** — by
fixed, explainable rules (no ML, no LLM). Every number on a screen comes with
the sentence that explains it.

| Screen | Endpoint | Code |
|---|---|---|
| «Кому позвонить сегодня» | `GET /workspaces/:id/analytics/churn` | `domains/analytics/churn-score.ts` |
| «Удержание по когортам» | `GET …/analytics/cohorts` | `cohorts.ts` |
| «Загрузка расписания» | `GET …/analytics/occupancy?weeks=` | `occupancy.ts` |
| «Тренеры» | `GET …/analytics/coaches` | `coach-stats.ts` |
| «Прогноз» | `GET …/analytics/forecast` | `forecast.ts` |
| «Пересчитать» (admins) | `POST …/analytics/refresh` | `analytics-snapshot.service.ts` |

All reads take `gymId`, `directionId`, `groupId`, `coachId` filters; an id of
another club is a 404.

## Who sees what

`features/club-analytics/analytics-scope.ts`, one rule for every screen:

- owner, `admin`, `head_coach` — the whole club (plus visits outside groups:
  events, personal trainings);
- anyone else on the staff — only the groups they act on as their own
  (`ownGroupsWhere`): the groups they coach (primary or assistant) and every
  group of a direction they run (руководитель направления). This holds even
  with `coachSeesAllGroups`: money and churn of other coaches' students stay
  private;
- filters narrow the scope further; a coach asking for another direction gets
  an empty screen, not someone else's data;
- `POST …/refresh` is `WORKSPACE_ADMINS` only.

«Связались» is the existing contact log (`at-risk-members/:userId/contacts`,
`MemberRetentionContact`): a member contacted within 14 days moves to the
«Связались» block at the bottom of the list. Logging follows the existing rule
(admins: anyone; others: members of their own groups — `canContact`).

## Snapshots and schedule

Endpoints never scan the attendance history; they read snapshot tables that
`AnalyticsSnapshotService` rebuilds per club (rows replaced in one
transaction):

| Table | What | When |
|---|---|---|
| `AnalyticsMemberSnapshot` | per active student: score, reasons, monthly spend, groups, forecast pieces, renewal history, trial facts | every hour |
| `AnalyticsMemberGroupStat` | first/last visit and count per student × group (null = outside groups) | nightly, 04:00 club time |
| `AnalyticsSlotOccurrence` | every past scheduled class of the last 26 weeks: held, present, roster, drop-in bookings | nightly |
| `AnalyticsRun` | computed-at times, club renewal rate | with each part |

The `scheduler-analytics` BullMQ queue runs hourly: first the owners' digest
(clubs where it is Monday 09:00), then the rebuild — member scores for every
active club, history for clubs at their 04:00 (or with none / older than 25 h).
A demo reset and «Пересчитать» rebuild both parts at once.

All date buckets use the club's timezone: «N дней назад» counts club-local
calendar days, cohorts bucket by the club-local month of the first visit, slot
dates are slot-local (gym timezone, else the club's), the digest goes out at
the club's Monday 09:00. Visits of the owner and the current staff (coaches,
head coaches, admins) never count as a student's (cohorts, coaches, present
marks).

## Churn risk score (0–100)

Sum of the points below, clamped to 0..100. Levels: **≥ 60 высокий**,
**35–59 средний**, below — низкий. The list shows medium and high
(`minScore` to change), strongest reasons first, top three on screen.

| Signal | Points | Text (example) |
|---|---|---|
| Days since the last visit, club-local (from the end of a freeze if later) | ≥ 45: **40**; ≥ 30: **32**; ≥ 21: **24**; ≥ 14: **16**; ≥ max(7, 2 × usual gap): **8** | «Не был на тренировке 23 дня» |
| — usual gap = 7 / (visits per week in the 8 weeks before the last 4); 7 days without that baseline | | |
| Never came, in the club ≥ 7 days | **20** | «В клубе 9 дней, ещё ни разу не был на тренировке» |
| Did not come back after a freeze (gap ≥ 7 days) | **+10** | «Не вернулся после заморозки» |
| Attendance trend vs own baseline: last 4 weeks per week against the 8 weeks before; baseline ≥ 8 visits, drop ≥ 30%; off if a freeze ended inside the 12 weeks | **round(20 × drop)** | «Ходит реже: было ~2 в неделю, стало 0,5» |
| Abonement ended ≤ 30 days ago, no current one (cancelled ones never count) | **25** | «Абонемент «12 занятий» закончился 20 октября и не продлён» |
| Current pack with 0 classes and no other live abonement | **20** | «Закончились занятия в абонементе «8 занятий»» |
| Every live abonement ends within 7 / 14 days, none bought ahead | **15 / 8** | «Абонемент … заканчивается через 5 дней, следующий не куплен» |
| Drop-in bookings in 30 days not marked present | **6 each, max 18** | «Записался и не пришёл: 2 раза за 30 дней» |
| Newcomer: first visit 14–60 days ago, < 2 visits in 14 days | **12** | «Новичок: 20 дней в клубе, за 2 недели — 1 визит» |
| Unpaid abonement older than 7 days | **10** | «Долг 4 000 ₽ за «12 занятий»» |
| Every current abonement frozen (or starting a freeze within 7 days): attendance signals off | **5** | «Абонемент заморожен до 20 ноября» |
| Tenure ≥ 365 days (only when something else fired) | **−10** | «В клубе больше года» |

Attendance signals are off for the whole club when nobody was marked present in
14 days (the coaches stopped marking, the members did not stop coming). Trial
abonements never count as lapsed.

**Money at stake** = average monthly spend: paid, non-trial abonements by
payment date in the last 180 days ÷ months since the first of them in the
window (1..6).

## Cohort retention

Students grouped by the club-local month of their first visit (last 12 months).
A student is **retained at k months** (k = 1, 2, 3, 6) when their last visit is
on or after the first visit's date + k calendar months (31 Jan + 1 = 28/29
Feb). A cell counts only students whose k-month date has come (`eligible`);
`null` while none has, `partial` while some have not. With a filter or a staff
scope the first/last visits are taken over the allowed groups only.

## Schedule occupancy

Per weekly slot over the last N weeks (default 8, max 26): average present
(non-staff) marks over the classes where a coach took attendance, against the
capacity — an explicit class limit when the club has one, otherwise the group
roster (today: always the roster). Heatmap: weekday × start hour per gym
(slots in one cell add up). Ranked once a slot has ≥ 2 classes held:

- **weak**: fill < 40% → «Подумайте о переносе времени или объединении…»;
- **demand exceeds capacity**: fill ≥ 90% → «Добавьте занятие в соседний час
  или параллельную группу» — the best time windows to add classes.

## Coaches

Over the groups a coach leads (inside the viewer's scope):

- active students — visited in the last 30 days;
- 3-month retention — of students who started there > 90 days ago and were
  still around 90–180 days ago (last visit within 180 days), the share who came
  in the last 90 days;
- renewals — abonements of those students that ended 14–180 days ago and were
  renewed (see below);
- attendance per class — present marks per class held in the last 12 weeks.

## Forecast

- **Renewal** of an ended abonement = a newer non-trial purchase no later than
  14 days after its end (buying ahead counts). Club rate = renewed / ended over
  abonements that ended 14–180 days ago; below 10 of them the default **70%**.
- Member probability **p = club rate × (1 − score/100)**.
- Per member, one stream per abonement scope: it renews when coverage runs out
  (latest end, extended by abonements already bought and waiting for the first
  visit; a lapsed scope ≤ 30 days ago renews "now"), then every period. The
  k-th renewal inside the horizon counts its price × p^k. Open-ended class packs
  and free abonements have no renewal date.
- Shown for 30 and 90 days: if everyone renews (potential), expected, and the
  difference (expected churn). Plus the money of high-risk students.
- **Trial → paid**: trials (free-trial tariffs) started 14–180 days ago; the
  share followed by a paid non-trial purchase and the median days to it.

## Weekly digest

`AnalyticsDigestService` — Monday 09:00–09:59 club time (coaches keep their
«Кому позвонить» at 10:00), to the owner and active admins/head coaches, push
and e-mail. Three facts and three actions picked by `digest-rules.ts` in a
fixed order (risk + money, forecast, a mature cohort, the fullest class, trial
conversion, active students; actions: call these three, offer renewals, add a
class next to a full slot, rethink a weak slot, call trials, then links to
cohorts/coaches), each action linking to its screen. Once per club per week:
the run is claimed in `NotificationDispatchLog` (`analytics.digest.run`,
`<club>:<Monday>`), each recipient's push and e-mail on their own keys.
Opt-out: `NotificationPreferences.analyticsDigestEnabled` (mobile settings and
the analytics screens). A club without students gets nothing.

## Not yet

- Class capacity and booking no-shows come with class booking (separate
  branch): `AnalyticsSlotOccurrence.capacity` is null today (the roster is the
  capacity) and missed bookings count drop-in bookings only.
