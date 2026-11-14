# Discounts, promo codes and the family discount (backlog E3)

Status: **design** · 2026-11-15 · base: `feat/payments-journal` @ `7b41e414`
Parent: [admin cleanup](2026-11-08-admin-cleanup.md) §9 E3 (owner: «стартуй разработку», order
E1 → E6 → E3 → E2). Evidence: [UX audit](2026-11-08-admin-audit-ux.md) §5 row «Скидки, промокоды,
семейные» (`2026-11-08-admin-audit-ux.md:193`); [stability audit](2026-11-08-admin-audit-stability.md)
«Depth» (`2026-11-08-admin-audit-stability.md:177`). Siblings: [payments journal](2026-11-15-payments-journal.md)
(E1; this design keeps its money rule, `Refund` model and revenue formula), [requests inbox](2026-11-15-requests-inbox.md)
(E6). E2 (member autopay) reads the pricing contract in §3.1. File:line references are as of `7b41e414`.
The owner was asleep while this was written. Every choice the owner would normally make is listed in
§12 «Decisions» and may be overruled. One question is left for the owner: §15.

## Кратко (для владельца)

Сейчас скидок в системе нет. Тренер или администратор при продаже абонемента просто вписывает
другую сумму. Почему сумма меньше, кто так решил и сколько клуб отдал скидками за месяц, узнать
нельзя. Промокодов нет, семейной скидки нет. А демо-объявление обещает «Скидку 5% при продлении»,
которую приложение дать не может.

Что сделаем:
1. **Вкладка «Скидки»** в «Деньги → Абонементы» (Тарифы · Скидки · Платежи). Владелец или
   администратор заводит скидку: название, процент или сумма в рублях, на какие тарифы и действует ли
   она на события, срок действия, сколько раз её можно использовать всего и можно ли одному ученику
   больше одного раза. Скидка бывает трёх видов:
   - **по решению сотрудника** («Студенческая −15%»): её выбирают при продаже в клубе;
   - **с промокодом** («ВЕСНА»): ученик вводит код при оплате в приложении, или его называют на
     ресепшене;
   - **семейная**: включается сама, если у родителя, ребёнка, брата или сестры ученика уже есть
     действующий абонемент. Семью мы определяем по связям «родитель — ребёнок», которые уже есть в
     системе.
2. **При продаже в клубе** в форме появляется поле «Скидка». Список готовых скидок доступен всем, кто
   продаёт: тренеру, главному тренеру, администратору. **Вписать свою сумму можно, как и сейчас** —
   например, если ученик заплатил наличными часть. Но теперь каждая такая сумма видна: система
   запоминает цену по тарифу, и в «Платежах» и в карточке ученика появляется «Разовая скидка 1 000 ₽ ·
   Петров». На вкладке «Скидки» видно, кто из сотрудников сколько скидок дал за период. Стоит ли
   оставить право вписывать сумму только администраторам — вопрос к вам (раздел 15).
3. **В приложении** у тарифа сразу видна цена с семейной скидкой. Есть строка «Есть промокод?». Перед
   оплатой ученик видит итоговую сумму и название скидки. Чек ЮKassa выбивается на сумму со скидкой.
4. **В «Платежах»** у каждой оплаты видны цена по тарифу и скидка. Сверху показано, на сколько
   рублей дали скидок за период. Есть фильтр «Со скидкой», и скидки попадают в CSV. В истории
   изменений видно, кто какую скидку дал.

Выручка считается, как и раньше, по фактически полученным деньгам, то есть уже за вычетом скидки.
Скидка никогда не вычитается второй раз.

## Problem

1. **No discount concept; staff type a lower amount instead.**
   - `Plan` has only `price` (`schema.prisma:2119-2170`, field `:2126`).
   - An abonement sale takes a free `amountPaid` «e.g. a discount or comped abonement»
     (`assign-subscription.feature.ts:12-14`). Every coaching role may send it: the route is
     `COACHING_ROLES` (`member-subscriptions.controller.ts:103-104`). The handler limits coaches on
     archived tariffs and start dates (`assign-subscription.handler.ts:107-141`), but not on the amount.
   - Mark-paid takes any `amount` «what was actually received» (`mark-subscription-paid.feature.ts:7-8`;
     `MarkPaidForm.tsx:20-24`: «change it for a discount or a part-payment»).
   - The admin sale form prefills the tariff price, and the field is free
     (`MemberSubscriptionPanel.tsx:91-92,119-126`). The coach's mobile screen does the same
     (`CoachMemberSubscriptionScreen.tsx:230-233,345-366`).
   - Q1 says the head coach handles «no prices» (`2026-11-08-admin-cleanup.md:1025-1026,1032-1034`).
     Today the head coach and every coach still set prices through the amount field.
2. **A discount leaves no trace.**
   - The only record is `listPrice` in the `member.assignSubscription` audit metadata
     (`assign-subscription.handler.ts:170-171`).
   - Mark-paid records nothing about the price.
   - The sale row keeps only the final amount (`Subscription.amountPaid`, `schema.prisma:1995-1998`).
   - So nobody can say «сколько отдали скидками», which discount was used, or who gave it.
3. **Online and event prices are fixed.**
   - Checkout takes only `planId` (`create-payment.feature.ts:5-7`) and charges `plan.price`
     (`create-payment.handler.ts:129`). The amount is «taken from the server's records, never the
     client» (`start-provider-payment.ts:39-40`).
   - A ticket is marked paid at `event.price` with no override (`mark-event-registration-paid.handler.ts:106`,
     input `mark-event-registration-paid.feature.ts:6-10`). It is paid online at `event.price`
     (`pay-event-registration-online.handler.ts:88,152`).
   - The webhook grants the abonement or ticket at `payment.amount`
     (`payment-activation.service.ts:135-140,246-258`).
   - A promo code has nowhere to go.
4. **The demo promises what the product can't do.** «Скидка 5% при продлении в день окончания»
   (`domains/demo/demo-club.plan.ts:2101`).
5. **Family pricing is impossible**, although the family graph exists:
   - `Guardianship` links a guardian and a dependent, with `consentAt` once confirmed
     (`schema.prisma:3411-3444`).
   - Act-as and notifications use only confirmed links.
   - No price rule reads it.

## Goal / non-goals

**Goal.** A club admin defines a discount once: a percent or a fixed sum, for given tariffs and/or
events, with dates and limits. It is applied in four places:
- a staff sale (abonement or ticket);
- the member's online checkout, by promo code;
- automatically for families;
- an E2 autopay renewal (family only).

Every sale records its list price and its discount. The journal, CSV, audit and AI report show how much
was given, which discount and by whom. Revenue keeps meaning «money actually charged».

**Non-goals.**
- Stacking several discounts on one sale. One sale has at most one named discount (§1).
- Tiered family pricing (2nd child −10%, 3rd −20%), referral programs, gift certificates, loyalty
  points, bonus classes.
- Other automatic rules: birthday, «renew on the expiry day», early bird. The demo promise becomes a promo
  code (§9).
- Choosing single events for a discount. The scope is «all paid events» or none.
- A member-facing list of available promo codes or discount advertising. Announcements stay free text.
- Debt / part-payment tracking (an unpaid remainder). Today it is lost silently. This design doesn't add it.
- Platform money (club → ClubSpace). It already has its own discounts and promos
  (`domains/billing/quote-workspace-billing.ts:192-233`, `platform-billing-utils.ts:224-230`). Untouched.
- A «скидка» line on fiscal receipts. Not required (§3.6). Offline receipts stay the club register's duty,
  as in E1.
- Online **abonement** purchase for a child profile. It is still refused (`create-payment.handler.ts:112-119`).
  When it arrives, the family rule applies to it unchanged. A guardian can already pay a child's **ticket**
  online (receipt to the guardian, `pay-event-registration-online.handler.ts:126-141`). That checkout gets
  the family rule when the family discount covers events.

## Ground rules

