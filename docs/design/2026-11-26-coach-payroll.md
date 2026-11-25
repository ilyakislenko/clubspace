# Coach rates and monthly payouts «Выплаты тренерам» (backlog E4)

Status: **design** · 2026-11-26 · base: `main` @ `d434461c` (+ uncommitted demo-readiness fixes)
Parent: [admin cleanup](../docs/design/2026-11-08-admin-cleanup.md) §9 E4 («Rate per class/student/percent;
monthly payroll report; export», `2026-11-08-admin-cleanup.md:1026`). Structure follows
[requests inbox](../docs/design/2026-11-15-requests-inbox.md) and [discounts](../docs/design/2026-11-15-discounts.md).
File:line references are as of `d434461c`. The owner was asleep; every choice he would normally make is in
§12 «Decisions» and may be overruled.

## Кратко (для владельца)

Сейчас ClubSpace считает, сколько занятий провёл каждый тренер и сколько учеников к нему ходит
(«Отчёты → Тренеры»). Но сколько тренеру заплатить за месяц, клуб считает вручную в Excel.

Что сделаем:
1. **Ставка тренера.** Владелец или администратор задаёт каждому тренеру любое сочетание четырёх частей:
   - оклад в месяц;
   - сумма за проведённое занятие («если пришло не меньше N учеников», по умолчанию 1);
   - сумма за каждого отмеченного ученика;
   - процент от оплат абонементов его учеников.

   Ставка действует с выбранного месяца целиком. Прошлые месяцы она не меняет.
2. **Вкладка «Отчёты → Выплаты»** (только владелец и администраторы: это деньги). Таблица за месяц:
   тренер, занятия, отметки, начислено, корректировки, итого. По строке открывается расшифровка: какие
   занятия засчитаны, кто заменял, что не засчитано и почему. Здесь же можно добавить премию или
   удержание с комментарием.
3. **Правила простые.** Занятие засчитывается тому, кто его реально вёл, то есть заменяющему. Отменённые
   занятия не считаются. Персональные тренировки и события учитываются корректировкой.
4. **«Закрыть месяц».** После закрытия суммы фиксируются: правки посещаемости или ставки закрытый месяц не
   меняют. Если данные потом изменились, появится строка «сейчас вышло бы на 1 200 ₽ больше», и разницу
   можно учесть в следующем месяце. Открыть месяц заново можно только с указанием причины. Всё пишется в
   «Историю изменений».
5. **CSV-выгрузка** месяца для бухгалтерии.
6. **Тренер видит свои выплаты в приложении, только если клуб это включил** («Настройки → Права
   тренеров», по умолчанию выключено). Тренер видит только себя и только закрытые месяцы. За текущий месяц
   он видит число занятий и отметок, без денег.

ClubSpace только считает. Платит и платит налоги клуб, и на экране так и написано. Слово «зарплата» не
используем: многие тренеры работают как самозанятые или ИП.

## Problem

1. **Counts exist, money does not.** `domains/analytics/coach-stats.ts:16-24` gives per coach `classes`,
   `avgAttendance` and `activeStudents`. It covers a rolling 12-week window (`analytics-reports.ts:37`) and
   reads the hourly snapshot `AnalyticsSlotOccurrence` (`schema.prisma:2871-2895`), so it is neither a
   calendar month nor exact. `schema.prisma` has no rate, payout, adjustment or month concept.
