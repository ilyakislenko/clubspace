# Payments journal and refunds (backlog E1)

Status: **design** · 2026-11-15 · base: `feat/admin-cleanup` @ `e3113745`
Parent: [admin cleanup](2026-11-08-admin-cleanup.md) §9 E1 (owner: «стартуй разработку», order
E1 → E6 → E3 → E2). Evidence: [UX audit](2026-11-08-admin-audit-ux.md) §5 rows «Касса / журнал» and
«Возвраты»; [stability audit](2026-11-08-admin-audit-stability.md) «Depth», row «Finance». File:line
references are as of `e3113745`.

## Кратко (для владельца)

Сейчас деньги клуба разбросаны: наличные, перевод и карта в клубе отмечаются в карточке ученика,
оплаты событий — в списке записавшихся, а на вкладке «Абонементы → Платежи» видны только онлайн-платежи.
Вернуть можно только онлайн-платёж и только целиком. Кроме того, возврат онлайн-оплаты абонемента
не уменьшает выручку: на «Сегодня» сумма остаётся завышенной.

Что сделаем, в два шага:
1. **Журнал платежей.** Вкладка «Платежи» станет одним списком всех оплат: абонементы и события,
   наличные, перевод, карта в клубе и онлайн. Можно выбрать период, способ оплаты и сотрудника,
   который отметил оплату, и найти ученика. Вверху — итоги по способам, есть выгрузка в CSV.
   Нажатие на строку открывает подробности со ссылкой на карточку ученика.
2. **Возвраты.** Из подробностей оплаты можно вернуть всю сумму или часть: наличными, переводом,
   картой в клубе (это только запись в журнале) или онлайн через ЮKassa/Stripe (деньги уходят сами,
   ЮKassa отправляет чек возврата). Для каждого возврата сохраняются сумма, способ, кто вернул и почему.
   Выручка везде считается за вычетом возвратов. Ученик видит у абонемента «возвращено N ₽» и получает
   уведомление.

Видят и делают это только владелец и администраторы. Главный тренер по-прежнему отмечает оплату,
но журнала и возвратов не видит.

## Problem

1. **No single place for money.** Manual payments are fields on each sale row. An abonement
   (`Subscription.isPaid/paidAt/amountPaid/paymentMethod`, `schema.prisma:1995-2008`) is marked through
   `POST …/subscriptions/:subscriptionId/payment` (`member-subscriptions.controller.ts:173-174`) from the
   member card (`features/subscriptions/MemberSubscriptionPanel.tsx:187`). An event ticket
   (`EventRegistration.isPaid…markedPaidById`, `schema.prisma:1057-1067`) is marked through
   `POST …/event-registrations/:registrationId/payment` (`event-registrations.controller.ts:164-166`) from
   «Записавшиеся» (`features/events/EventRegistrationsPanel.tsx:85`). The only list is
   «Абонементы → Платежи» (`sections.ts:50-64` → `features/payments/PaymentsList.tsx`). It shows `Payment`
   rows, i.e. online checkouts only (`list-payments.handler.ts`, `payments.controller.ts:67-68`), so a club
   paid in cash sees «Платежей пока нет» (UX audit §5).
2. **Who took the cash is unknown for abonements.** Tickets store `markedPaidById`
   (`schema.prisma:1067`). Subscriptions have no such column, and the `member.markSubscriptionPaid` audit
   entry has no `subscriptionId` (`mark-subscription-paid.handler.ts:54-65`). An owner can't reconcile the
   cash a coach collected.
3. **Refunds are full-only and online-only.** `RefundPaymentFeature` has no amount
   (`refund-payment.feature.ts`). The handler always sends `payment.amount`
   (`refund-payment.handler.ts:75-85`). Cash, transfer and in-club card refunds can't be recorded at all.
   The gateway already accepts an amount (`payment-gateway.client.ts:86-95`), and YooKassa's
   `buildYookassaRefund` sends it (`yookassa-api.ts:116-128`). Stripe's `buildStripeRefund` ignores it, so
   it always refunds in full (`stripe-api.ts:101-109`).
4. **A refund doesn't leave revenue consistently.** Revenue counts paid sale rows only
   (`domains/metrics/revenue.ts:263-298`, glossary B2 `revenue_30d`).
   - A refunded online **abonement** stays `isPaid` with its `amountPaid`, so it still counts in
     `revenue_30d`, `mrr`, the tariff page and `revenue.csv`. The refund handler leaves the abonement
     untouched (`refund-payment.handler.ts:24-29`).
   - A refunded online **ticket** is *unmarked* (`refund-payment.handler.ts:111-125`). It leaves revenue,
     but its payment also disappears from every list.
   - Nothing records that money went back.