As in the [parent spec](2026-11-08-admin-cleanup.md#ground-rules-for-the-implementer) and E1:
- `CLAUDE.md` + `docs/conventions.md` are authoritative.
- `prisma db push` only, additive, no `--accept-data-loss`.
- Authorize in the handler.
- `serialize*` DTOs; unique controller-method and DTO names; no `discriminatedUnion` (flat + `superRefine`).
- Regenerate the contract.
- Follow the UI rules.
- Discount definitions are club money → `CLUB_ADMINS`, like tariffs (`2026-11-08-admin-cleanup.md:131-135`).
  Selling stays where Q1 put it (`COACHING_ROLES`).

## 1. The price rule

- A **sale** (E1 §1) records three facts at the moment it is priced:
  - **`listPrice`**: the tariff's or event's price then;
  - **the named discount**: `discountId`, `discountName` snapshot and `discountAmount`, fixed at that moment;
  - **`amountPaid`**: the agreed amount while unpaid, the amount received once paid, as today
    (`schema.prisma:1995-1996`).
- **Total discount of a sale** = `max(0, listPrice − amountPaid)`. Of that:
  - the named part is `discountAmount`;
  - the rest is a **one-off reduction** («разовая скидка»): an amount typed by whoever sold or marked
    the payment (today's rule, unchanged: every coaching role), at the sale or at mark-paid.
  - It is derived, never stored, so it can't drift from `amountPaid`.
- **Revenue is unchanged:** paid sales' `amountPaid` − refunds (E1 §1). A discount already lowered
  `amountPaid`, so it is never subtracted again. The glossary gets a separate read-only metric,
  `discounts_given` (§3.5).
- **Refunds** (E1 §3.2) are capped at `amountPaid − refundedAmount`. A member can never get back more than
  they paid, whatever the list price was.
- **One named discount per sale.** If several apply online, the member gets the larger saving (§3.3).
- **Pricing formula** (`priceSale`, pure):
  - `PERCENT`: `discountAmount = round_half_up(listPrice × value / 100)`;
  - `FIXED`: `discountAmount = min(value, listPrice)`;
  - `amount = listPrice − discountAmount`.
  - Whole currency units, like `Plan.price`.
  - A discount never applies to a 0 price (free trial, free event).
- Rows from before E3 and imported rows have `listPrice = null`: «цена не записана», no discount shown.
  No backfill (§12).

## 2. Data model (Prisma, additive; `db push` without `--accept-data-loss`)

```prisma
enum DiscountKind {
  PERCENT // value 1–100
  FIXED   // value in whole units of `currency`
}

// A club's price reduction for members. Applied by staff at a sale (any
// discount), by the member in the app checkout (only one with a `code`), or by
// itself (`isFamily`: another family member holds a current abonement).
// Sport-agnostic: scoped to tariffs and to events, never to a discipline's kind.
model Discount {
  id          String    @id @default(uuid()) @db.Uuid
  workspaceId String    @db.Uuid
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  name     String       @db.VarChar(100)   // «Семейная», «Студенческая», «Весна-2027»
  kind     DiscountKind
  value    Int
  // FIXED only: the currency the sum is in; items in another currency don't qualify.
  currency String?      @db.Char(3)

  // Promo code, stored upper-case (A–Z, А–Я, 0–9, «-»; 3–32). Set → members may
  // enter it at checkout; staff may pick it either way. null → staff-only.
  code     String?      @db.VarChar(32)
  // Automatic family discount. At most one active per club (handler check).
  // Never has a code, a use limit or once-per-member.
  isFamily Boolean      @default(false)

  // Scope: every tariff, or only `plans`; and/or every paid event.
  allPlans Boolean        @default(true)
  plans    DiscountPlan[]
  events   Boolean        @default(false)

  // Club-local days, inclusive; null = open.
  startsOn DateTime? @db.Date
  endsOn   DateTime? @db.Date
  // Uses across the club (see «use» in §3.1); null = unlimited.
  maxUses       Int?
  oncePerMember Boolean @default(false)

  // Archive instead of delete once used (sales reference it).
  isActive    Boolean  @default(true)
  // Display only, like markedPaidById.
  createdById String   @db.Uuid
  createdAt   DateTime @default(now())
  // The edit form's version (optimistic concurrency, conventions §1).
  updatedAt   DateTime @default(now()) @updatedAt

  subscriptions      Subscription[]
  eventRegistrations EventRegistration[]
  payments           Payment[]

  @@unique([workspaceId, code]) // NULLs don't collide in Postgres
  @@index([workspaceId, isActive])
}

// One tariff of a discount's scope (when allPlans = false).
model DiscountPlan {
  discountId String   @db.Uuid
  discount   Discount @relation(fields: [discountId], references: [id], onDelete: Cascade)
  planId     String   @db.Uuid
  plan       Plan     @relation(fields: [planId], references: [id], onDelete: Cascade)

  @@id([discountId, planId])
  @@index([planId])
}

// The same price columns on each sale-carrying table. All nullable or defaulted.
model Subscription {
  // …existing fields…
  // Tariff price at sale, before any discount. null: sold before E3, imported.
  listPrice      Int?
  // The named discount applied (Restrict: a used discount is archived, never deleted).
  discountId     String?   @db.Uuid
  discount       Discount? @relation(fields: [discountId], references: [id], onDelete: Restrict)
  discountName   String?   @db.VarChar(100) // snapshot: a later rename never rewrites history
  discountAmount Int       @default(0)      // the named discount's part, fixed at sale
  // Who set the agreed amount: the seller; replaced by whoever changes the
  // amount or applies a discount at mark-paid. Display only, no FK (like
  // markedPaidById). null: online, imported, sold before E3.
  pricedById     String?   @db.Uuid

  @@index([discountId])
  @@index([workspaceId, pricedById])
}
model EventRegistration { /* same five columns + relation + both indexes */ }
model Payment           { /* the four price columns + relation + @@index([discountId]); no pricedById (online) */ }

model Workspace { discounts Discount[] }
model Plan      { discountPlans DiscountPlan[] }
```
- No new unique on an existing table (conventions §5). The only unique is on the new table.
- **Why `pricedById` and not E1's `markedPaidById`:** a credit sale is priced by its seller but
  marked paid later, maybe by someone else. Subscriptions don't store the seller (only the audit entry
  does), so «who gave this reduction» needs its own column.
- **No backfill and no `migrations()` entry.** New columns are nullable or `0`, and legacy amounts stay
  as they are.
- The demo wipe (`domains/demo/*`) deletes discounts after the sales that reference them (Restrict).
- `Payment` carries the priced facts from checkout to activation. The webhook copies them onto the
  sale, so the sale is the single source for journal and revenue (E1 «no ledger table»).

## 3. Server

### 3.1 Domain — `apps/server/src/domains/discounts/`

The pure contract, shared by the sale writers, the online checkout and E2 autopay:

- `discount-rules.ts` (pure, unit-tested):
  - `normalizePromoCode(raw)`: trim, upper-case, `Ё→Е`. Returns `null` unless it matches
    `^[A-ZА-Я0-9-]{3,32}$`.
  - `priceSale({ listPrice, currency, discount | null }) → { amount, discountAmount, discountId, discountName }`
    implements §1.
  - `discountApplies(discount, item: { planId | eventId, listPrice, currency }, today: 'YYYY-MM-DD') → refusal text | null`.
    It checks, in order: active, dates, scope, currency, list price > 0.
  - `saleDiscount(row) → { total, named, oneOff }` (§1) for readers.
  - `discountStatus(discount, uses, today) → 'active' | 'scheduled' | 'expired' | 'exhausted' | 'archived'`.
- `discount-uses.ts`:
  - A **use** is a sale row with this `discountId`, except an unpaid sale later cancelled. That means a
    `Subscription` not (`status = CANCELLED AND isPaid = false`), or an `EventRegistration` not
    (`status = CANCELLED AND isPaid = false`).
  - Online checks also count a `PENDING` `Payment` with this `discountId`, created within
    `PENDING_REUSE_MS` (`load-buyer.ts:92`) and not the caller's own reused payment.
  - Refunds don't give a use back.
  - `countDiscountUses(tx, discountId, { userId?, includePending })` is one `count` per table, on the
    `discountId` indexes.
- `family.ts`:
  - `loadFamilyEligibility(tx, { workspaceId, userId, now }) → boolean`.
  - The buyer's **family** is everyone one confirmed guardianship step away (`consentAt` set), plus the
    other dependents of the buyer's guardians (siblings) and the other guardians of the buyer's
    dependents (co-parents). In short, two hops in the guardianship graph.
  - The buyer **qualifies** when another family member, a current member of this club, holds an
    abonement matching `currentSubscriptionWhere(now)` (`domains/subscriptions/current-subscriptions.ts:27`).
    Paid or not: a sale is a sale.
  - The workspace owner never holds an abonement, so the owner alone never makes a family qualify.
- `resolveAutomaticDiscount(tx, { workspaceId, userId, item, now }) → Discount | null`: the club's active
  family discount when it applies to `item` and the buyer qualifies. **E2 calls this at every autopay
  charge** (agreed with the E2 design: promo and staff discounts never carry over to a renewal).
- `lockDiscount(tx, id)`: `SELECT "id" FROM "Discount" WHERE "id" = $1::uuid FOR UPDATE`, the
  `WorkspaceEvent` lock pattern (`event-registration.service.ts:105`). Staff sales take it before
  counting uses, so `maxUses` and `oncePerMember` are exact there.

### 3.2 Discount management — `features/discounts/`

| Endpoint | Method name | Tier (`@Roles` + handler) | DTOs | Audit |
|---|---|---|---|---|
| `GET workspaces/:workspaceId/discounts` | `listDiscounts` | `CLUB_ADMINS` + `assertClubAdmin` | in `ListDiscountsQuery`, out `ListDiscountsOutput` | — |
| `POST workspaces/:workspaceId/discounts` | `createDiscount` | `CLUB_ADMINS` + `assertClubAdmin` | in `CreateDiscountInput`, out `DiscountOutput` | `discount.create` |
| `PATCH workspaces/:workspaceId/discounts/:discountId` | `updateDiscount` | `CLUB_ADMINS` + `assertClubAdmin` | in `UpdateDiscountInput` (+ `ExpectedUpdatedAtField`), out `DiscountOutput` | `discount.update` / `discount.archive` / `discount.restore` |
| `DELETE workspaces/:workspaceId/discounts/:discountId` | `deleteDiscount` | `CLUB_ADMINS` + `assertClubAdmin` | out `DeleteDiscountOutput` (`{ status: 'deleted' }`) | `discount.delete` |

`CreateDiscountInput` (flat + `superRefine`). `UpdateDiscountInput` = the same fields optional + `isActive`:

| Field | Rule |
|---|---|
| `name` | trimmed, 1–100; unique among the club's active discounts (400 «Скидка с таким названием уже есть») |
| `kind` | `PERCENT \| FIXED` |
| `value` | int; PERCENT 1–100, FIXED 1–10 000 000 |
| `currency` | FIXED: required, `Char(3)`, default in the form = the club's tariff currency; PERCENT: must be absent |
| `code` | optional; `normalizePromoCode` must accept it (400 «Промокод — от 3 до 32 букв, цифр или дефисов»); taken → 400 «Такой промокод уже есть» (P2002 → typed error) |
| `isFamily` | boolean; with `code`, `maxUses` or `oncePerMember` → 400; a second active family discount → 400 «В клубе уже есть семейная скидка «X»» |
| `allPlans`, `planIds` | `planIds` (≤ 100 uuids, the club's tariffs, else 404) required non-empty when `allPlans = false` |
| `events` | boolean; `allPlans = false`, empty `planIds` and `events = false` → 400 «Выберите, на что действует скидка» |
| `startsOn`, `endsOn` | `z.iso.date()` optional; `endsOn ≥ startsOn` |
| `maxUses` | int 1–100 000, optional |
| `oncePerMember` | boolean |

Edits never touch past sales: they keep their snapshot. Archive = `isActive: false`, restore = `true`; a
restore re-runs the family and name checks.

`deleteDiscount`:
- only when it has 0 uses and is referenced by no `Payment`, else 400 «Скидкой уже пользовались —
  уберите её в архив»;
- the FK `Restrict` backs the check.

`ListDiscountsQuery`:
- `archived?` (`strictBoolean`, default false). The list holds ≤ 200 rows per club, no paging (the
  tariffs list precedent).
- `from?`, `to?`: club-local days for the «Кто давал скидки» summary. Same rules as E1's
  `ListPaymentJournalQuery`; neither = the `revenue_30d` window.

`DiscountOutput`:
- the fields above + `plans: [{ id, name }]`, `updatedAt`, `createdAt`;
- `status` (from `discountStatus`);
- `uses` (§3.1, without pending);
- `given: [{ currency, amount }]`: Σ `discountAmount` of its **paid** sales, refunds ignored.

`ListDiscountsOutput` = `{ data: DiscountOutput[], byStaff: DiscountStaffSummary[] }`:
- `DiscountStaffSummary` = `{ userId, name, currency, oneOff: { count, amount }, named: { count, amount } }`.
- It covers paid sales by `paidAt` in the window, grouped by `pricedById` (`groupBy` on the new index),
  using the §1 split.
- Online sales (`pricedById = null`) are excluded. Staff who left the club keep their stored name, or
  «Бывший сотрудник».
- Sorted by `oneOff.amount` desc, ≤ 50 rows.
- This is how the owner sees who gave how much.

### 3.3 Selling with a discount

**Who may do what** (handler checks; the routes and today's amount rule stay as they are):

| Action | Owner / admin | Head coach / coach / direction manager (`COACHING_ROLES`, scoped by `assertCanWriteMember`) |
|---|---|---|
| Apply any active discount from the club list (staff-only, with a code, or family when the member qualifies) | ✅ | ✅ |
| Apply a family discount to a member who doesn't qualify | ❌ (400) | ❌ (400) |
| Exceed `maxUses` / `oncePerMember` / dates | ❌ | ❌ |
| Type an amount ≠ the computed price (one-off reduction, comp, part-payment in cash) | ✅ | ✅ **as today**; recorded as «разовая скидка» with `pricedById` (open question §15) |

**Staff sale options:** `features/sale-discounts/` (controller on `workspaces/:workspaceId/members/:userId`).

| Endpoint | Method name | Tier | DTOs |
|---|---|---|---|
| `GET …/members/:userId/sale-discounts` | `listSaleDiscounts` | `COACHING_ROLES` + `resolveCoachScope` + `assertCanWriteMember` | in `ListSaleDiscountsQuery` (`eventId?`), out `ListSaleDiscountsOutput` |

`ListSaleDiscountsOutput`:
- No permission flag: everyone who may sell may type an amount (as today).
- `familyEligible: boolean`. The relative is not named: a scoped coach may not see them.
- `options`: one per active discount usable for this member today. Each has
  `{ discountId, name, kind, value, code, isFamily, endsOn, items }`, where
  `items: [{ planId | null, eventId | null, listPrice, amount, currency }]`:
  - without `eventId`: the club's active tariffs in scope;
  - with `eventId`: that event's ticket.
- The server computes `amount`. The clients never re-implement §1.
- Options failing a limit for this member (`oncePerMember`, `maxUses`) are omitted. Archived and
  out-of-date ones too.

**Writers** (all inside the existing transactions; `lockDiscount` → `discountApplies` → use count →
`priceSale`):

- `AssignSubscriptionInput` (`assign-subscription.feature.ts:6-20`) gains `discountId?: uuid`.
  - The server **never applies a discount by itself at a staff sale**. The form preselects the family
    option. An API or MCP caller that sends nothing gets the list price.
  - `amountPaid` keeps its meaning and its current rule: any caller allowed to sell may send it.
  - Every sale writes `pricedById` = the actor.
  - `SubscriptionService.grantFromPlan/grantFromPlanInTx` (`subscription.service.ts:217-245`) take
    `{ listPrice, discountId, discountName, discountAmount, pricedById }` and stop defaulting `amountPaid`
    to `plan.price` (`:228`). The caller always passes the priced amount.
  - Refusal texts (400):
    - «Скидка «X» не действует на этот тариф»;
    - «Срок скидки «X» закончился» / «…ещё не начался»;
    - «Скидка «X» уже использована этим учеником»;
    - «Лимит скидки «X» исчерпан»;
    - «Семейная скидка — только если у члена семьи есть действующий абонемент».
- `MarkSubscriptionPaidInput` (`mark-subscription-paid.feature.ts:6-12`) gains `discountId?`.
  - Allowed only while the sale has no discount and has a `listPrice`. Otherwise 400 «Скидку можно выбрать
    при оформлении абонемента» or «У этой продажи не записана цена тарифа».
  - It reprices from `listPrice`. `amount` may differ from the agreed amount, as today.
  - When the amount changes or a discount is applied, `pricedById` becomes the marker. A plain confirm
    keeps the seller.
- `MarkEventRegistrationPaidInput` (`mark-event-registration-paid.feature.ts:6-10`) gains `discountId?` and
  `amount?` (0–10 000 000). Tickets get the same rule as abonements, so there is one rule for every sale:
  whoever may mark may type, and it is recorded.
  - The handler (`:106`) writes `listPrice = event.price`, the discount columns, `pricedById` = the
    marker, and `amountPaid` = the typed or priced amount.
- Every new sale writes `listPrice`, discount or not, so every typed reduction shows from day one, with
  who made it:
  - assign;
  - mark-paid repricing;
  - ticket mark;
  - online activation;
  - E2 autopay.
  - Club import and demo generators: listPrice only where the source has it (import: never).

**Online, members** (`features/online-payments/`, `features/event-registrations/`):

| Endpoint | Method name | Tier | DTOs |
|---|---|---|---|
| `GET workspaces/:workspaceId/me/online-purchase` (exists) | `getOnlinePurchaseOptions` | member (as now) | `OnlinePlanOutputSchema` gains `amount` (what this member pays now, family applied) and `discountName: string \| null` |
| `GET workspaces/:workspaceId/me/checkout-quote` (new) | `getCheckoutQuote` | member, act-as like checkout; `@Throttle({ default: { ttl: 60_000, limit: 20 } })` (the `join-workspace.controller.ts:40` pattern) | in `GetCheckoutQuoteQuery` (`planId?`, `registrationId?`: exactly one; `promoCode?` ≤ 40 raw chars), out `CheckoutQuoteOutput` |
| `POST workspaces/:workspaceId/payments` (exists) | `createPayment` | member | `CreatePaymentInput` gains `promoCode?` |
| `POST workspaces/:workspaceId/event-registrations/:registrationId/checkout` (exists) | `payEventRegistrationOnline` | member | new body `PayEventRegistrationOnlineInput { promoCode? }` |

`CheckoutQuoteOutput`:
- `{ listPrice, amount, currency, discount: { name, code: string | null, isFamily, endsOn } | null, promoCodeNote: string | null }`.
- `promoCodeNote` explains why the code didn't change the price:
  - «Промокод не найден»;
  - «Срок действия промокода закончился»;
  - «Промокод не действует на этот тариф» / «…на это событие»;
  - «Вы уже использовали этот промокод»;
  - «Промокоды по этой акции закончились»;
  - «С промокодом выходит 0 ₽ — оформите покупку в клубе»;
  - «Семейная скидка выгоднее — она уже учтена».

**Checkout pricing** (`create-payment.handler.ts:61-135`, `pay-event-registration-online.handler.ts:88-158`),
one shared `priceOnlineItem(tx, { workspaceId, userId, item, promoCode, now })` in
`features/online-payments/price-online-item.ts`:
1. Candidates:
   - the family discount (`resolveAutomaticDiscount`);
   - the code's discount: `discountApplies`, `oncePerMember` / `maxUses` with pending payments counted.
2. Keep the larger `discountAmount`. A tie goes to family (no use consumed).
3. A `promoCode` that can't be used (any note except «Семейная скидка выгоднее») is **refused** on
   `createPayment`/checkout with the note as a 400. The member never pays more than the quoted price. When
   family wins, checkout proceeds at the family price, which is what the quote showed. The quote endpoint
   returns every case as a note instead.
4. `amount < 1` → 400 «С промокодом выходит 0 ₽ — оформите покупку в клубе». Providers don't take
   0 ₽, and comps are staff work.
5. The pending-payment reuse (`create-payment.handler.ts:89-106`, `pay-event-registration-online.handler.ts:106-124`) adds
   `amount` and `discountId` to its `where`. A member who adds a code gets a new payment, and the old one
   lapses.
6. `startProviderPayment` (`start-provider-payment.ts:30-63`) takes and stores
   `listPrice, discountId, discountName, discountAmount` on `Payment`. `amount` stays server-computed.

**Activation** (`payment-activation.service.ts:125-148,246-258`):
- `grantFromPlanInTx` / `markPaidOnlineInTx` copy the four columns from `Payment`.
- **No limit or date re-check.** The member paid the quoted price within the 30-minute pending window,
  and refusing would strand their money. Online limits are therefore soft by at most the checkouts open
  at the same moment (§14).

### 3.4 Audit

- Sale metadata gains `listPrice`, `discountId`, `discountName`, `discountAmount`, and `oneOff` (the derived
  remainder) when > 0. The audit actor is the `pricedById` person, so «История изменений» also answers
  «кто снизил сумму». This covers:
  - `member.assignSubscription` (`assign-subscription.handler.ts:159-181`; today's `listPrice` key keeps its
    name);
  - `member.markSubscriptionPaid`;
  - `event.markRegistrationPaid` (`mark-event-registration-paid.handler.ts:119`);
  - `payment.succeeded` (`payment-activation.service.ts:157-171,280-297`).
- New actions:
  - `discount.create`, `discount.update`: metadata = changed fields, before → after;
  - `discount.archive`, `discount.restore`, `discount.delete`: snapshot.
- Realtime: discount writes emit `discounts`. Sale writers already emit `payments` (E1 §3.3).

### 3.5 Revenue, journal and the glossary

- `domains/metrics/revenue.ts`: **no formula change.** `revenue_30d`, `revenue_today`, `mrr`,
  `money_at_stake` keep reading `amountPaid` (− refunds, E1). The forecast keeps each member's latest
  `amountPaid` as the renewal price (`domains/analytics/forecast.ts:124`). A family discount repeats, so
  that is right. A one-time promo under-forecasts that member's next renewal, which errs low (§12).
- `domains/payments/journal.ts` (E1 §3.1):
  - Sale rows select the four price columns and `pricedById` (names resolved like E1's `markedBy`).
  - `PaymentJournalEntry` gains:
    - `listPrice: int | null`, `discountName: string | null`, `discountAmount: int`;
    - `oneOffDiscount: int` (derived);
    - `pricedBy: { userId, name } | null`, set only when `oneOffDiscount > 0` or a named discount was
      applied by staff.
    - Refund rows: null / 0.
  - `ListPaymentJournalQuery` gains `discounted?` (`strictBoolean`: rows with a total discount > 0, named
    **or** one-off) and `discountId?` (uuid; a foreign id → 404). Two plain params, not a union
    (conventions §1).
  - `ListPaymentJournalQuery` also gains `pricedById?` (uuid): rows whose price that staff member set.
  - `totals[]` gains `discounted: { count, amount, oneOffAmount }`: Σ total discount and its one-off part
    over the payment rows matching the filters.
- Glossary row added to the parent spec's B2 table in the E3 PR. `revenue_30d` gets the clarifying
  phrase «суммы фактически к оплате, после скидок».

| Metric id | Russian label | Definition | Server function | Shown on |
|---|---|---|---|---|
| `discounts_given` | «Скидки» | over paid sales in the window (by `paidAt`) recorded with a `listPrice`: Σ `max(0, listPrice − amountPaid)`; named part `discountAmount`, rest «разовая» (attributed to `pricedById`); refunds don't change it; never subtracted from revenue | `discount-rules.ts` `saleDiscount`, `journal.ts` totals | «Платежи» summary and CSV, AI `revenue_report`, «Скидки» tab (`given` per discount; «Кто давал скидки» per staff member) |

### 3.6 Receipts (54-ФЗ) and consumer law

- **Online receipt** = the charged price. `buildYookassaReceipt` (`yookassa-api.ts:54-77`) already sends
  one line with `input.amount`, which is `Payment.amount`, which is now the discounted amount.
  - YooKassa requires Σ item amounts = the payment amount. A discount must be inside the line price, not
    a negative line.
  - ФФД has no mandatory «скидка» attribute for this case.
  - **No change to the receipt builder.** The line text stays «Абонемент «X»» / the event title.
- Partial refunds of discounted sales (E1 §3.2) send a receipt for the refunded amount. That is
  unchanged and correct.
- Offline sales: the club's register prints the receipt. The admin shows the amount to punch,
  «К оплате 3 600 ₽», not the list price.
- **ЗоЗПП ст. 10 (price information before purchase):**
  - the app shows the final amount, the discount's name and its end date before the provider page opens;
  - the server charges exactly the quoted amount or refuses (§3.3 step 3), so there is no silent re-pricing.
- **Autopay (E2, ЗоЗПП):** at opt-in E2 shows «Сейчас X ₽ · дальше Y ₽ каждые N дн.».
  - X may include a promo. Y = `priceSale(plan.price, resolveAutomaticDiscount(...))`: family only.
  - E2 stores Y as the agreed amount.
  - A later rise above Y (price up, or the family discount lost) pauses autopay until the member
    re-confirms. A promo at the first sale never causes that pause.
- Club announcements that advertise a discount are the club's own content. Stating the terms and dates
  is their duty under the advertising law. The demo text states them (§9).

### 3.7 Route-tier spec

`shared/access/route-tier-consistency.spec.ts`:
- `CLUB_ADMINS` list adds the four `discounts` routes;
- `listSaleDiscounts` is `COACHING_ROLES`;
- `getCheckoutQuote` is a member route with act-as accepted (workspace-scoped, no `@Roles`), like checkout.

## 4. Admin UI

**«Деньги → Абонементы → Скидки»** (new tab `subscriptions/discounts`, `access: "clubAdmin"`, under the
existing `ClubAdminGate`):
- `subscriptionTabs` (`sections.ts:51-64`) becomes Тарифы · Скидки · Платежи. The sidebar is unchanged
  (11 items).

**Job.** «владелец / администратор · раз в сезон и перед акцией · завести скидку или промокод,
посмотреть, сколько раз ею воспользовались, убрать в архив; раз в месяц · увидеть, кто из сотрудников
сколько скидок дал».

**Layout** (`features/discounts/DiscountList.tsx`, own fetch):
1. `SectionTabs` «Абонементы».
2. One row: «Показать архив» toggle (link-style) · at the right «Новая скидка» (the page's one filled
   button).
3. List (table on desktop). Each row:
   - name;
   - size «−10%» / «−500 ₽»;
   - how it applies: «Промокод ВЕСНА» / «Семейная — сама» / «Выбирает сотрудник»;
   - scope «Все тарифы» / «3 тарифа» (+ « · события»);
   - dates «до 31 марта» (only when set);
   - usage «использована 14 раз из 50 · скидок на 8 400 ₽»;
   - a status word only when not active, muted: «Ещё не началась», «Закончилась», «Лимит исчерпан»,
     «В архиве».

   No buttons in rows; the row opens the panel.
4. **«Кто давал скидки»** block under the list, only when `byStaff` is non-empty:
   - its own period select (E1's presets: «За 30 дней» default · «Этот месяц» · «Прошлый месяц» ·
     «Выбрать даты…»);
   - one line per staff member: «Петров — разовые 3 400 ₽ (5 оплат) · из списка 1 200 ₽ (3)»;
   - plurals via `pluralRu`; only non-zero parts are shown;
   - each line links to the journal filtered by that person and «Со скидкой»
     (`subscriptions/payments?discounted=1&pricedById=…`).
5. Empty after a successful load: «Скидок пока нет — создайте первую, например семейную». The empty state
   never flashes while loading. The «Кто давал скидки» block can show even with no discounts defined,
   since one-off reductions exist without them.
6. Realtime `["discounts", "payments"]`.

**Discount panel** (`features/discounts/DiscountFormSheet.tsx`, side panel, `?discount=<id>` / `?new=1`):
- Fields, top to bottom:
  - «Название»;
  - «Размер»: number + segmented «%» / «₽»; currency shown only when the club has tariffs in two
    currencies;
  - «Как применяется», radio:
    - «Выбирает сотрудник при продаже»;
    - «По промокоду» (shows «Промокод», with the hint «ученик вводит его при оплате в приложении;
      сотрудник тоже может его выбрать»);
    - «Семейная — применяется сама» (hint «если у родителя, ребёнка, брата или сестры ученика есть
      действующий абонемент»; disabled with the reason when another family discount is active);
  - «На что»: «Все тарифы» / «Выбрать тарифы…» (multi-select of active tariffs) + checkbox «Платные
    события»;
  - «Срок» (two optional dates);
  - «Ограничения», hidden for family: «Не больше N раз всего» (optional), «Один раз на ученика» (checkbox).
- Limits from `FORM_LIMITS.discount.*` (`shared/lib/contract-limits.ts`).
- Footer: «Сохранить» (filled) · «Отмена» (dirty guard). Edits send `expectedUpdatedAt`; a 409 shows
  `<StaleUpdateNotice>`.
- An existing discount shows one muted line above the footer: «Изменения не затронут уже проданные
  абонементы».
- «⋯» in the panel header (detail-panel exception, as in E1): «В архив» / «Вернуть из архива» ·
  «Удалить», only while `uses = 0`.
  - Delete uses `confirmDialog`: destructive, «Удалить скидку «X»?» · «Ею ещё не пользовались, удаление
    ничего не изменит в продажах.».
  - Archive confirms with «Скидку больше нельзя будет выбрать при продаже, промокод перестанет
    действовать. Проданные абонементы не изменятся.»

**Sale form** (`features/subscriptions/MemberSubscriptionPanel.tsx`) and **mark-paid**
(`MarkPaidForm.tsx`):
- The panel loads `listSaleDiscounts` with its plans.
- After a tariff is chosen, «Скидка» (Select) renders **only when ≥ 1 option has an item for this tariff**:
  - entries: «Без скидки» · «Семейная −10% — 3 600 ₽» · «ВЕСНА −500 ₽ — 3 500 ₽» · …;
  - family is preselected when present, with a muted hint «У члена семьи есть действующий абонемент».
- Amount: the editable «Сумма» field stays for everyone who sells, as today. It is prefilled with the
  selected option's amount, or the tariff price. Typing a lower number shows the muted line «Разовая
  скидка −N ₽ к цене по тарифу — будет видна в «Платежах»». The line is transparency, not a warning.
- `MarkPaidForm`:
  - same «Скидка» select, only when the sale has none and has a `listPrice`;
  - «Получено» stays editable for everyone, as today, with the same muted line when it falls below the
    agreed price;
  - the comment «change it for a discount or a part-payment» (`:20-24`) gains «— recorded as a one-off
    discount with who changed it».
- Errors via `errorMessage`. The 400 texts above are user-ready.

**Event tickets** (`features/events/EventRegistrationsPanel.tsx`): «Отметить оплату» opens the same small
form. The «Скидка» select is shown only when options exist for this event. The amount is editable (new
for tickets, same rule as abonements), with the same muted one-off line.

**Journal** (`features/payments/PaymentJournal.tsx`, `PaymentEntrySheet.tsx`, E1 §4):
- **Row**: a payment with a total discount > 0 adds a muted line under the amount: «скидка «Семейная»
  −400 ₽» / «Разовая скидка 1 000 ₽ · Петров» / «скидка «ВЕСНА» −500 ₽ и разовая 200 ₽ · Петров».
  The name is `pricedBy`.
- **Summary**: one muted line, only when > 0: «Скидки: 12 400 ₽ по 31 оплате, из них разовые 3 400 ₽».
  It is not part of «итого», which stays revenue.
- **«Фильтры» panel** gains:
  - «Скидка» (Все · Со скидкой · each discount by name, archived included). «Со скидкой» covers named
    and one-off.
  - «Дал скидку» (staff picker) = `pricedById`. `ListPaymentJournalQuery` gains `pricedById?` (uuid),
    next to E1's `markedById`.
  - The URL holds them (`?discounted=1` / `?discountId=` / `?pricedById=`).
- **Entry panel facts**, only when known: «Цена по тарифу 4 000 ₽» · «Скидка «Семейная» −400 ₽» ·
  «Разовая скидка 1 000 ₽ · Петров» · «Получено 2 600 ₽» · «Отметил …» (E1).

**Elsewhere.**
- Member card `paymentLabel` (`features/subscriptions/subscription-display.ts:65-73`) appends « · скидка
  «X»» when named, and « · разовая скидка N ₽ · Петров» for the one-off part.
  - The staff read (`listMemberSubscriptions`, `STAFF_ROLES`) returns `listPrice`, the discount
    columns, the derived `oneOffDiscount` and `pricedBy { userId, name }`.
  - The member's own read gets the same columns without `pricedBy`: members don't need staff names.
- `features/audit/audit-meta.ts` (`:150-159` neighbours):
  - action labels: `discount.create` «Скидка создана», `discount.update` «Скидка изменена»,
    `discount.archive` «Скидка в архиве», `discount.restore` «Скидка возвращена из архива»,
    `discount.delete` «Скидка удалена»;
  - metadata labels: `listPrice` «цена по тарифу», `discountName` «скидка», `discountAmount` «размер
    скидки», `oneOff` «разовая скидка».
- `shared/api/discounts.ts` (list/create/update/delete, `listSaleDiscounts`). Types come from `ApiTypes.*`.
- `apps/admin-e2e/src/role-matrix.ts`: `subscriptions/discounts` joins the club-admin-only routes
  (`:44-45` neighbours).

**Head coach / coaches:**
- no «Скидки» tab;
- in the sale and mark-paid forms they see the discount select, and the amount stays editable as today.

## 5. Mobile / client

- **Members: «Оплатить онлайн»** (`features/payments/OnlinePurchaseSection.tsx`):
  - Each tariff card shows `amount`. When it differs from `price`: «~~4 000 ₽~~ 3 600 ₽ · Семейная скидка»
    (strike-through via `textDecorationLine`, theme colours).
  - Under the list, a «Есть промокод?» link opens one row: input (auto-caps) · «Применить».
  - «Применить» calls `getCheckoutQuote` per visible tariff, at most the 10 shown; the throttle allows 20 a
    minute. The cards update to the quoted amounts with «Промокод ВЕСНА · до 31 марта». A
    `promoCodeNote` shows under the input in the warning tone.
  - «Оплатить» (`:112-134`) sends `promoCode` when one is applied to that card.
  - The pending card (`:166-170`) already shows the payment's amount.
- **Members: events** (`features/schedule/EventsScreen.tsx:190`): «Оплатить» first shows a confirm sheet
  with the price, the same «Есть промокод?» row (`getCheckoutQuote` with `registrationId`), and «Оплатить
  N ₽».
- **«Мой абонемент»** (`features/subscription/MySubscriptionScreen.tsx` payment line, E1 §5) appends «со
  скидкой «X»».
- **Coach / head coach / admin screen** (`features/subscription/CoachMemberSubscriptionScreen.tsx`):
  - sell and pay modes load `listSaleDiscounts` and show a «Скидка» picker (same rule: only when options
    exist; family preselected);
  - the amount input (`:230-233`, `:345-366`) stays for everyone, prefilled with the selected option's
    amount. The same muted one-off line shows when the typed amount is lower;
  - the card's payment line (`:534`) appends the discount name and «разовая скидка N ₽ · Петров» (from the
    staff read's `pricedBy`).
- The helper `features/payments/payment-helpers.ts` gains `discountedPriceText` with a spec.
- Client web: none.

## 6. MCP / AI

- `revenue_report` (`features/mcp/tools/money-tools.ts:41-165`, `adminOnly`):
  - output gains `discounts: { total, count, byDiscount: [{ name, count, amount }], oneOff: { amount,
    byStaff: [{ name, count, amount }] } }` over the same window and filters (`discounts_given`), so «кто
    давал скидки» is answerable;
  - the description adds «скидки — сколько не дополучено от цены по тарифу; в выручку уже не входят».
- `abonement_states` (`:281-384`) and `member_profile` (`member-tools.ts:215+`) add `discountName` where
  they show `amount` (`scope.seesMoney`).
- No discount write tool and no promo tool: MCP tools are read-only (AI tokens). A «list discounts» tool
  has no requester; `revenue_report.byDiscount` answers «какие скидки работают».
- Update `docs/mcp.md`.

## 7. CSV

`payments.csv` (E1 §7, `ExportService.paymentsCsv`):
- adds columns after «Сумма»: «Цена по тарифу» · «Скидка» (total discount, positive; refunds empty) ·
  «Название скидки» (the snapshot, «Разовая» for one-off only, «X + разовая» for both) · «Дал скидку»
  (`pricedBy` name);
- honours the journal's `discounted` / `discountId` / `pricedById` filters, so «CSV of every ВЕСНА sale»
  is one click.

No separate discounts CSV: the tab is short, and its usage comes from the journal.

## 8. Tests

Server unit (Prisma mocked; every handler: refusals per role, owner bypass, not found, each happy branch):
- `domains/discounts/discount-rules.spec.ts`:
  - percent rounding (4 500 × 5% = 225; 3 333 × 10% = 333);
  - fixed capped at the price; 0 price untouched;
  - currency mismatch;
  - dates at club-local edges;
  - scope; status;
  - `saleDiscount` with named + one-off and with amount > list;
  - code normalisation (`ё`, case, junk).
- `discount-uses.spec.ts`:
  - cancelled-unpaid excluded; refunded counted;
  - pending payments within the window only, own reuse excluded.
- `family.spec.ts`:
  - a sibling via a shared guardian, a co-parent via a shared child;
  - unconfirmed link ignored; former member ignored; owner ignored;
  - expired abonement ignored, unpaid current counts.
- `create-discount` / `update-discount` / `delete-discount` / `list-discounts` handler specs:
  - head coach, coach, direction manager → 403;
  - family exclusivity; code taken (P2002); `superRefine` matrix; stale 409;
  - delete refused when used;
  - audit actions;
  - `byStaff`: split into one-off and named per `pricedById`, window by `paidAt`, online excluded.
- `list-sale-discounts.handler.spec.ts`:
  - a coach outside scope → 403;
  - no amount flag in the output (the amount rule is unchanged);
  - family option only when eligible;
  - exhausted / once-used options omitted; event items.
- `assign-subscription`, `mark-subscription-paid`, `mark-event-registration-paid` specs:
  - a coach and a head coach with `amountPaid` ≠ priced → accepted, as today; `listPrice` kept and
    `pricedById` = the coach, so the one-off part is derivable;
  - a plain mark-paid confirm keeps the seller's `pricedById`; a changed amount or applied discount sets
    the marker;
  - ticket `amount` accepted from any marking role and recorded the same way;
  - each refusal text;
  - `lockDiscount` called before the count;
  - columns written; audit metadata (`oneOff`, actor).
- `price-online-item.spec.ts`, `create-payment` / `pay-event-registration-online` / `get-checkout-quote`
  specs:
  - best-of family vs code, tie → family;
  - unused code refused on create;
  - 0 ₽ refused;
  - reuse keyed on amount + discount;
  - Payment columns stored.
- `payment-activation.service.spec.ts`: columns copied; no re-check (an exhausted discount still
  activates).
- `journal.spec.ts`: `discounted` (named and one-off) / `discountId` / `pricedById` filters,
  `totals.discounted.oneOffAmount`, one-off derivation, `pricedBy` resolved.
- `money-tools.spec.ts`: `discounts`. `export.service.spec.ts`: new columns.
- `route-tier-consistency.spec.ts`: the new routes.

Server e2e:
- `apps/server-e2e/src/discounts/discounts.e2e-spec.ts`:
  - admin CRUD;
  - head coach 403 on `POST discounts`;
  - archive hides the discount from `sale-discounts`;
  - delete refused after a sale.
- `apps/server-e2e/src/discounts/staff-discount-sale.e2e-spec.ts`:
  - head coach sells with «Студенческая −15%»: `amountPaid`, `listPrice` and the journal row show it;
  - head coach types a lower amount (a cash part-payment) → accepted; the journal row shows «Разовая
    скидка N ₽ · <head coach>»; «Со скидкой» and `pricedById` filters find it; `GET discounts` `byStaff`
    lists him;
  - admin one-off recorded the same way;
  - `maxUses = 1` with two parallel sales → exactly one succeeds (row lock).
- `apps/server-e2e/src/discounts/family-discount.e2e-spec.ts`:
  - guardian + two dependents (reuse the `families/families.e2e-spec.ts` setup);
  - the second child's sale lists the family option; the first child's doesn't;
  - the guardian's own online checkout is priced with family through `FakeGateway`, and the activated
    abonement carries it.
- `apps/server-e2e/src/discounts/promo-checkout.e2e-spec.ts`:
  - quote → create → webhook;
  - the YooKassa receipt line equals the discounted amount;
  - expired / once-used / wrong-tariff codes refused with notes;
  - the ticket checkout with a code.
- Update:
  - `subscriptions/coach-abonements.e2e-spec.ts` (coaches' amounts still accepted; `listPrice` and
    `pricedById` written);
  - `subscriptions/subscription-payment.e2e-spec.ts` (`:48-125` stays green; add asserts on `listPrice`
    and the derived one-off);
  - `analytics/metric-glossary.e2e-spec.ts` (a discounted sale: revenue = charged amount,
    `discounts_given` = the difference, journal default «Итого» still = `revenue30d`);
  - `payments/payment-journal.e2e-spec.ts` (discount filter, CSV columns);
  - `demo/demo-kit.e2e-spec.ts` (demo discounts).

Admin:
- `features/discounts/discount-view.spec.ts` (size, usage and status texts, plurals);
- render spec of `DiscountFormSheet` (family option disabled with reason, limits hidden for family);
- the sale form: select only when options exist; the one-off line appears when the typed amount is below
  the price;
- `DiscountList` «Кто давал скидки» renders only with `byStaff` rows; links carry the filters;
- `contract-limits.spec.ts` picks up `discount.*`;
- smoke: `subscriptions/discounts` for the four roles.

Mobile:
- `payment-helpers` spec (`discountedPriceText`);
- the coach screen shows the one-off line under a lowered amount, and `discountedPriceText` covers
  «разовая скидка N ₽ · имя» (helper-level spec).

## 9. Demo

`domains/demo/demo-club.plan.ts` and the demo generators:
- discounts:
  - «Семейная» −10% (family, all tariffs);
  - «Студенческая» −15% (staff, all tariffs);
  - «Продление −5%» with code `ПРОДЛИ5`, all tariffs, once per member, no end date;
- a handful of demo sales carry them: the kids' family (Миша and a sibling) with «Семейная», a few with
  «Студенческая», one admin one-off and one head-coach cash part-payment (so «Кто давал скидки» has
  rows);
- the announcement (`:2101`) becomes: «Продлите абонемент до конца недели — и следующая неделя тренировок
  пройдёт без перерыва. Промокод ПРОДЛИ5 даёт скидку 5% на продление: введите его при оплате в
  приложении или назовите на ресепшене.»

The product can honour this. The vague «в день окончания» condition is dropped.

## 10. Rollout

One PR «Скидки», after E1 phase B and E6 (it extends E1's journal, CSV and refund-aware readers):
- `db push`: one enum, two tables, four price columns × three tables plus `pricedById` × two, five indexes;
- **no backfill**, no `migrations()` line;
- contract regen;
- the glossary row into the parent spec B2;
- `docs/mcp.md`; `docs/demo.md` (the demo discounts);
- CHANGELOG. It states:
  - who may type an amount at a sale or when marking a payment is **unchanged**;
  - every amount below the tariff or event price is now recorded as «разовая скидка» with who set it.
    It is visible in «Платежи», the member card, the CSV, «История изменений» and the «Кто давал скидки»
    block on «Скидки»;
  - tickets can now be marked paid at a typed amount too, under the same rule;
  - revenue is unchanged; discounts now show in «Платежи».
- Old code tolerates the new columns (defaults), so rollback = redeploy the previous image. Sales made
  with a discount keep their `amountPaid`; only the discount labels vanish until redeploy.

## 11. Acceptance checklist

- [ ] Owner on demo ACADEMY: «Абонементы → Скидки» lists the three demo discounts with usage. Creating
      «Весна» −500 ₽ with code `ВЕСНА` until a date works. A second family discount is refused with the
      reason.
- [ ] Head coach: no «Скидки» tab, `POST discounts` → 403. Selling a tariff shows «Скидка» with the club's
      options, and «Сумма» stays editable.
- [ ] Head coach sells at a typed lower amount (cash part-payment): accepted. The journal row and the member
      card show «Разовая скидка N ₽ · <head coach>», «Со скидкой» finds it, and the audit entry shows
      `listPrice` and `oneOff` with him as the actor.
- [ ] Owner: «Скидки» → «Кто давал скидки» for «Этот месяц» lists him with that amount. The link opens the
      journal filtered to his reductions, and the CSV for that view has the «Дал скидку» column.
- [ ] The second child of one guardian gets «Семейная» preselected. The first child doesn't. An unconfirmed
      guardianship doesn't count.
- [ ] Member app: a family-eligible adult sees the discounted price on the tariff card. `ПРОДЛИ5` quotes −5%,
      and payment through ЮKassa charges and receipts the discounted amount. A second use is refused with
      «Вы уже использовали этот промокод».
- [ ] `maxUses = 1`, two staff sales at once → one succeeds, the other gets «Лимит скидки исчерпан».
- [ ] Journal: «Со скидкой» (named and one-off), per-discount and «Дал скидку» filters narrow rows and CSV.
      The summary «Скидки: …, из них разовые …» equals Σ (list − paid). The default «Итого» still equals
      «Выручка за 30 дней».
- [ ] A refund of a discounted sale is capped at the paid amount. Revenue and `discounts_given` behave per
      §1.
- [ ] Archiving a discount removes it from sale forms and makes its code «не найден». Past sales keep their
      label.
- [ ] tsc (server, admin, mobile), tests, contract drift, admin smoke for the four roles green.

## 12. Decisions

- **Today's amount rule stays; every manual reduction becomes visible.** Head coaches and coaches apply club
  discounts from the list, and they keep typing an amount at a sale or mark-paid, as today.
  - Removing an existing capability is the owner's call (§15). Cash part-payments are a real flow.
  - Every new sale records `listPrice` and `pricedById`. The one-off part (`listPrice − discountAmount −
    amountPaid`) shows with the person's name in the journal, member card, CSV and audit.
  - The «Скидки» tab sums it per staff member for a period.
  - Tickets gain the same typed amount, so there is one rule for every sale.
- **Discount = one table with three ways to apply:** staff-only, with a code, family. They are fields on
  one entity (`code`, `isFamily`), not three models. A code discount is also selectable by staff, which
  covers «назовите на ресепшене».
- **Scope:** all or chosen tariffs, plus all paid events or none. Sport-agnostic: no discipline or tariff
  kind in the rule.
- **Limits:** dates (club-local days), `maxUses`, `oncePerMember`.
  - A use = a sale with the discount, except a cancelled unpaid one. Refunds don't give a use back.
  - Staff sales check limits under a row lock and are exact. Online checks count open checkouts. Activation
    never refuses money already taken, so online limits may overshoot by concurrent checkouts.
- **One named discount per sale, no stacking.** Online the member gets the larger saving, and a tie goes to
  family. A one-off reduction (anyone who may sell) may sit on top of a named discount and is shown
  separately with who made it.
- **Sale rows carry the price facts:** `listPrice`, `discountId`, `discountName` snapshot, `discountAmount`,
  `pricedById`. The total and one-off parts are derived from `amountPaid`. `pricedById` exists because
  E1's `markedPaidById` names the person who recorded the payment, not the seller of a credit sale. Like
  E1, there is no ledger: the journal and revenue keep reading sale rows.
- **Revenue stays «amount actually charged».** No change to any revenue formula. `discounts_given` is a new,
  separate metric and is never subtracted.
- **No backfill of `listPrice`.** Old rows can't be priced reliably: tariff prices change, and the audit's
  `listPrice` exists only for assign. They show no discount.
- **Family = two hops of confirmed guardianships** (parent, child, sibling via a shared parent, co-parent via
  a shared child).
  - The trigger is another family member, a current club member, holding a current abonement, paid or not.
  - One percent for everyone who qualifies; no tiers.
  - Adults without a guardianship link (spouses, adult siblings) get a staff discount instead.
  - The relative is never named in sale forms: privacy, and scoped coaches.
- **The family discount is automatic only online and in autopay.** At a staff sale it is preselected but
  explicit, so API/MCP callers never get a discount they didn't ask for.
- **Autopay (E2) reprices with the family discount only.** Promo and staff discounts are one sale's. E2 shows
  «сейчас X · дальше Y» at opt-in, and Y is the agreed renewal amount.
- **Online 0 ₽ is refused.** Providers can't take it, and comps are staff work.
- **The server prices; clients never compute.** `listSaleDiscounts` and `getCheckoutQuote` return amounts,
  and the checkout charges the quoted amount or refuses. There is no silent fallback to the full price
  (ЗоЗПП ст. 10).
- **Receipts:** the line price is the discounted amount, with no discount line. `buildYookassaReceipt` is
  unchanged (54-ФЗ; ЮKassa's sum rule).
- **IA: a third tab «Скидки» in «Абонементы»** (Тарифы · Скидки · Платежи). The sidebar stays at 11. The
  cleanup decision «Деньги → Абонементы (Тарифы · Платежи)» grows by one tab, not by a menu item.
- **Forecast unchanged** (latest `amountPaid`). It errs low after one-time promos, which is the conservative
  side.
- **Demo:** the impossible «5% в день окончания» becomes the honourable promo code `ПРОДЛИ5`.
- **Codes are not secrets.** Refusal reasons are specific for a better experience. Quotes are throttled at
  20 a minute per user.

## 13. Implementation slices

Server slice S1 commits the schema, `domains/discounts/*` and every DTO and controller first, with the
contract regenerated. Then S2–S4 work in parallel against real types. Nobody runs the full gate mid-flight;
the integrator runs it once.

| Slice | Owns (only these files) | Size |
|---|---|---|
| S1 server: core + staff | `apps/server/prisma/schema.prisma`; `apps/server/src/domains/discounts/**` (+specs); `features/discounts/**`; `features/sale-discounts/**`; `features/member-subscriptions/{assign-subscription,mark-subscription-paid,list-member-subscriptions}.*` + `schemas.ts` + `member-subscriptions.controller.ts`; `domains/subscriptions/services/subscription.service.ts`; `features/event-registrations/{mark-event-registration-paid,schemas}.*` + `event-registrations.controller.ts` (mark route); `domains/event-registrations/event-registration.service.ts` (mark writers); `shared/access/route-tier-consistency.spec.ts`; `app/app.module.ts`; `apps/server-e2e/src/discounts/{discounts,staff-discount-sale,family-discount}.e2e-spec.ts`; `apps/server-e2e/src/subscriptions/{coach-abonements,subscription-payment}.e2e-spec.ts`; `open-api.json`; `libs/api-client/src/openapi/*` | M (≈ 2.5 d) |
| S2 server: online + reporting | `features/online-payments/{create-payment,get-online-purchase-options,get-checkout-quote,price-online-item,start-provider-payment,load-buyer,schemas,my-payments.controller}.*`; `features/event-registrations/pay-event-registration-online.*`; `domains/payments/services/payment-activation.service.ts`; `domains/payments/journal.ts` + `features/payment-journal/**`; `features/data-export/**`; `features/mcp/tools/{money-tools,member-tools}.ts` (+specs); `domains/demo/*`; `apps/server-e2e/src/discounts/promo-checkout.e2e-spec.ts`, `payments/payment-journal.e2e-spec.ts`, `analytics/metric-glossary.e2e-spec.ts`, `demo/demo-kit.e2e-spec.ts`; `docs/mcp.md`, `docs/demo.md`; parent spec B2 row | M (≈ 2 d) |
| S3 admin | `apps/admin/src/features/discounts/**`; `app/…/subscriptions/discounts/page.tsx`; `app/…/sections.ts`; `shared/api/discounts.ts`; `shared/lib/contract-limits.ts` (+spec); `features/subscriptions/{MemberSubscriptionPanel,MarkPaidForm,subscription-display}*`; `features/events/EventRegistrationsPanel.tsx`; `features/payments/{PaymentJournal,PaymentEntrySheet,journal-view}*`; `features/audit/audit-meta.ts`; `apps/admin-e2e/src/role-matrix.ts` | M (≈ 2 d) |
| S4 mobile | `apps/mobile/src/features/payments/{OnlinePurchaseSection,payment-helpers}*`; `features/schedule/EventsScreen.tsx`; `features/subscription/{CoachMemberSubscriptionScreen,MySubscriptionScreen}.tsx`; `shared/api/{payments,event-registrations,member-subscriptions,sale-discounts}.ts` | S–M (≈ 1.5 d) |

S1 ↔ S2 contract: S1 lands `priceSale`, `discountApplies`, `countDiscountUses`, `resolveAutomaticDiscount`,
`lockDiscount` and the `grantFromPlanInTx` / `markPaidOnlineInTx` parameters
`{ listPrice, discountId, discountName, discountAmount, pricedById }` before S2 starts.

Checks for the integrator:
- tsc server / admin / mobile;
- `npx nx test @clubspace/server -- discount`, `-- sale-discount`, `-- assign-subscription`,
  `-- mark-subscription-paid`, `-- event-registration`, `-- create-payment`, `-- checkout-quote`,
  `-- payment-activation`, `-- journal`, `-- money-tools`, `-- export`, `-- route-tier`;
- admin and mobile tests;
- server e2e `discounts/*`, `subscriptions/*`, `payments/*`, `analytics/metric-glossary`, `demo/demo-kit`;
- contract drift;
- `npm run test:admin-e2e` for the four roles;
- `cs-reviewer` before merge.

## 14. Open risks

- **One-off reductions stay uncontrolled, only visible.** Any selling role can still lower a price without
  a limit. The design makes it traceable (who, how much, when) but doesn't stop it. See §15.
- **Credit sales attribution.** `pricedById` moves to the marker only when mark-paid changes the amount or
  applies a discount. A seller who agreed a low price and a colleague who confirmed it unchanged → the
  seller is shown, which is the intended reading.
- **Soft online limits.** `maxUses` / `oncePerMember` can be exceeded by checkouts open at the same moment
  (the 30-minute pending window). The honest alternative, refusing paid money, is worse.
- **Shared codes.** A code posted publicly is usable by any member until archived or exhausted. Owners
  should set `maxUses` / dates for campaigns. The throttle only slows guessing.
- **Family graph gaps.** Families without a guardianship link aren't detected. A wrong or stale link (a
  guardian who left the club) still counts while the relative is a current member with an abonement.
- **Forecast after promos** reads low for those members' next renewal (latest `amountPaid`).
- **Mixed currencies.** FIXED discounts apply only to items in their currency. Totals are per currency, as in
  E1.
- **E1 dependency.** If E1 phase B slips, S2's journal/CSV parts wait. The staff/online pricing (S1, most of
  S2) doesn't depend on refunds.

## 15. Open questions for the owner

1. **Should only owners/admins be allowed to type an amount that differs from the price** (at a sale, at
   mark-paid, on tickets)? Coaching roles would then pick a club discount or sell at the price. This
   design keeps today's rule and only makes reductions visible.
   - **For restricting:**
     - Q1 gave the head coach «no prices», and a free amount is a price decision.
     - Discounts from the list carry the owner's limits (dates, uses, once per member); a typed amount has
       none.
     - A cash part-payment already loses the remainder silently: there is no debt tracking, so «received
       less» is a discount in all but name.
     - With «Кто давал скидки» in place, the owner can first see how often it happens and then decide on
       data.
   - **Against restricting:**
     - Coaches selling at the reception lose a working flow, and partial cash would then be recorded as
       the full price, which overstates cash in the journal, or left unpaid until an admin comes.
   - **If yes:** one handler condition in assign, mark-paid and ticket mark (`isClubAdmin` when amount ≠
     priced → 403 «Сумму меняет только администратор клуба — выберите скидку из списка»), a
     `canSetAmount` flag in `listSaleDiscounts` and `list-member-subscriptions` `permissions`, and the
     amount field shown read-only to others in admin and mobile. About half a day, no schema change.