2. **The facts payroll needs are already recorded, each in one place:**
   - **who ran a class**: `AttendanceSession.coachId` (`schema.prisma:2278`). It is set to the approved
     substitute at creation (`attendance/create-session.handler.ts:134-152`). `syncSessionCoach`
     re-syncs it on approve and cancel (`class-substitutions/approve-…:82`, `cancel-…:76`);
   - **who came**: `AttendanceRecord` (`:2300-2346`). **Which abonement a visit used**:
     `usedSubscriptionId` (`:2329`);
   - **cancellations**: `ScheduleException` (`:896-924`), tested by `isSlotActiveOn`
     (`attendance/attendance-utils.ts:56`). A cancellation added *after* a roster was opened leaves the
     session in place (`create-group-exception.handler.ts` doesn't touch sessions), so payroll must apply
     exceptions itself;
   - **money**: `paidInRangeWhere` / `refundsInRangeWhere` (`domains/metrics/revenue.ts:47,67`). Amounts
     are in `Subscription.amountPaid` (`schema.prisma:1988`, whole units, `Int`).
3. **Comparing coaches is a sport-lead read** (`get-coach-analytics.handler.ts:23-28`). Money is club-admin
   only (conventions §1 tier rule), so payroll can't extend that endpoint.
4. **History moves.** Attendance stays editable (`attendance/update-session.handler.ts`,
   `delete-session.handler.ts`), and a cancelled substitution row is deleted (`schema.prisma:761-765`). A
   month computed live would change after the coach was paid.

## Goal / non-goals

**Goal.** A club admin sets each coach's rate once. On the 1st they open «Выплаты» and see what each coach
earned and why, add a bonus, close the month and download the CSV. After that the numbers never move. A
coach sees their own closed months in the app if the club opts in.

**Non-goals.**
- Paying out, payslips, НДФЛ/НПД, contracts or acts. ClubSpace computes; the club pays.
- Per-group/direction overrides, sliding scales, mid-month rate changes (v2 candidates).
- Automatic pay for personal trainings, events and seminars. Their price is off-app
  (`schema.prisma:2393`); they are handled as adjustments.
- Expenses / P&L (E8). Payroll totals will feed it later.
- Head coaches or direction managers seeing pay in the admin, their own included. Their own pay is in the
  app, under the same club switch as every coach.
- AI/MCP access to payroll (§6).

## 1. The payroll rule — `domains/payroll/payroll-rules.ts`

**Month** = a club-local calendar month `YYYY-MM` (workspace `timezone`). Sessions are keyed by
`sessionDate`. Money is bounded by `wallClockToUtc('YYYY-MM-01T00:00', tz)` of this month and the next.

**Counted class.** An `AttendanceSession` of the club where:
- `groupId` is set, `isPersonal = false` and `workspaceEventId = null` (scheduled or ad-hoc group class);
- `sessionDate` is in the month;
- for a scheduled session, `isSlotActiveOn(slot, slotId, sessionDate, exceptions)` holds at computation
  time. A class cancelled after the roster was opened drops out. A moved class counts once, on its one-off
  slot.

It is credited to `session.coachId`, the one «кто вёл» source, so a substitute is credited automatically.
`coachId = null` (the account is gone) → «Не распределено».

**Marks** = the class's `AttendanceRecord` rows except the coach's own (`userId ≠ coachId`). Guests count.

**Paid class** = a counted class with marks ≥ the coach's `perClassMinStudents` (default 1, min 0).

**Revenue base** (used only by a percent rate):
1. Rows:
   - abonement sales paid in the month (`paidInRangeWhere`), `+amountPaid`;
   - refunds of abonement sales made in the month (`refundsInRangeWhere`, subscription set), `−amount`.

   Tickets are excluded. Rows in another currency go to `unattributed.otherCurrency`.
2. A row is split between coaches by its subscription's marks in **this month's counted classes**,
   proportionally per crediting coach.
3. No such marks (paid in advance, a refund) → equal split between the primary coaches (`Group.coachId`)
   of the holder's current groups (`GroupMember`).
4. Neither → `unattributed.revenue`.
5. Splits use largest-remainder rounding, so the parts sum exactly to the row.

**Amounts.** The rate is the coach's `CoachRate` with the greatest `effectiveFrom ≤ month`.
- `fixed = fixedMonthly`;
- `classes = paidClasses × perClass`;
- `students = marks(paid classes) × perStudent`;
- `revenue = round(base × revenueBp / 10000)`;
- `adjustments = Σ amounts`.

`total` is the sum; it can go negative only through adjustments, and is never clamped.

**Rows**: anyone with a rate in force, a counted class or an adjustment that month. Without a rate a row
shows the counts, «Ставка не задана» and 0.

**Currency** = the club's dominant tariff currency (`dominantCurrency`, `revenue.ts:129`), else `RUB`. It
is stored on each rate and on a closed month.

**Glossary (B2, `2026-11-08-admin-cleanup.md:264-284`)**: add
- `payroll_classes` «Занятий (к оплате)»;
- `payroll_marks` «Отметок»;
- `payroll_revenue_base` «Оплаты учеников {тренера}».

All three come from `payroll-rules.ts` and are shown on «Выплаты», in the CSV and in «Мои выплаты».

## 2. Data model (Prisma, additive; `db push` without `--accept-data-loss`)

```prisma
model CoachRate {          // a coach's rate from a month on; new table, so the unique is safe
  id String @id @default(uuid()) @db.Uuid
  workspaceId String @db.Uuid                 // → Workspace, Cascade
  coachId String @db.Uuid                     // → User @relation("CoachRates"), Cascade (users are anonymised, not deleted)
  effectiveFrom DateTime @db.Date             // first day of the month
  fixedMonthly Int @default(0)   perClass Int @default(0)   perClassMinStudents Int @default(1)
  perStudent Int @default(0)     revenueBp Int @default(0)  // 0..10000 = 0..100 %
  currency String @db.Char(3)    updatedById String @db.Uuid   // display/audit, no FK
  createdAt DateTime @default(now())   updatedAt DateTime @updatedAt
  @@unique([workspaceId, coachId, effectiveFrom])
  @@index([workspaceId, effectiveFrom])
}
model PayrollAdjustment {  // bonus (+) / deduction (−); locked while its month is closed
  id String @id @default(uuid()) @db.Uuid
  workspaceId String @db.Uuid   month DateTime @db.Date
  coachId String @db.Uuid                     // no FK: survives removal
  amount Int                                  // ≠ 0
  comment String @db.VarChar(500)
  createdById String @db.Uuid   createdByName String @db.VarChar(255)   createdAt DateTime @default(now())
  @@index([workspaceId, month])
}
model PayrollMonth {       // exists only while closed; reopen deletes it (the audit keeps totals)
  id String @id @default(uuid()) @db.Uuid
  workspaceId String @db.Uuid   month DateTime @db.Date   currency String @db.Char(3)
  total Int   unattributedRevenue Int @default(0)
  closedAt DateTime @default(now())   closedById String @db.Uuid   closedByName String @db.VarChar(255)
  lines PayrollLine[]
  @@unique([workspaceId, month])
}
model PayrollLine {
  id String @id @default(uuid()) @db.Uuid
  payrollMonthId String @db.Uuid              // → PayrollMonth, Cascade
  workspaceId String @db.Uuid   coachId String @db.Uuid   coachName String @db.VarChar(255)  // no FK
  classes Int   classesPaid Int   marks Int   revenueBase Int
  fixedAmount Int   classAmount Int   studentAmount Int   revenueAmount Int   adjustmentsAmount Int   total Int
  rate Json?                                  // the values used; null = no rate
  @@index([workspaceId, coachId])
}
```
(Fields are packed several per line for reading; one per line in the schema. Every `workspaceId` is a
Cascade relation to `Workspace`.)

`Workspace` gains `coachPayVisible Boolean @default(false)` and back-relations; `User` gains
`coachRates`. No backfill, no `deploy/update.sh` step.

## 3. Server

### 3.1 Domain — `apps/server/src/domains/payroll/`

- `payroll-rules.ts` (pure, unit-tested):
  - `parseMonth`, `monthBounds(month, tz)`;
  - `countedClasses(sessions, slots, exceptions)`, `rateFor(rates, month)`;
  - `attributeRevenue(rows, marksBySub, rosterCoaches)`, `computeLines(facts, rates, adjustments)`.
- `payroll-loader.ts` `loadPayrollFacts(prisma, { workspaceId, month, tz })`:
  - sessions with records over month ± 1 day on `@@index([workspaceId, startAt])`, filtered by
    `sessionDate`;
  - slots and exceptions;
  - sales and refunds through the metrics where-builders, never a hand-written money `where`
    (conventions §1);
  - roster fallback rows.
- `computePayrollMonth(prisma, { workspaceId, month, now })`: a closed month returns the snapshot plus
  `drift = live − snapshot` (null when 0); an open month returns live lines.
- `payroll-lock.ts` `assertMonthOpen(tx, workspaceId, month)` → 409 «Месяц закрыт — откройте его заново
  или внесите корректировку в следующий месяц». Every payroll write calls it inside its transaction.

### 3.2 Endpoints — `features/coach-payroll/` (controller `workspaces/:workspaceId/payroll`)

| Endpoint | Method name | Tier | DTOs | Audit |
|---|---|---|---|---|
| `GET payroll?month=` | `getPayrollMonth` | `CLUB_ADMINS` + `assertClubAdmin` | `GetPayrollMonthQuery` → `PayrollMonthOutput` | — |
| `GET payroll/coaches/:coachId/classes?month=` | `listPayrollClasses` | `CLUB_ADMINS` | → `PayrollClassesOutput` | — |
| `GET payroll/rates` | `listCoachRates` | `CLUB_ADMINS` | → `CoachRatesOutput` (staff + owner, history newest first, `updatedAt`) | — |
| `PUT payroll/rates/:coachId` | `setCoachRate` | `CLUB_ADMINS` | `SetCoachRateInput` (`effectiveFrom`, five numbers, `...ExpectedUpdatedAtField`) → `CoachRateOutput` | `payroll.setRate` {coachId, effectiveFrom, before, after} |
| `POST payroll/adjustments` | `addPayrollAdjustment` | `CLUB_ADMINS` | `AddPayrollAdjustmentInput` {month, coachId, amount, comment} → `PayrollAdjustmentOutput` | `payroll.addAdjustment` |
| `DELETE payroll/adjustments/:adjustmentId` | `deletePayrollAdjustment` | `CLUB_ADMINS` | → 204 | `payroll.deleteAdjustment` {amount, comment} |
| `POST payroll/:month/close` | `closePayrollMonth` | `CLUB_ADMINS` | `ClosePayrollMonthInput` {expectedTotal} → `PayrollMonthOutput` | `payroll.closeMonth` {month, total, coaches} |
| `POST payroll/:month/reopen` | `reopenPayrollMonth` | `CLUB_ADMINS` | `ReopenPayrollMonthInput` {reason 3–500} → `PayrollMonthOutput` | `payroll.reopenMonth` {month, reason, totalBefore, lines} |
| `GET payroll/me?month=` | `getMyPayroll` | `STAFF_ROLES` + `resolveCoachScope` | → `MyPayrollOutput` | — |
| `GET exports/payroll.csv?month=` | `payroll` (export controller) | `CLUB_ADMINS` | CSV | `export.payroll` {month} |

`PayrollMonthOutput`:
- `{ month, status: open|closed, canClose, closedAt, closedBy, currency, total, drift }`;
- `unattributed: { classes, revenue, otherCurrency }`;
- `lines: [{ coachId, name, rate|null, classes, classesPaid, marks, revenueBase, amounts { fixed, classes,
  students, revenue, adjustments }, total, adjustments: [{ id, amount, comment, createdAt, createdByName }] }]`.

Handler rules:
- **`setCoachRate`**:
  - `coachId` must be the owner or an ACTIVE `COACHING_ROLES` member (`coachCandidatesWhere`,
    `class-substitution-access.ts:58`), else 400 «Это не сотрудник клуба»;
  - no closed month at or after `effectiveFrom`, else 409;
  - write: `create`; on P2002, update through `claimUnchanged`;
  - limits: amounts 0..10 000 000, threshold 0..100, `revenueBp` 0..10000 (two decimals of percent in
    the UI).
- **Adjustments**: `amount ≠ 0`, |amount| ≤ 10 000 000, comment 1–500 trimmed, the month must be open.
- **`closePayrollMonth`**:
  - the month must have ended in club time, else 400 «Месяц ещё не закончился»;
  - recompute in the transaction; `total ≠ expectedTotal` → 409 `STALE_UPDATE` «Суммы изменились —
    проверьте и закройте снова»;
  - write the snapshot; P2002 → 409 «Месяц уже закрыт»;
  - after commit: realtime `payroll`, and `payroll.closed` to each coach with a line, only if
    `coachPayVisible`.
- **`reopenPayrollMonth`** deletes the `PayrollMonth` (lines cascade, adjustments stay) and emits realtime
  `payroll`. No notification.
- **`getMyPayroll`**:
  - `resolveCoachScope` refuses non-staff;
  - `!coachPayVisible && !isClubAdmin` → 403 «Клуб не показывает выплаты в приложении»;
  - it returns only the invoker's last 12 closed months (lines + that month's adjustments with comments)
    and `current { month, classes, marks }` live, **with no money fields**.