5. **54-ФЗ for partial refunds.** With «Чеки от ЮKassa», a partial refund must carry a `receipt` object.
   A full refund reuses the payment's receipt
   ([ЮKassa: чеки при возвратах](https://yookassa.ru/developers/payment-acceptance/receipts/54fz/yoomoney/refunds)).
   `buildYookassaRefund` never sends one (`yookassa-api.ts:116-128`). Club `Payment` rows don't store the
   receipt e-mail; create-payment uses the buyer's `user.email` (`create-payment.handler.ts:133`).

## Goal / non-goals

**Goal.** A club admin answers «сколько денег пришло за период, каким способом, кто принял» in one
screen, and every number there equals the glossary. Money returned, whole or part, any method, is
recorded once and subtracted everywhere revenue is shown.

**Non-goals.**
- Platform money (club → ClubSpace: `PlatformPayment`, «Подписка ClubSpace»).
- Rank-grading fees. `RankGradingCandidate.paidAt` is a flag without an amount, method or marker
  (`schema.prisma:2580-2583`) and is not glossary revenue. Adding it means changing the grading UI and
  the revenue definition, and nobody asked for that. It stays out until a grading-money decision.
- A cash desk with opening/closing balances, expenses, P&L (backlog E8).
- Fiscal receipts for offline payments. ClubSpace is not a cash register; the club's own register
  issues them. Online receipts stay with ЮKassa (Stripe has none, as today).
- A member payment-history screen or receipt download (no requester; see §5).
- Changing who may mark payments (Q1 stays: coaching roles mark, sport leads unmark).

## Ground rules

As in the [parent spec](2026-11-08-admin-cleanup.md#ground-rules-for-the-implementer):
- `CLAUDE.md` + `docs/conventions.md` are authoritative.
- `prisma db push` only; data moves via `deploy/update.sh` `migrations()`.
- Authorize in the handler.
- `serialize*` DTOs; unique controller-method and DTO names.
- Regenerate the contract after DTO changes.
- Follow the UI rules.
- Money is `CLUB_ADMINS` (§1 matrix: «refunds, online-payments list» ✅ admin only).

## 1. The money rule

- A **sale** is a paid `Subscription` or a paid `EventRegistration`. Cancelled registrations count too:
  «a paid one stays as the money's record», `schema.prisma:1015`. Revenue already counts exactly these
  rows.
- A `Payment` (online checkout) is the provider's side of a sale. It never feeds revenue on its own.
- A **refund** (new `Refund` row) returns part or all of one sale's money. Revenue in a window =
  sales paid in the window − refunds of sales made in the window (by refund date). A refund never
  changes the sale row's `isPaid/paidAt/amountPaid`; it raises the sale's `refundedAmount`.
- An **unapplied online payment** (`Payment.status = SUCCEEDED` with `activationError`: the money came,
  the abonement or place could not be granted) is not a sale. It is not revenue (as today) and not a
  journal row. It shows in a «needs decision» strip until it is refunded. Its refund is a `Refund` with
  only `paymentId` and is never subtracted from revenue.
- The journal lists sales and refunds of sales. Its «Итого» over a period is that period's revenue, so
  **journal «Итого» for the default period = dashboard «Выручка за 30 дней»** (same window, same rows).

## 2. Data model (Prisma, additive; `db push` without `--accept-data-loss`)

Phase A (journal):
```prisma
model Subscription {
  // …existing fields…
  // Who recorded the payment: staff marking it paid, or selling it as paid.
  // Display only, no FK — survives the actor's removal (like
  // EventRegistration.markedPaidById). null: online, unpaid, imported, legacy
  // rows the backfill could not attribute.
  markedPaidById String? @db.Uuid

  @@index([workspaceId, isPaid, paidAt]) // journal + revenue window reads
}
```

Phase B (refunds):
```prisma
model Subscription      { refundedAmount Int @default(0)  refunds Refund[] }
model EventRegistration { refundedAmount Int @default(0)  refunds Refund[] }
model Payment {
  // Provider-side total refunded; status turns REFUNDED only when it reaches amount.
  refundedAmount Int     @default(0)
  // E-mail the 54-ФЗ receipt went to (YooKassa); a partial refund's receipt reuses it.
  receiptEmail   String? @db.VarChar(255)
  refunds        Refund[]
}
model User { refunds Refund[] @relation("RefundMember")  refundsMade Refund[] @relation("RefundCreatedBy") }

// Money returned for one sale (abonement or ticket), or for an online payment
// that never became one (activationError). Rows are history: a mistaken
// offline record may be deleted (audited); an online refund is final.
// Sport-agnostic: no reference to plans' kinds.
model Refund {
  id          String    @id @default(uuid()) @db.Uuid
  workspaceId String    @db.Uuid
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  // Exactly one sale, or neither (unapplied online payment: paymentId only).
  // Restrict: a refunded sale is a financial record (only the demo wipe deletes
  // sales — it deletes refunds first).
  subscriptionId      String?            @db.Uuid
  subscription        Subscription?      @relation(fields: [subscriptionId], references: [id], onDelete: Restrict)
  eventRegistrationId String?            @db.Uuid
  eventRegistration   EventRegistration? @relation(fields: [eventRegistrationId], references: [id], onDelete: Restrict)
  // The online payment refunded through the provider (method ONLINE).
  paymentId           String?            @db.Uuid
  payment             Payment?           @relation(fields: [paymentId], references: [id], onDelete: Restrict)

  // The sale's holder. Restrict like Payment.userId: account deletion
  // de-identifies the User row, it never deletes it.
  userId   String @db.Uuid
  user     User   @relation("RefundMember", fields: [userId], references: [id], onDelete: Restrict)
  itemName String @db.VarChar(255) // tariff name / event title at refund time

  amount   Int                     // whole currency units, like Plan.price
  currency String        @db.Char(3)
  method   PaymentMethod           // CASH / TRANSFER / CARD = record only; ONLINE = through the provider
  reason   String        @db.VarChar(500)

  createdById String   @db.Uuid
  createdBy   User     @relation("RefundCreatedBy", fields: [createdById], references: [id], onDelete: Restrict)
  refundedAt  DateTime @default(now())
  createdAt   DateTime @default(now())

  @@index([workspaceId, refundedAt])
  @@index([workspaceId, createdById, refundedAt])
  @@index([subscriptionId])
  @@index([eventRegistrationId])
  @@index([paymentId])
}
```
- No new unique on an existing table (conventions §5). All new columns are nullable or defaulted.
- `refundedAmount` is a denormalized Σ of the sale's refunds, written in the refund's transaction.
  It keeps `mrr`, the journal row, the member card and the unmark guard to one column.

**Backfill** (`apps/server/scripts/`, registered in `deploy/update.sh` `migrations()` as `post`, each
with an «is anything left to do» check like `backfill-subscription-user.sql`; idempotent):
- `backfill-payment-journal.sql` (phase A):
  1. `paidAt = createdAt` for `isPaid` subscriptions with `paidAt IS NULL`. The journal orders by
     `paidAt`, and `paidOn()` (`revenue.ts:28-29`) already uses this date, so revenue doesn't move.
  2. `paymentMethod = 'ONLINE'` for `isPaid AND source = 'GATEWAY' AND paymentMethod IS NULL`. This is
     the serializer's fallback (`member-subscriptions/schemas.ts:149`) made explicit.
  3. `markedPaidById` for manual paid subscriptions still `NULL`:
     - source: the `actorId` of the nearest `AuditEvent` with the same `workspaceId` and
       `targetId = userId::text`;
     - action `member.markSubscriptionPaid`, or `member.assignSubscription` with
       `metadata->>'paid' = 'true'`;
     - `createdAt` within `[paidAt − 5 s, paidAt + 60 s]`;
     - no match → stays `NULL` («не указано»).
- `backfill-refunds.sql` (phase B):
  1. `Payment.refundedAmount = amount` where `status = 'REFUNDED'`.
  2. For each `REFUNDED` payment with `subscriptionId`, insert a `Refund`:
     - method `ONLINE`, `amount`, `refundedAt = Payment.refundedAt`, `itemName = planName`;
     - reason «Возврат до журнала платежей»;
     - `createdById` = `actorId` of the `payment.refund` audit entry with
       `metadata->>'paymentId' = id`, else the workspace owner.
     Then add the amount to that subscription's `refundedAmount`. This corrects today's overstated revenue.
  3. Refunded **tickets** get no `Refund` row: the old handler already unmarked them, so they are
     neither revenue nor a sale any more.

## 3. Server

### 3.1 Journal (phase A) — `features/payment-journal/`

`domains/payments/journal.ts` (pure where-builders + loaders, unit-tested). Reads:
- sales: subscriptions `where { workspaceId, isPaid: true, paidAt: range }`; tickets
  `ticketsPaidInRangeWhere(range)` (`revenue.ts:45-48`);
- refunds of sales (phase B): `where { workspaceId, refundedAt: range, OR: [{ subscriptionId: { not: null } }, { eventRegistrationId: { not: null } }] }`.

Filters apply to every source:
- `method`: refund rows filter on `Refund.method`; `NONE` = `paymentMethod IS NULL`;
- `markedById`: payments on `markedPaidById`, refunds on `createdById`;
- scope: members of the matching groups via `resolveAnalyticsScope` + `analyticsScopeMemberWhere`, the
  «Продлить» convention (wave 3, B3). A foreign id → 404. Former members drop out under a scope filter;
- `q`: `domains/users/user-search.ts` on the holder.

Merge: each source `findMany` ordered `(at desc, id desc)` with `take = curPage × perPage`, merge, slice
the page. `curPage × perPage > 5000` → 400 «Слишком далеко — сузьте период или фильтры». `total` = Σ
source counts. Totals: `groupBy` per source on `(paymentMethod | method, currency)` with `_sum`/`_count`
over the same filters (not the page).

| Endpoint | Method name | Tier (`@Roles` + handler) | DTOs |
|---|---|---|---|
| `GET workspaces/:workspaceId/payment-journal` | `listPaymentJournal` | `CLUB_ADMINS` + `assertClubAdmin` | in `ListPaymentJournalQuery`, out `ListPaymentJournalOutput` |
| `GET workspaces/:workspaceId/payment-journal/:entryId` | `getPaymentJournalEntry` | `CLUB_ADMINS` + `assertClubAdmin` | out `PaymentJournalEntryDetailOutput` |

`ListPaymentJournalQuery`:
- `from`, `to`: `z.iso.date()`, club-local days, inclusive. Both or neither; `to ≥ from`; ≤ 366 days.
  **Neither = the `revenue_30d` window** (`revenueWindowStart(now)` … now, `revenue.ts:301`). Local days
  convert with `wallClockToUtc` + the workspace time zone.
- `method?`: `CASH | TRANSFER | CARD | ONLINE | NONE`.
- `kind?`: `all | payment | refund` (default `all`).
- `markedById?`: uuid.
- `gymId? directionId? groupId? coachId?`: uuid.
- `q?`: ≤ 100 characters.
- `curPage` (default 1), `perPage` (default 50, max 200).

`ListPaymentJournalOutput`:
- `data: PaymentJournalEntry[]`, `total`, `curPage`, `perPage`.
- `totals: [{ currency, received, refunded, net, byMethod: [{ method: CASH|TRANSFER|CARD|ONLINE|NONE, received, refunded, count }] }]`.
  The dominant currency comes first (`dominantCurrency`, `revenue.ts:106-119`). Methods with nothing
  are omitted.
- `unapplied: { total, data: PaymentJournalUnapplied[] } | null`. Only on `curPage = 1`, over the whole
  club regardless of filters (it is an alert). `data` caps at 20, oldest first. An item =
  `{ paymentId, at, member { userId, name }, itemName, amount, refundable, currency, provider, activationError }`.

`PaymentJournalEntry`: flat, no union, `kind` enum.

| Field | Content |
|---|---|
| `id` | `sub:<uuid>` / `reg:<uuid>` / `ref:<uuid>` (also the deep-link and detail key) |
| `kind`, `source` | `payment\|refund` · `abonement\|ticket` |
| `at` | `paidAt` / `refundedAt` |
| `amount`, `currency`, `method` | positive amount; the client draws refunds as «−»; method nullable = «Не указан» |
| `member` | `{ userId: uuid\|null, name, isMember }` (former members render as plain text, no link) |
| `itemName` | tariff name / event title (refund: snapshot) |
| `subscriptionId`, `eventRegistrationId`, `eventId` | nullable |
| `markedBy` | `{ userId, name } \| null` (payment: who marked; refund: who refunded; online sale: null) |
| `refundedAmount`, `refundable` | payment rows (phase A: 0 and `amount`); refund rows: 0 |
| `online` | `{ paymentId, provider, providerRef (last 6 chars), status } \| null` |
| `reason` | refund rows only |
| `refundOf` | refund rows: `{ id, at, amount }` of the sale |

`PaymentJournalEntryDetailOutput` = entry + `refunds: PaymentJournalEntry[]` (the sale's refunds,
newest first) + `memberHasCard: boolean`.

### 3.2 Refunds (phase B) — `features/refunds/` + `domains/payments/services/refund.service.ts`

| Endpoint | Method name | Tier | DTOs | Audit |
|---|---|---|---|---|
| `POST workspaces/:workspaceId/refunds` | `createRefund` | `CLUB_ADMINS` + `assertClubAdmin` | in `CreateRefundInput`, out `CreateRefundOutput` | `payment.refund` |
| `DELETE workspaces/:workspaceId/refunds/:refundId` | `deleteRefund` | `CLUB_ADMINS` + `assertClubAdmin` | out `DeleteRefundOutput` (`{ status: 'deleted' }`) | `payment.refundDelete` (new) |

`CreateRefundInput`: flat + `superRefine`, no union.

| Field | Rule |
|---|---|
| `target` | `abonement \| ticket \| unapplied` |
| `targetId` | uuid: subscription / registration / payment id |
| `amount` | int ≥ 1, ≤ 10 000 000 (the mark-paid bound) |
| `method` | `CASH \| TRANSFER \| CARD \| ONLINE` |
| `reason` | trimmed, 1–500 |

`CreateRefundOutput` = `{ refund: PaymentJournalEntry, sale: PaymentJournalEntryDetailOutput | null }`.

`RefundService.refund`, in order:
1. Load the target in the workspace (404 «Платёж не найден»). An abonement or ticket must be `isPaid`.
   Cancelled abonements are allowed (cancel, then refund). An unapplied target must be a `SUCCEEDED`
   payment with `activationError`.
2. Check the amount: `1 ≤ amount ≤ amountPaid − refundedAmount`, else 400 «Вернуть можно от 1 до
   N ₽». N is formatted in the sale's currency.
3. Check the method.
   - `ONLINE` needs the sale's online payment: abonement `Payment.subscriptionId = id`; ticket = the
     `SUCCEEDED` payment with this `eventRegistrationId` and no `activationError`. It also needs
     `amount ≤ payment.amount − payment.refundedAmount` and a connected provider equal to
     `payment.provider`. Refusal texts:
     - no online payment — «Эту оплату принимали не онлайн — выберите, как вернули деньги»;
     - provider off — the existing «Платёжная система … отключена…» (`refund-payment.handler.ts:67-72`).
   - `CASH/TRANSFER/CARD` are allowed for any sale: a club may hand back cash for an online payment.
     They are refused for `unapplied`.
4. Online only — call the provider:
   - `gateway.refund(creds, { …, amount, idempotenceKey: \`refund-${payment.id}-${payment.refundedAmount}-${amount}\` })`,
     the platform pattern (`platform-payments.service.ts:1296-1303`).
   - YooKassa with `receiptEnabled` and `amount < payment.amount`: send a `receipt` built by
     `buildYookassaReceipt` (`yookassa-api.ts:55-77`) for the refunded amount. The e-mail is
     `payment.receiptEmail ?? payer.email`; neither → 400 «Для частичного возврата нужен e-mail для
     чека — верните всю сумму или наличными».
   - Stripe: `buildStripeRefund` gains `amount` (minor units via `toMinorUnits`).
   - A refusal → the existing «Платёжная система не провела возврат…».
5. One `$transaction`:
   - sale `updateMany({ where: { id, refundedAmount: { lte: amountPaid − amount } }, data: { refundedAmount: { increment: amount } } })`.
     `amountPaid` is fixed while paid: unmark is refused once refunded (§3.3). Count 0 → 409
     «Возврат по этой оплате уже записан — обновите страницу».
   - Online: `payment.updateMany({ where: { id, refundedAmount: old }, data: { refundedAmount: old + amount, status: full ? 'REFUNDED' : 'SUCCEEDED', refundedAt: now } })`.
   - Insert the `Refund`.
   - **A full refund of a ticket for an event that has not started** cancels the registration through a
     new `EventRegistrationService.cancelByClubInTx`. It shares `cancelOwn`'s promotion of the waitlist;
     the push after commit says «Клуб отменил вашу запись и вернул деньги». The paid cancelled row stays
     the money's record (`schema.prisma:1015`). A partial refund, or one after the start, keeps the place.
   - **An abonement is never changed by a refund**, as today (`refund-payment.handler.ts:24-29`).
     Cancelling it stays a separate action on the member card.
6. Audit `payment.refund`, metadata `{ refundId, target, targetId, amount, currency, method, reason,
   paymentId?, provider?, registrationCancelled? }`.
7. Notify the holder: kind `payment.refunded`, topic «Возврат денег», message «Клуб «X» вернул N ₽ за
   «item» — наличными / переводом / на карту». Add `payment.` to `EXEMPT_PREFIXES`
   (`domains/notifications/notification-mute.ts:7-14`): money notices must not go quiet, and
   `payment.succeeded` joins them.
8. Realtime `payments` + `members`, `subscription` (abonement) or `events`, `eventregistrations`
   (ticket).

`deleteRefund`:
- An online refund → 400 «Онлайн-возврат отменить нельзя — деньги уже ушли».
- Otherwise one transaction: delete, then decrement the sale's `refundedAmount`
  (`updateMany where refundedAmount ≥ amount`).
- Audit `payment.refundDelete` with the deleted row's fields.
- A registration cancelled by the refund is not restored. Online refunds never get here, and an
  offline refund doesn't cancel.

### 3.3 Changes to existing writers

- `SubscriptionService.create` (`subscription.service.ts:228-237`) takes `markedPaidById` (the actor) for
  a manual paid sale; `markPaid` (`:299-361`) sets it; `unmarkPaid` (`:366-402`) clears it. Every
  `isPaid = true` writer also sets `paidAt`: assign, mark, online activation, club import and the demo
  generators (`domains/demo/*`). A spec greps the writers, as the tier specs do.
- `member.markSubscriptionPaid` / `member.assignSubscription` audit metadata gain `subscriptionId` and
  `method`.
- **Unmark guards** (phase B), in `SubscriptionService.unmarkPaid` and
  `unmark-event-registration-paid.handler.ts`:
  - `refundedAmount > 0` → 400 «По этой оплате есть возврат — сначала удалите запись о возврате»;
  - `paymentMethod = 'ONLINE'` → 400 «Онлайн-оплату отменяют возвратом в «Платежах»». Unmarking an
    online sale would orphan its `Payment`.
- Every write that adds, changes or removes a journal row emits realtime `payments`: mark/unmark (both
  kinds), assign as paid, online activation, refund create/delete.
- `create-payment.handler.ts:133` and `pay-event-registration-online.handler.ts:156` store
  `receiptEmail` (phase B).
- `event-registrations` `paid: { count, amount }` (`list-event-registrations.handler.ts:54-76`) sums net
  amounts (`amountPaid − refundedAmount`). The registrant DTO gains `refundedAmount`.
- `member-subscriptions/schemas.ts` (staff and member abonement DTO) gains `refundedAmount`.

### 3.4 Revenue and the glossary (phase B)

`domains/metrics/revenue.ts`:
- `ActiveSubRow` gains `refundedAmount`. `monthlyEquivalent` uses `amountPaid − refundedAmount`, so a
  fully refunded abonement adds 0 to `mrr`. `loadCurrentSales` selects it.
- New `refundsInRangeWhere(range)` and `loadRefunds(prisma, workspaceId, since)`: sale-linked refunds
  as rows `{ amount, currency, refundedAt, planId|eventId, planName }`.
- `computeRevenue(current, recent30, refunds30)` returns `revenue30d` = sales − refunds (dominant
  currency) and `refunded30d`. `get-workspace-stats.handler.ts:175-201` passes refunds for 30 days, the
  previous 30 (`revenuePrev30d`) and today.
- The tariff page (`manage-plans/get-plan.handler.ts:97,123`) «last 30 days revenue» = this tariff's
  sales in the window − refunds of its abonements in the window.
- The analytics snapshot's `monthlySpend` (`analytics-snapshot.service.ts:324,455,483,575,597`) uses net
  amounts, so `money_at_stake` follows.
- The forecast's `mrr` follows through `loadCurrentSales`.

Glossary rows to replace or add in the parent spec's B2 table **in the phase-B PR**:

| Metric id | Russian label | Definition | Server function | Shown on |
|---|---|---|---|---|
| `revenue_30d` | «Выручка за 30 дней» | `payments_received` − `refunds` over the trailing 30 days; compared with the 30 days before (`revenuePrev30d`, same rule) | `computeRevenue` over `loadSales` + `loadRefunds` | dashboard «Деньги», AI `club_overview`, «Платежи» default «Итого» |
| `revenue_today` | «Выручка сегодня» | the same since the club-local midnight | `sumRevenue` over `loadSales` + `loadRefunds` | stats API |
| `payments_received` | «Получено» | paid sales by payment date: abonements (former members' too) + event tickets | `loadSales`, `journal.ts` | «Платежи» summary, CSV |
| `refunds` | «Возвращено» | refunds of those sales by refund date (unapplied online payments' refunds excluded) | `loadRefunds`, `journal.ts` | «Платежи» summary, CSV, AI `revenue_report` |
| `mrr` | «Регулярный доход в месяц» | as now, each abonement's `(amountPaid − refundedAmount) × 30 / term days` | `computeRevenue` | unchanged |
| `money_at_stake` | unchanged | `monthlySpend` over net amounts | unchanged | unchanged |

The dashboard subtitle becomes «фактически оплачено за последние 30 дней за вычетом возвратов».

### 3.5 Removed (clean cutover)

- Phase A: `GET workspaces/:id/payments` (`ListPayments*`, `list-payments.*`, `paymentListInclude` moves
  into the refund handler until phase B). It has no caller after the admin switches (only
  `apps/admin/src/shared/api/payments.ts`).
- Phase B: `POST payments/:paymentId/refund` and `RefundPayment*`.
- Unchanged: `POST payments` (checkout), `GET online-purchase`, `GET payments/:paymentId` (buyer's own),
  the webhooks.
- `shared/access/route-tier-consistency.spec.ts` (`CLUB_ADMINS` list):
  - remove `GET payments` and `POST payments/:paymentId/refund`;
  - add `GET payment-journal`, `GET payment-journal/:entryId`, `POST refunds`, `DELETE refunds/:refundId`;
  - replace `GET exports/revenue.csv` with `GET exports/payments.csv`.

## 4. Admin UI

**Where.** «Деньги → Абонементы → Платежи», same route `subscriptions/payments`, same tab label (the IA
promised «Платежи (сейчас — онлайн-платежи; общий журнал — бэклог E1)»). It replaces
`features/payments/PaymentsList.tsx`, giving one place for the job. `ClubAdminGate` stays
(`subscriptions/layout.tsx`).

**Job.** «владелец / администратор · вечером или в конце месяца · сверить, сколько пришло и каким
способом, найти оплату ученика, вернуть деньги».

**Layout** (`features/payments/PaymentJournal.tsx`, own fetch):
1. `SectionTabs` «Абонементы» (Тарифы · Платежи).
2. One control row:
   - period select: «За 30 дней» (default, no `from/to`) · «Этот месяц» · «Прошлый месяц» ·
     «Выбрать даты…» (two date inputs);
   - «Способ» select (Все · Наличные · Перевод · Карта в клубе · Онлайн · Не указан);
   - member search;
   - «Фильтры» button with the count of active ones. It opens a side panel with `AnalyticsFilters`
     (`app/…/analytics/analytics-toolbar`: зал, направление, группа, тренер), «Отметил» (staff picker,
     `listAllStaffMembers`) and «Показывать» (Оплаты и возвраты · Только оплаты · Только возвраты).
   - At the right: «Скачать CSV» (outline). No filled button on the page.
   - The URL holds the state (`?from=&to=&method=&q=&…`), so a link reproduces the view.
3. Summary, one block:
   - line 1: «Получено 412 000 ₽ · возвращено 6 000 ₽ · **итого 406 000 ₽**»;
   - line 2 (muted, only methods with money): «Наличные 120 000 ₽ · Перевод 80 000 ₽ · Карта в клубе
     40 000 ₽ · Онлайн 166 000 ₽». Each method shows its net; refunds sit in line 1.
   - A second currency adds one more line 1 for it. No chips.
4. «Оплачено онлайн, но не зачислено · N» — only while `unapplied.total > 0`. Rows: date · name ·
   item · amount · the `activationError` text; tap → panel with «Вернуть деньги» (phase A: full
   refund through the existing endpoint; phase B: the refund form, online only).
5. List (table on desktop):
   - date and time (club-local, «3 нояб., 18:40»);
   - name, with a second line «Абонемент «БЖЖ 12»» / «Событие «Семинар по гвардам»»;
   - method text;
   - «Отметил» name (or «—»);
   - amount, right-aligned.
   - A refund row: amount «−1 000 ₽» in `destructive`, second line «Возврат · {reason}».
   - A partially refunded payment: muted second line under the amount «возвращено 1 000 ₽».
   - No buttons; the whole row opens the panel. «Показать ещё» pages.
   - Empty after a successful load: «За этот период оплат нет». With filters: «Ничего не нашлось —
     измените фильтры». The empty state never flashes while loading.
6. Realtime: `useWorkspaceRealtime(workspaceId, ["payments"])` reloads the shown pages.

**Entry panel** (`features/payments/PaymentEntrySheet.tsx`, side panel; `?entry=sub:<id>` opens it):
- Title «Оплата 4 000 ₽» / «Возврат 1 000 ₽».
- Facts, each only when known: ученик (link to `users/<userId>` when `memberHasCard`), за что, когда,
  способ, отметил, online (provider name, «№ …ab12cd», status).
- Refunds of this payment: date · amount · method · who · reason. An offline one has «⋯ → Удалить
  запись о возврате» (`confirmDialog`, destructive: «Удалить запись о возврате 1 000 ₽?» ·
  «Сумма снова войдёт в выручку.»). A «⋯» with one item is the exception the wave-5 decision made for
  a lone action in a detail panel; here it keeps a destructive action off the row.
- Phase B: «Вернуть деньги» (outline, only while `refundable > 0`) swaps the panel body for the refund
  form (no panel on a panel):
  - «Сумма»: prefilled with `refundable`; limits from `FORM_LIMITS.refund.amount`;
  - «Как вернули»: for a sale with a refundable online payment «На карту через ЮKassa/Stripe» (default)
    + Наличные / Перевод / Карта в клубе; for an offline sale the three offline methods, default =
    the sale's method;
  - «Причина», required (`FORM_LIMITS.refund.reason`);
  - one hint line, only when true: «Абонемент останется действующим — отменить его можно в карточке
    ученика» (abonement) / «Запись на событие будет отменена, место перейдёт следующему в листе
    ожидания» (full refund of an upcoming ticket);
  - footer: «Вернуть N ₽» (destructive, the panel's one filled button) · «Отмена» (dirty guard);
  - an online refund asks `confirmDialog`: «Вернуть N ₽ на карту?» · «Деньги вернутся тем же
    способом, которым платил участник. Отменить возврат будет нельзя.» An offline record doesn't ask:
    it can be deleted.
  - A 409 reloads the entry and shows «Данные изменились — проверьте сумму».

**Elsewhere.**
- Member card (`features/subscriptions/subscription-display.ts:65-73` `paymentLabel`) appends
  « · возвращено N ₽». For club admins the payment line links to `subscriptions/payments?entry=sub:<id>`.
  «Отменить отметку оплаты» (`MemberSubscriptionPanel.tsx:202-215,292,499`) hides when
  `refundedAmount > 0` or the method is online.
- `EventRegistrationsPanel.tsx`:
  - the registrant line appends «возвращено N ₽»;
  - the online-refund note (`:49-52`) points to «Абонементы → Платежи»;
  - unmark hides on the same two conditions.
- «Сегодня» «Выручка за 30 дней» (club admins) links to `subscriptions/payments`, the same window.
- «Отчёты → Выгрузка»: the «Выручка» card becomes «Платежи и возвраты» on `payments.csv` (§7).
- `features/audit/audit-meta.ts`: `payment.refund` «Возврат денег» (labels for method, amount, reason),
  `payment.refundDelete` «Запись о возврате удалена», `export.payments` «Выгрузка платежей» (old
  `export.revenue` keeps its label).
- `shared/lib/contract-limits.ts`: `refund.amount`, `refund.reason` from `CreateRefundInput`.

**Head coach / coaches:** no change (no journal, no refunds; they mark payments as before).

## 5. Mobile / client

- **Members.**
  - «Мой абонемент» payment line (`features/subscription/MySubscriptionScreen.tsx:269-273`) appends
    «возвращено N ₽» from `refundedAmount`.
  - A fully refunded upcoming ticket arrives as a cancelled registration. Existing copy covers it, and
    the push explains why.
  - New notification route: `payment.refunded` → `MySubscription` (abonement) / `Events` (ticket)
    (`features/notifications/notification-route.ts`).
  - No payment-history screen and no receipts. The online receipt is e-mailed by ЮKassa; cash receipts
    are the club register's duty (offer §: `apps/client/src/app/legal/offer/offer-2026-11-01.tsx:169-197`).
- **Coach screen** `CoachMemberSubscriptionScreen.tsx:534` appends «возвращено N ₽». It already shows
  `amountPaid` to the coach who sells.
- Client web: none.

## 6. MCP / AI

- `revenue_report` (`features/mcp/tools/money-tools.ts:41-165`, `adminOnly`) duplicates the loaders.
  - Add sale-linked refunds as negative rows, keyed like their sale (tariff / event / direction share),
    dated by `refundedAt`.
  - Output gains `received` and `refunded`; `total` = net.
  - The description says «за вычетом возвратов».
  - Update `docs/mcp.md`.
- `club_overview` follows `computeRevenue`. `abonement_states` (`:281-384`) adds `refunded` where it
  shows `amount` (`scope.seesMoney`).
- No new tool. A journal tool has no requester; the AI answers revenue questions already.

## 7. CSV

`GET workspaces/:id/exports/payments.csv` (`CLUB_ADMINS`, audited `export.payments`) replaces
`revenue.csv` (`export.controller.ts:140-158`). `ExportService.paymentsCsv` replaces `revenueCsv`
(`export.service.ts:195-279`) and reads `journal.ts` with the journal's filters: the journal button
passes them all; «Выгрузка» passes the period.
- Columns (`toCsv`, `;`): Дата · Вид (Оплата / Возврат) · Участник · Email · Тариф / событие · Сумма
  (refunds negative) · Валюта · Способ оплаты · Отметил / вернул · Причина возврата · Источник
  (Абонемент / Событие) · Занятий в пакете.
- Sorted like the journal. File name `payments-<from>_<to>.csv`.
- The admin `ExportKind` `revenue` → `payments`.

## 8. Tests

Server unit (Prisma mocked, conventions §1 «every handler»):
- `domains/payments/journal.spec.ts`:
  - merge order across sources and page slicing;
  - totals per method and currency;
  - `NONE`;
  - refunds counted as refunded, not received;
  - unapplied payments excluded from rows and totals;
  - the 5000 cap.
- `list-payment-journal.handler.spec.ts` and `get-payment-journal-entry.handler.spec.ts`:
  - head coach, coach and direction manager → 403; owner bypass;
  - foreign `groupId` → 404;
  - `from/to` validation;
  - no dates = the `revenue_30d` window.
- `create-refund.handler.spec.ts`:
  - 403 below club admin;
  - over-refund 400; offline on unapplied 400; online without an online payment 400;
  - YooKassa partial with receipt and full without; missing e-mail 400; Stripe `amount`;
  - CAS conflict 409;
  - full upcoming ticket cancels, past or partial doesn't; abonement untouched;
  - audit, notify, realtime.
- `delete-refund.handler.spec.ts`: online 400; decrement.
- `revenue.spec.ts`: net `revenue30d`, `revenuePrev30d`, `mrr` with refunds; unapplied refunds ignored.
- `subscription.service` and unmark specs: `markedPaidById`; unmark refused when refunded or online.
- `yookassa-api.spec.ts` / `stripe-api.spec.ts`: refund bodies.
- `money-tools.spec.ts`: `refunded`.
- `export.service.spec.ts`: rows.
- `notification-mute` spec: `payment.` exempt.

Server e2e (`apps/server-e2e/src/payments/`):
- `payment-journal.e2e-spec.ts`:
  - cash, transfer and online sales plus a ticket;
  - journal rows and totals;
  - default-period «Итого» = `GET …/stats` `revenue.revenue30d`;
  - filters by method and by marker;
  - head coach 403;
  - CSV equals rows.
- `refunds.e2e-spec.ts`:
  - partial cash refund lowers `revenue30d`, `mrr` and the tariff page;
  - online partial and full through `FakeGateway`;
  - double-submit → one refund;
  - unmark refused;
  - delete restores revenue;
  - full ticket refund frees the place to the waitlist.
- Update `analytics/metric-glossary.e2e-spec.ts` (one refund: every revenue surface net),
  `online-payment.e2e-spec.ts` and `event-ticket-online-payment.e2e-spec.ts` (refund via
  `POST refunds`; ticket stays paid with `refundedAmount`, or cancelled when full and upcoming),
  `event-ticket-revenue.e2e-spec.ts` (`payments.csv`), `demo/demo-kit.e2e-spec.ts` if demo money changes.

Admin:
- `features/payments/journal-view.spec.ts`: period presets → `from/to`, summary lines, plurals,
  method labels, amount signs, `refundable`.
- `contract-limits.spec.ts` picks up `refund.*`.
- Render spec of `PaymentEntrySheet`: refund button only when refundable; online confirm asks.
- Smoke (`apps/admin-e2e`): `subscriptions/payments` is already in `CLUB_ADMIN_ONLY`; no matrix change.
  The demo data now has rows (demo generators set `markedPaidById` and add one partial cash refund and
  one online refund), so the crawl checks a populated page for `NaN`/`undefined`.

Mobile: payment text helper spec (refunded line); `notification-route` spec for `payment.refunded`.

## 9. Rollout

- **Phase A PR** «Журнал платежей»:
  - `db push` (one column, one index);
  - post-migration `backfill-payment-journal.sql`;
  - contract regen;
  - CHANGELOG; `docs/demo.md` (the journal on the demo club).
  - No money figure changes.
- **Phase B PR** «Возвраты»:
  - `db push` (table + columns);
  - post-migration `backfill-refunds.sql`;
  - contract regen;
  - glossary rows into the parent spec B2;
  - `docs/mcp.md`; CHANGELOG.
  - The CHANGELOG says: revenue now subtracts refunds, so a club with refunded online abonements sees
    `revenue_30d`/`mrr` drop by those amounts; a full refund of an upcoming ticket cancels the place.
- Old code tolerates the new columns (defaults), so rollback = redeploy the previous image.
  `update.sh` rolls back on a failed smoke check. Each check SQL returns `f` once done.

## 10. Acceptance checklist

- [ ] Owner on demo ACADEMY: «Платежи» lists cash, transfer, in-club card and online abonement payments
      and event tickets in one list, newest first; the default «Итого» equals «Выручка за 30 дней» on
      «Сегодня».
- [ ] Filters period / method / «Отметил» / gym-direction-group-coach / search narrow rows and totals
      together; the URL reproduces the view.
- [ ] A coach's cash mark shows their name in «Отметил»; a backfilled legacy row shows a name or «—».
- [ ] CSV rows = list rows for the same filters; refunds negative.
- [ ] Head coach: no «Платежи» tab, `GET payment-journal` and `POST refunds` → 403.
- [ ] Partial cash refund of 1 000 ₽ on a 4 000 ₽ abonement: a −1 000 ₽ row, the payment row shows
      «возвращено 1 000 ₽», `revenue_30d`, `mrr`, the tariff page and CSV drop by it, and the member
      sees «возвращено 1 000 ₽» plus a push. Deleting the record restores every number.
- [ ] Online partial refund through YooKassa sends a receipt; a second click records nothing new;
      a full one sets the payment REFUNDED.
- [ ] Full refund of an upcoming ticket frees the place to the waitlist; the paid row stays in the journal.
- [ ] «Отменить отметку оплаты» is unavailable on a refunded or online-paid sale (UI hidden, API 400).
- [ ] An unapplied online payment shows in the strip and leaves it once refunded.
- [ ] tsc (server, admin, mobile), tests, contract drift, admin smoke for the four roles green.

## 11. Decisions

- **The journal replaces «Абонементы → Платежи»** (route and label kept). The online-only list, its
  status filter and its PENDING/CANCELED attempts go: abandoned checkouts aren't money. Paid-but-
  unapplied ones stay visible in the strip.
- **Journal rows are sales and their refunds, not `Payment` rows.** That keeps «Итого» = glossary
  revenue by construction. Online details hang off the sale (`online`).
- **No ledger table.** The journal is read from the sale rows that revenue already uses. A dual-written
  ledger would need every writer (mark, unmark, webhook, import, demo) kept in sync and could drift
  from revenue. Merge-and-slice pagination with the house `curPage/perPage/total` and a 5000-row depth
  cap is enough for clubs of ≤ 2 000 members (a year ≈ 30 000 sales; a month ≈ 2 500).
- **Default period = the `revenue_30d` window** (no dates), so the dashboard number and the journal agree.
  Calendar presets pass club-local dates.
- **Gym/direction/group/coach filter = the analytics scope** (members of the matching groups), as on
  «Продлить». An abonement isn't tied to a gym, and one rule beats a ticket-only gym filter.
- **`markedPaidById` on Subscription**, backfilled from the audit log by a ±time window. Unmatched rows
  stay «—». Forward audit metadata gains `subscriptionId`.
- **Legacy `paidAt` filled with `createdAt`** and `GATEWAY` rows get `paymentMethod = ONLINE`, so ordering
  and the method filter are plain columns. Revenue doesn't move.
- **Refund = its own table + a denormalized `refundedAmount`** on the sale (and on `Payment`). The
  refund-date rule puts a refund into the month it happened in; the denormalized sum keeps `mrr` and
  guards cheap.
- **A refund never edits the sale's paid fields.** Revenue subtracts refunds. The ticket «unmark on
  refund» behaviour ends: it hid the payment and the refund.
- **Full refund of an upcoming ticket cancels the registration.** Staff have no other way to free the
  place (`cancel-event-registration.handler.ts` is the member's own). A refunded place that stays booked
  could never be paid again, since one sale per registration. Partial refunds and past events keep the
  registration. **Abonements are never touched by a refund**, as before: partial use and goodwill
  refunds are common, and cancelling stays explicit on the card.
- **Offline refunds are records** (CASH/TRANSFER/CARD), deletable with audit. Online refunds are final.
  Offline methods are allowed for an online sale (cash handed back); online only where a refundable
  provider payment exists.
- **Partial online refunds:** YooKassa with a `receipt` when receipts are on (e-mail stored on the
  payment from now on, else the payer's current e-mail, else refuse partial). Stripe sends `amount`.
  Idempotence key per refund step, as the platform's.
- **Concurrency:** the sale's `refundedAmount` uses a bounded increment (`lte: amountPaid − amount`), so
  two different refunds that fit both succeed and an over-refund fails. `Payment.refundedAmount` uses
  an equality CAS under the provider's idempotence key.
- **Unmark is refused on refunded or online sales.** Otherwise a refund would point at an unpaid sale,
  or a `Payment` would lose its sale.
- **Visibility:** journal and refunds are `CLUB_ADMINS` only (§1 matrix). Members see their own
  `refundedAmount` on their abonement; the coach mobile screen sees it next to the `amountPaid` it
  already shows.
- **Grading fees stay out** (non-goal; no amount or method recorded, not revenue).
- **One CSV.** `payments.csv` replaces `revenue.csv`. The journal and «Выгрузка» call the same endpoint;
  «Выгрузка» stays the hub of all CSVs (wave 4).
- **Pre-journal refunded tickets get no refund row.** They were unmarked by the old handler, so they are
  already outside revenue and sales.

## 12. Implementation slices

Two PRs, phase A then phase B; each PR has parallel slices. The server slice commits its DTOs and
controllers first (contract regenerated) so the client slices typecheck against real types. Then
everyone works in parallel. Nobody runs the full gate mid-flight; the integrator runs it once.

**Phase A — «Журнал платежей» (S–M, ≈ 3 implementer-days)**

| Slice | Owns (only these files) | Size |
|---|---|---|
| A1 server | `apps/server/prisma/schema.prisma`; `apps/server/scripts/backfill-payment-journal.sql`; `deploy/update.sh` (`migrations()` line); `apps/server/src/domains/payments/journal.ts` (+spec); `features/payment-journal/**`; `features/member-subscriptions/{assign,mark,unmark}-subscription*`; `domains/subscriptions/services/subscription.service.ts`; `features/online-payments/{list-payments.*,payments.controller.ts,payments.handler.spec.ts}`; `features/data-export/**`; `features/club-import/**` (paidAt only); `domains/demo/*` (markedPaidById); `shared/access/route-tier-consistency.spec.ts`; `app/app.module.ts`; `apps/server-e2e/src/payments/payment-journal.e2e-spec.ts`, `event-ticket-revenue.e2e-spec.ts`; `open-api.json`; `libs/api-client/src/openapi/*` | M (≈ 2 d) |
| A2 admin | `apps/admin/src/features/payments/{PaymentJournal,PaymentEntrySheet,journal-view}*` (delete `PaymentsList.tsx`); `shared/api/payment-journal.ts`; `shared/api/payments.ts` (drop list); `shared/api/exports.ts`; `app/…/subscriptions/payments/page.tsx`; `app/…/analytics/export/page.tsx`; `features/subscriptions/subscription-display.ts` (entry link); `features/dashboard/*` money card link; `features/audit/audit-meta.ts` (`export.payments`) | S (≈ 1 d) |

**Phase B — «Возвраты» (M, ≈ 5 implementer-days)**

| Slice | Owns | Size |
|---|---|---|
| B1 server | schema (Refund, `refundedAmount` ×3, `receiptEmail`); `scripts/backfill-refunds.sql` + `migrations()`; `features/refunds/**`; `domains/payments/services/refund.service.ts`; `domains/payments/{yookassa-api,stripe-api,payment-gateway.client}.ts` (+specs); delete `features/online-payments/refund-payment.*`; `create-payment.handler.ts`, `pay-event-registration-online.handler.ts` (receiptEmail); `domains/event-registrations/event-registration.service.ts` (`cancelByClubInTx`); `features/event-registrations/{unmark-event-registration-paid,list-event-registrations}*` + `schemas.ts`; `features/member-subscriptions/schemas.ts`; `domains/metrics/revenue.ts` (+spec); `features/get-workspace-stats/**`; `features/manage-plans/get-plan.handler.ts`; `domains/analytics/analytics-snapshot.service.ts`; `features/mcp/tools/money-tools.ts` (+spec), `docs/mcp.md`; `features/data-export/**`; `domains/notifications/notification-mute.ts`; `domains/audit/services/audit.service.ts` (action union); `domains/demo/*` (+ `demo-club.wipe.ts` deletes refunds first); `route-tier-consistency.spec.ts`; `app.module.ts`; server-e2e specs listed in §8; contract files; parent spec B2 glossary rows | M (≈ 3 d) |
| B2 admin | `features/payments/{RefundForm,PaymentEntrySheet,PaymentJournal,journal-view}*`; `shared/api/payment-journal.ts` (refund calls); `shared/lib/contract-limits.ts`; `features/subscriptions/{MemberSubscriptionPanel,subscription-display}*`; `features/events/EventRegistrationsPanel.tsx`; `features/audit/audit-meta.ts`; dashboard money subtitle | S–M (≈ 1.5 d) |
| B3 mobile | `apps/mobile/src/features/subscription/{MySubscriptionScreen,CoachMemberSubscriptionScreen}.tsx` + the payment text helper; `features/notifications/notification-route.ts` (+spec) | S (≈ 0.5 d) |

Checks for the integrator: tsc server / admin / mobile; `npx nx test @clubspace/server -- payment-journal`,
`-- refund`, `-- revenue`, `-- money-tools`, `-- export`; admin and mobile tests; server e2e
`payments/*`, `analytics/metric-glossary`; contract drift; `npm run test:admin-e2e` for the four roles;
`cs-reviewer` before merge.

## 13. Open risks

- **Backfill attribution** of `markedPaidById` is heuristic (time window). A coach marking two
  abonements of one member within a minute is attributed by the nearest timestamp; unmatched rows show «—».
- **Receipt e-mail for partial online refunds** of payments made before phase B falls back to the
  payer's *current* e-mail. If a dependent has none, partial online refund is refused (full or offline
  still works).
- **Platform refunds (club → ClubSpace)** also send partial amounts with no `receipt`
  (`platform-payments.service.ts:1296-1303` → the same `buildYookassaRefund`). ЮKassa requires one when
  «Чеки от ЮKassa» are on. [INFERENCE] the platform console's partial refunds may be refused or
  unreceipted. Outside E1; flagged for the owner.
- **Revenue drops** after phase B for clubs with refunded online abonements (a correction). The owner
  should read the CHANGELOG line before clubs notice.
- **Deep pages:** the journal refuses beyond 5000 rows of depth. Long periods need filters or CSV.
- **Mixed currencies:** totals are per currency; revenue elsewhere stays dominant-currency only, as today.
- **Unapplied payments:** the strip can only refund. Granting the abonement by hand still means
  assigning it as paid by an offline method, which records a wrong method. This already happens
  today and is unchanged.