- **Settings**: `UpdateWorkspaceSettings` gains `coachPayVisible` (already `CLUB_ADMINS`; the existing
  settings audit action; label added). `get-my-workspace-membership.handler.ts` gains
  `canSeeOwnPay = isStaff && coachPayVisible`, next to `canMarkAnyClass` (`:76`).

### 3.3 Realtime, notifications, tiers

- Realtime **`payroll`** from every write above (resource names only). Mobile ignores it.
- Notification **`payroll.closed`**: «Выплаты за {ноябрь} готовы» / «Посмотрите в профиле: «Мои выплаты».».
  **No amount in a push** (lock screen). Mobile route → `MyPay { month }`. Mutable (not in `EXEMPT_KINDS`).
- `route-tier-consistency.spec.ts`: the pinned `CLUB_ADMINS` list gains the eight club-admin routes and
  `export.controller.ts payroll`; `getMyPayroll` is a coach-scope read.
- `AuditAction` gains `payroll.setRate`, `payroll.addAdjustment`, `payroll.deleteAdjustment`,
  `payroll.closeMonth`, `payroll.reopenMonth`, `export.payroll`.

## 4. Admin UI

### 4.1 Where it lives

**«Отчёты → Выплаты»** (`analytics/payroll`): a new `reportTabs` entry after «{Тренеры}», with
`access: "clubAdmin"`. The page has `layout.tsx` with `ClubAdminGate`. The sidebar stays at 11 items.
- «Отчёты» already holds the other club-admin money reads («Выручка и прогноз», «Выгрузка»).
- «Абонементы» is what members pay.
- «Тренеры» is `sportLead`, so a head coach would see colleagues' pay there.

**The rate is edited in the coach's payout panel**, not in Settings or the member card. One place per job:
«сколько платить тренеру» is answered and changed where it is used.

**The switch** goes in «Настройки → Права {тренеров} и запись» (`settings/access/page.tsx:36-61`): a new
card «Выплаты в приложении» with one `SettingRow`.
- Title: «{Тренеры} видят свои выплаты».
- Description: «Каждый видит только себя и только закрытые месяцы: начисления, ставку и корректировки с
  комментариями. За текущий месяц — число {занятий} и отметок, без денег.»

### 4.2 Page — `features/payroll/PayrollMonthView.tsx` (own fetch)

1. `SectionTabs` «Отчёты».
2. Control row:
   - «‹ Ноябрь 2026 ›» (`?month=`; default is the previous month until the 5th, then the current one);
   - status: «Предварительно — пересчитывается» or «Закрыт 2 дек. · Ольга Кузнецова»;
   - **one primary**, «Закрыть месяц» (open and ended months only);
   - «⋯»: «Скачать CSV» · «Открыть заново» (closed months).
3. Muted line: «Расчёт до налогов. Выплату и налоги клуб оформляет сам.»
4. Table, one card with dividers:
   - columns: {Тренер} · {Занятий} (paid/counted) · Отметок · Начислено · Корректировки · Итого;
   - sorted by name, footer «Итого»;
   - the row opens the panel (`?coach=<id>`); no rate → muted «Ставка не задана».
5. Lines shown only when non-zero:
   - «Не распределено: 3 {занятия} без {тренера}, оплаты 4 500 ₽ — не нашлось ни посещений, ни группы
     ученика»;
   - on a closed month with drift: «С момента закрытия данные изменились: сейчас вышло бы на 1 200 ₽
     больше. Учтите разницу корректировкой в следующем месяце.»
6. `useWorkspaceRealtime(workspaceId, ["payroll", "attendance"])` reloads an open month. `attendance` is the
   key attendance writers emit (`mark-records.handler.ts:233`, `change-record-abonement.handler.ts:144`).
7. Empty: «В этом месяце {занятий} не было и ставки не заданы». A failed load shows the error line with
   «Повторить».

**Close**: `confirmDialog` with title «Закрыть ноябрь?» and description «Суммы зафиксируются: 8
{тренеров}, итого 412 000 ₽. Правки посещаемости и ставок после закрытия на ноябрь не повлияют.» When the
switch is on, it adds «{Тренеры} увидят свои выплаты в приложении.» The request sends `expectedTotal` = the
shown total; on 409 the page reloads and shows the server message.

**Reopen**: a side panel with a required «Причина» (`FORM_LIMITS.payrollReopen.reason`) and «Открыть
месяц» (destructive). The inline form is the confirmation.

### 4.3 Coach panel — `features/payroll/PayrollCoachSheet.tsx`

- **Facts**, non-zero parts only:
  - «Оклад 30 000 ₽»;
  - «За {занятия}: 14 × 1 500 ₽ = 21 000 ₽ (ещё 2 не оплачены: пришло меньше 3)»;
  - «За отметки: 96 × 100 ₽»;
  - «Процент: 10 % от 84 000 ₽».
- **«Корректировки»**: rows «+5 000 ₽ · Открытый урок · О. Кузнецова, 30 нояб.», each with «⋯ → Удалить»
  (`confirmDialog`). «Добавить корректировку» swaps in «Премия / Удержание», the amount and «Комментарий»
  (hint «увидит {тренер}, если клуб показывает выплаты»).
- **«{Занятия}»** (collapsed, lazy `listPayrollClasses`): date, group, marks, «замена», «не оплачено»;
  classes cancelled after opening are muted, with «отменено».
- **«Ставка»**: the rate in force «с {месяца}». «Изменить ставку» swaps in `CoachRateForm`:
  - «Действует с» (open months, current onward);
  - the four amounts and «Платить за {занятие}, если пришло не меньше N»;
  - limits from `FORM_LIMITS.coachRate.*`; `useDirtyGuard`; `expectedUpdatedAt` + `StaleUpdateNotice`;
  - one filled «Сохранить ставку».
- **Closed month**: read-only, with the snapshot rate and no forms.

### 4.4 Elsewhere

- «Выгрузка» (`analytics/export`) gets a row «Выплаты за месяц» with a month select → `payroll.csv`.
- `features/audit/audit-meta.ts`: labels for the six actions and the keys `effectiveFrom`, `reason`,
  `coachPayVisible`.
- `apps/admin-e2e/src/role-matrix.ts`: `analytics/payroll` → owner/admin allowed; head coach, direction
  manager and coach get the gate notice.

## 5. Mobile (coach)

- **Entry**: Profile row «Мои выплаты» (`MyPay`), shown on `canSeeOwnPay`. `NavSection` gains
  `ownPayOnly?: boolean` (`app/nav-sections.ts:40-60`), filtered like `clubInviteOnly`, group `account`.
- **`features/payroll/MyPayScreen.tsx`** (root stack, `RootStackParamList.MyPay: { month?: string }`):
  - a card «В этом месяце: 12 {занятий} · 87 отметок»;
  - the closed months: «Ноябрь · 61 000 ₽». Tapping one expands parts, rate and adjustments with
    comments;
  - empty: «Закрытых месяцев пока нет — клуб закрывает месяц после расчёта.»;
  - `<ErrorRetry>` on failure; a 403 (the club turned it off) shows the server message.
- `shared/api/payroll.ts` `getMyPayroll`; notification route `payroll.closed` → `MyPay { month }`.
- Students and parents: no change.

## 6. MCP / AI

**No payroll data in any AI tool**, `club_overview` included. A coach's pay is staff personal data and
money. The AI data-transfer acceptance covers club analysis, and nobody has asked an assistant about pay.
`revenue_report` is unchanged. `docs/mcp.md` gets one line: «Выплаты тренерам в ИИ не передаются».

## 7. CSV

`exports/payroll.csv?month=YYYY-MM` (`export.service.ts` `payrollCsv`) goes through `audited()`
(`export.controller.ts:64-87`). Columns:

`Месяц; Статус (закрыт/предварительно); Тренер; Занятий; Оплачено занятий; Отметок; Оплаты учеников;
Оклад; За занятия; За отметки; Процент; Корректировки; Итого; Валюта`

Then «Итого», and «Не распределено» if non-zero. A closed month reads the snapshot; an open month is live.

## 8. Demo content (`domains/demo/demo-club.plan.ts`, `ritm-demo.plan.ts`, deterministic)

- `coachPayVisible: true` in both clubs, so `coach@academy.demo` and `pedagog@ritm.demo` show «Мои выплаты».
- Rates: the ACADEMY head coach 40 000 fixed + 10 %; two coaches 1 500 per class (min 3) + 100 per mark; one
  coach 2 000 per class with a raise from the current month (two history rows); the Ritm pedagog 250 per mark.
- **The previous month is closed**: the writer computes the snapshot with `computePayrollMonth`, so the
  numbers agree. It has one adjustment «+5 000 ₽ · Открытый урок», one approved substitution and one class
  cancelled after its roster was opened, so «замена» and «отменено» show in the panel.
- `DemoClubPlan` gains `coachRates`, `payrollAdjustments`, `payrollMonths`, `payrollLines`, and
  `demo-club.wipe.ts` deletes them. In `docs/demo.md`, the owner row names «Отчёты → Выплаты» and the coach
  row «Профиль → Мои выплаты».

## 9. Tests

Server unit (conventions §1: refusal per role, owner bypass, not-found, each branch):
- `domains/payroll/payroll-rules.spec.ts`:
  - personal, event and groupless sessions are excluded;
  - a late exception excludes a class, a moved class counts once, the substitute is credited, a null coach
    goes to unattributed;
  - the coach's own mark is excluded and guests count; thresholds 0/1/3; `rateFor` takes the latest rate ≤
    month, or null;
  - attribution by marks across two coaches, roster fallback with an equal split, unattributed, negative
    refunds, other currency, exact largest-remainder sums;
  - month bounds in `Asia/Vladivostok` and `Europe/Kaliningrad`.
- `features/coach-payroll/*.handler.spec.ts`:
  - every club-admin route: head coach 403, coach 403, owner without a member row passes;
  - rate: non-staff 400, closed 409, stale 409. Adjustment: closed 409, zero 400;
  - close: not ended 400, mismatch 409, P2002 409, notification only with the switch and without amounts;
  - reopen: reason required, snapshot deleted, audit has the totals;
  - `getMyPayroll`: switch off → 403 for a coach and 200 for a club admin; own lines only; `current` has no
    money.
- Also `export.service.spec.ts` (closed vs open), `route-tier-consistency.spec.ts`, the membership spec
  (`canSeeOwnPay`) and `demo-club.plan.spec.ts` (closed total = recomputed total).

Server e2e `apps/server-e2e/src/payroll/coach-payroll.e2e-spec.ts`:
- `owner sets rates and sees last month's payouts`
- `a substitute is credited, the group coach is not`
- `a class cancelled after attendance does not count`
- `percent rate splits a paid abonement by visits`
- `closing freezes the month; later attendance edits only change drift`
- `rate change and adjustment in a closed month are refused`
- `reopen with a reason, close again`
- `head coach and coach get 403 on every payroll route`
- `coach sees own closed months only when the club enables it`
- `payroll.csv matches the closed snapshot`

Admin:
- `payroll-view.spec.ts`: breakdown lines, the default month, the close text with and without the switch;
- `PayrollCoachSheet.spec.tsx` with `<ConfirmDialogHost />`: `expectedUpdatedAt` is sent, a closed month has
  no forms, deleting an adjustment confirms;
- `contract-limits.spec.ts` (`coachRate.*`, `payrollAdjustment.*`, `payrollReopen.reason`);
- role matrix + smoke.

Mobile: `my-pay.spec.ts`, `nav-sections.spec.ts` (`ownPayOnly`), `notification-route.spec.ts`.

## 10. Acceptance checklist

- [ ] Owner on ACADEMY: «Отчёты → Выплаты» shows last month closed and this month preliminary.
      Σ rows = total, and the CSV equals the screen.
- [ ] A class run by a substitute counts for the substitute only.
- [ ] Cancelling a class whose roster was opened removes it from an open month. A closed month only gets
      the drift line.
- [ ] A rate «с декабря» leaves November unchanged. A closed month can't be picked, and the API returns
      409.
- [ ] An adjustment updates the row at once. A closed month has no form, and the API returns 409.
- [ ] Closing confirms with the total. A second admin closing at the same moment gets «Месяц уже закрыт».
- [ ] Head coach and coach: no tab; the URL shows the gate notice; the API returns 403.
- [ ] Switch off: a coach has no «Мои выплаты». Switch on: own closed months only, current counts without
      money, and the push «Выплаты за … готовы» after a close.
- [ ] «История изменений» lists rate changes, adjustments, close and reopen (with the reason) and the CSV
      download.
- [ ] tsc (server, admin, mobile), tests, contract drift, admin smoke green.

## 11. Rollout

One PR «Выплаты тренерам»:
- `db push` (four tables, one column);
- contract regen;
- CHANGELOG;
- `docs/demo.md`, `docs/mcp.md`, glossary rows.

No backfill, no breaking change. Rollback = the previous image.

## 12. Decisions

- **Rate = four optional parts** (fixed, per paid class with a min-students threshold, per mark, percent of
  attributed abonement money), per coach, whole months via `effectiveFrom`. This covers оклад, «за
  тренировку», «за голову» and процент without a rule engine.
- **«Кто вёл» = `AttendanceSession.coachId`**, which is already synced with substitutions. Payroll never
  re-derives substitutions.
- **A class counts only with an opened roster and no cancellation.** It is paid when marks ≥ the
  threshold. An unopened roster is no evidence the class happened.
- **Personal trainings, events, seminars → adjustments.** Their price is off-app.
- **Attribution by visits, then the roster's primary coach, else «не распределено»**, net of refunds by
  refund date (the journal rule), tickets excluded. It is explainable and credits substitutes.
- **Lock = snapshot table.** A closed month reads `PayrollLine`; writes check the lock inside their
  transaction; live differences show only as drift; corrections go into the next month.
- **Reopen with a mandatory reason**, audited with the old totals. Forbidding it would force fake
  adjustments after a genuine mistake.
- **Close only after month end, guarded by `expectedTotal`.**
- **Placement**: «Отчёты → Выплаты» (club admins), the rate in the coach panel, the switch in «Права
  тренеров». No sidebar item.
- **Coach visibility**: a club switch, off by default; own data, closed months, current counts without
  money. A preliminary sum invites disputes.
- **Wording «Выплаты», never «зарплата»**: самозанятые/ИП are common, and «зарплата» implies ТК РФ
  employment. The page says «до налогов».
- **No AI access. Audit metadata holds amounts** (the page is club-admin only) but no student names.
- **(implementation) The per-mark part pays the marks of paid classes**, as specified; the line carries both
  `marks` (glossary «Отметок») and `marksPaid` (DTO + `PayrollLine.marksPaid`), so «За отметки: N × …» adds
  up on screen.
- **(implementation) The percent part is never negative.** A refund-heavy month gives `revenue = 0`
  (`revenueBase` still shows the negative share); a clawback is an adjustment. Only adjustments take a
  total below zero.
- **(implementation) `unattributed.otherCurrency` is a count of rows**, not a sum (amounts in different
  currencies don't add). `PayrollMonth` also freezes `unattributedClasses` and `otherCurrencyRows`.
- **(implementation, owner decision) A rate alone makes a row when it is in force for the month and the
  person had not left before that month began**: today's staff (owner, active coaching members — whenever
  they joined: an explicit rate for a month before the membership began, e.g. for staff imported later, is
  meant) plus anyone removed, gone or demoted to a student since the month began (the club's journal:
  `member.remove` / `member.leave` / `member.updateRole` → user; membership rows are deleted on removal).
  A departed coach's pay stops with the month they left. A closed month's drift also counts its frozen
  coaches as staff, so a departure is never drift.
- **(implementation) An opened class is tested against the cancellations only**, never the slot's current
  weekday or effective range (it was checked when opened; editing the slot later must not un-count it). A
  class whose slot was deleted keeps the slot from its occurrence key and is still dropped by a group-wide
  cancellation; the slot's own cancellations are deleted with the slot (Cascade), so those can't apply.
  Ad-hoc classes are never cancelled by an exception.
- **(implementation) Drift is per coach**: `driftByCoach` lists every coach whose total changed; `drift`
  (total difference) is null only when that list is empty, so offsetting changes show as 0. Close accepts
  optional `expectedLines` and refuses (409 STALE_UPDATE) when any coach's total differs.
- **(implementation) Marks in a class whose coach account is gone attribute no money**: such an abonement
  falls through to the roster rule, then «не распределено».
- **(implementation) Payroll writes serialise on a per-club Postgres advisory lock**
  (`pg_advisory_xact_lock`, `payroll-lock.ts`) taken inside each write's transaction (`assertMonthOpen`
  takes it). Under it `setCoachRate` reads the month's row and then creates or updates — a failed
  statement (P2002) would abort the Postgres transaction. Close still maps a P2002 to «Месяц уже закрыт».
- **(implementation) The rate form's version is the coach's newest rate change**: `listCoachRates` returns it
  per coach as `updatedAt`, and `claimUnchanged` refuses the save if any of that coach's rates changed after
  it.
- **(implementation) `DELETE payroll/adjustments/:id` answers `{ status: 'deleted' }`** (the repo's delete
  convention, e.g. discounts), not 204.
- **(implementation) `GET payroll/me` takes no `month`**: it always returns the last 12 closed months and the
  current counts; the app's `MyPay { month }` only picks the row to expand.
- **(implementation) An adjustment may name the owner, an active coaching member, or anyone credited with a
  class that month** (a coach who left mid-month). Anyone else → 400 «Это не сотрудник клуба».
- **(implementation) «Занятия» in the panel are live, also for a closed month**, and include the classes of
  the coach's groups someone else ran (`other_coach`, «вёл …»). «Замена» = the credited coach is not one of
  the group's coaches.
- **(implementation) `payroll.closed` skips the admin who closed the month** and is deduplicated per close
  (a reopen + close notifies again). No amount, as designed.
- **(implementation) Audit target type `payroll`**: `setRate` targets the coach, the other actions their row
  (adjustment, month).
- **(implementation) Demo: the writer freezes the closed month with the close handler's own code**
  (`computeLivePayroll` + `writePayrollSnapshot`) after every row is inserted, so the snapshot equals a
  recomputation; the plan carries `coachRates`, `payrollAdjustments` and `payrollClose` instead of
  precomputed `payrollMonths`/`payrollLines`. The plan spec checks the closed month's facts (the substitute
  credited, the late cancellation dropped) with the pure rule. The studio «Ритм» closes last month too, so
  `pedagog@` sees one. `demo-club.wipe.ts` is unchanged: the four tables cascade from `Workspace`
  (`CoachRate` also from `User`).
- **(implementation) The club's payroll currency is the dominant currency of all its tariffs** (archived
  included), else RUB. A closed month keeps its frozen currency. **A rate or an adjustment in another
  currency than the month's is ignored and flagged**, never reinterpreted: the line shows `ignoredRate`
  (and pays no rate), an adjustment carries `currency` + `ignored` and stays out of the amounts and of
  «Мои выплаты». `PayrollAdjustment.currency` records the club currency when it was added.
- **(implementation) «Выплаты за … готовы» goes only to current staff** (`coachCandidatesWhere`) with a
  line — not to someone who left or became a student (they would land on a refusal).
- **(implementation) Admin control row has no «⋯»**: an open month shows «Скачать CSV» (ghost) and the one
  primary «Закрыть месяц»; a closed one «Скачать CSV» and «Открыть заново» (ghost). A «⋯» with one or two
  items hides them for nothing. «‹ ›» stops at the club's current month.
- **(implementation) An adjustment row has a trailing «×» (with `confirmDialog`)**, not «⋯ → Удалить», for
  the same reason.
- **(implementation) The rate form offers months from the viewed (open) month to two months past the
  current one and defaults to the later of the viewed and the current month**, so a save from a past
  month's panel on the 1st–5th never rewrites that month unless it is picked; a later closed month is the
  server's 409. «Изменить ставку» waits for `listCoachRates`, so the version is always the one read when
  the panel opened; a person no longer on staff gets no rate button. Rates already saved for later months
  show under the rate in force («С декабря: …»).
- **(implementation) An open month lists every staff member from `listCoachRates` who has no row** as a
  zero row «Ставка не задана»; its panel opens straight on the rate form. A closed month shows exactly its
  snapshot. A rate in another currency reads «Ставка в KZT не применяется — задайте ставку в RUB»; an
  adjustment in another currency is muted with «не учтена: другая валюта».
- **(implementation) Drift names who it concerns** (`driftByCoach`), also when offsetting changes keep the
  total («итог тот же, но изменились суммы у 2 тренеров (…)»); close sends the shown per-coach totals as
  `expectedLines`.
- **(implementation) «Занятия» in the panel**: `other_coach` reads «замена: <кто вёл>» (gender-neutral), a
  substitute's own class «замена», cancelled/unpaid in the club's words («отменена/отменено»).
- **(implementation) The CSV row on «Выгрузка» is its own card «Выплаты за месяц»** (month select, the last
  13 months) under the existing card; `downloadExport` gained the `payroll` kind with `{ month }`.
- **(implementation) «Мои выплаты» is a plain fetch, never cached**, so sums don't outlive the club turning
  the switch off; a 403 shows the server's message without «Повторить». The month a push names opens
  expanded. The row sits after «Мой абонемент» on Profile and in the web sidebar (which reads the
  membership for `canSeeOwnPay`; `visibleSections` gained a `canSeeOwnPay` argument next to `canSeeInvite`).
  `payroll.closed` routes to `MyPay` ungated by app sections.
- **(implementation) Audit**: `month`/`effectiveFrom` read «ноябрь 2026», `before`/`after` the rate in words
  («1 500 ₽ за тренировку (от 3 учеников)»), `lines` «Имя — сумма; …», `coaches` in the club's words.

## 13. Implementation slices

S1 lands the schema, DTOs, controllers and regenerated contract first; S2 and S3 then build against real
types. Nobody runs the full gate mid-flight; the integrator runs it once.

| Slice | Owns (only these files) | Size |
|---|---|---|
| S1 server | `apps/server/prisma/schema.prisma`; `src/domains/payroll/**` (+specs); `src/features/coach-payroll/**`; `features/data-export/{export.controller,export.service}.ts` (+specs); `features/{update,get}-workspace-settings/*` (`coachPayVisible`); `features/get-my-workspace-membership/*`; `domains/audit/services/audit.service.ts`; `shared/access/route-tier-consistency.spec.ts`; `app/app.module.ts`; `domains/demo/{demo-club.plan,ritm-demo.plan,demo-club.writer,demo-club.wipe}.ts` (+specs); `apps/server-e2e/src/payroll/**`; `open-api.json`, `libs/api-client/src/openapi/*`; `docs/demo.md`, `docs/mcp.md` | M (≈ 3 d) |
| S2 admin | `apps/admin/src/features/payroll/**` (+specs); `app/(dashboard)/workspace/[workspaceId]/analytics/payroll/{page,layout}.tsx`; `…/sections.ts`; `…/settings/access/page.tsx`; `…/analytics/export/page.tsx`; `shared/api/payroll.ts`; `shared/lib/contract-limits.ts` (+spec); `features/audit/audit-meta.ts`; `apps/admin-e2e/src/role-matrix.ts` | M (≈ 2 d) |
| S3 mobile | `apps/mobile/src/features/payroll/**` (+spec); `src/app/{navigation.ts,App.tsx,nav-sections.ts}` (+spec); `src/shared/api/payroll.ts`; the membership type consumer; `features/notifications/notification-route.ts` (+spec) | S (≈ 1 d) |

The contract S1 → S2/S3: the §3.2 DTOs, realtime `payroll`, notification `payroll.closed`, `canSeeOwnPay`
and `coachPayVisible`.

**With the leads design** (`/tmp/designs/leads.md`): both touch `reportTabs`, `audit.service.ts`,
`audit-meta.ts`, `route-tier-consistency.spec.ts`, `role-matrix.ts`, `app.module.ts` and the demo plans.
Land them in sequence (E4 first) or rebase the second. Tab order: Выручка и прогноз · Загрузка залов ·
{Тренеры} · Выплаты · Пробные · Когорты новичков · Выгрузка · Спросить ИИ.

Integrator checks:
- tsc ×3;
- `npx nx test @clubspace/server -- payroll`, `-- export`, `-- route-tier`, `-- workspace-membership`,
  `-- demo-club`;
- admin and mobile tests;
- e2e `payroll/*`, `demo/*`;
- contract drift;
- `npm run test:admin-e2e`;
- `cs-reviewer`.

## 14. Open risks

- **Attendance discipline decides pay.** A coach who doesn't open rosters earns nothing per class. The
  incentive is right, but the first month will surface gaps. A v1.1 hint «по расписанию, но без отметки»
  in the panel is cheap if admins ask.
- **The roster fallback reads current groups**, so recomputing an old *open* month after roster changes
  can shift percent shares. Closing removes the risk.
- **Load**: a 300-student club has ~1–3k sessions and ~30k records a month, which is fine for an on-demand
  read. If not, cache the open month for 60 s and clear it on `payroll`/`attendance`.
- **Legal**: the calculation is an internal document of the club. The owner/lawyer should confirm the
  «до налогов» disclaimer and the «Выплаты» wording suffice.
