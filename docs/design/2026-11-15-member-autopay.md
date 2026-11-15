# Member autopay — recurring abonements (backlog E2)

Status: **design** · 2026-11-15 · base: `feat/payments-journal` @ `7b41e414` (E1 phase A in progress)
Parent: [admin cleanup](2026-11-08-admin-cleanup.md) §9 E2 (owner: «стартуй разработку», order
E1 → E6 → E3 → E2). Evidence: [stability audit](2026-11-08-admin-audit-stability.md) «Depth», row
«Recurring member billing / autopay» (`:176`); [UX audit](2026-11-08-admin-audit-ux.md) §5 row
«Автосписание» (`:194`). Siblings: [payments journal](2026-11-15-payments-journal.md) (E1; this design keeps
its money rule, `Refund` model and revenue formula), [requests inbox](2026-11-15-requests-inbox.md) (E6),
discounts (E3, `DiscountsDesign`; contract agreed in §2.4). File:line references are as of `7b41e414`.
The owner was asleep while this was written. Every choice the owner would normally make is listed in
§12 «Decisions» and may be overruled.

## Кратко (для владельца)

Сейчас ученик платит за абонемент онлайн только вручную: каждый месяц нужно открыть приложение и нажать
«Оплатить». Автосписание есть только у самого клуба, когда он платит ClubSpace.

Что сделаем:
1. **Автоплатёж по желанию ученика.** Клуб включает автоплатежи в настройках оплаты, а потом отмечает
   тарифы, которые можно так продлевать. При оплате такого тарифа в приложении ученик сам ставит галочку
   «Продлевать автоматически». Под ней видны условия: сколько будем списывать, когда, как отключить.
   Карту сохраняет ЮKassa. У нас хранится только её номер-ссылка и последние 4 цифры.
2. **Когда списываем.** Абонемент на срок продлевается за день до окончания. Пакет занятий продлевается,
   когда занятия закончились или вышел срок. За 3 дня до списания ученик получает напоминание с суммой.
   Списываем днём, с 10 до 20 часов по времени клуба.
3. **Если списание не прошло,** повторим ещё три раза за пять дней. Ученик получит уведомление и письмо.
   Администраторы увидят его в «Удержание → Продлить» отдельным блоком «Автоплатёж не прошёл». Долгов
   сами не создаём: пока деньги не пришли, новый абонемент не выдаём.
4. **Отключить можно в любой момент** в приложении, одной кнопкой, даже если доступ уже закончился.
   Так требует закон о защите прав потребителей (с 1 марта 2026). Администратор тоже может отключить
   автоплатёж по просьбе ученика. Если клуб поднял цену или поменял тариф, мы не спишем новую сумму,
   пока ученик сам её не подтвердит. Если цена снизилась, списываем меньше.
5. **Чеки** по 54-ФЗ отправляет ЮKassa, как и сейчас при онлайн-оплате. Каждое списание видно в
   «Платежах» с пометкой «автоплатёж» и входит в выручку как обычная онлайн-оплата. Возврат делается
   там же.

Только для ЮKassa. Stripe, оплату за детей и списание по кнопке администратора не делаем (почему — в
§12). Перед запуском клубу нужно попросить менеджера ЮKassa включить автоплатежи в магазине. Без этого
ЮKassa не сохранит карту.

## Problem

1. **Members can only pay one period at a time.** `POST workspaces/:id/payments` creates a one-off
   redirect payment (`create-payment.handler.ts:120-135` → `start-provider-payment.ts:24-105`). The
   abonement is created only by the webhook (`payment-activation.service.ts:188-308`). The app shows a
   per-tariff «Оплатить» button (`apps/mobile/src/features/payments/OnlinePurchaseSection.tsx:116-118,260`).
   No member card token, renewal flag or member charge job exists anywhere (stability audit `:176`;
   `Plan` has no recurring field, `schema.prisma:2119-2170`).
2. **The pieces exist, but only for club → ClubSpace.**
   - The gateway can save a card and charge it: `savePaymentMethod` / `paymentMethodId`
     (`payment-gateway.types.ts:45-50`) → `save_payment_method` / `payment_method_id`
     (`yookassa-api.ts:94-99`). The parsed answer carries `paymentMethod.saved/id/title/cardLast4` and
     `cancellationReason` (`yookassa-api.ts:185-193`).
   - The hourly renewal pass and the idempotent per-period charge are platform-only:
     `platform-autopay.processor.ts:10-51`, `platform-autopay.service.ts:28-91`,
     `platform-payments.service.ts:740-927`. Retry spacing is `autopayRetryAt` (`billing-rules.ts:130-133`).
     Decline texts are `DECLINE_REASON_RU` (`platform-payments.service.ts:92-105`).
   - Club online payments ignore the saved method. `PaymentActivationService.applyProviderStatus` reads
     only status and amount (`payment-activation.service.ts:68-117`).
3. **Stripe can't do it today.** The Stripe adapter only builds a `mode: 'payment'` Checkout Session.
   It has no Customer, no `setup_future_usage` and no off-session PaymentIntent
   (`stripe-api.ts:62-90`), and `toGatewayPayment` returns no payment method (`stripe-api.ts:132-145`).
4. **One-off checkouts could save cards silently once a shop has autopay.** When ЮKassa enables autopay
   for a shop, its form offers to save the card on *every* payment unless the request says
   `save_payment_method: false`
   ([ЮKassa: автоплатежи](https://yookassa.ru/developers/payment-acceptance/scenario-extensions/recurring-payments/basics),
   [платёж без сохранения](https://yookassa.ru/developers/payment-acceptance/scenario-extensions/recurring-payments/pay-without-saving)).
   `buildYookassaCreatePayment` omits the field for redirect payments (`yookassa-api.ts:96-99`).
5. **Law and provider rules.**
   - 376-ФЗ (art. 16.1 ЗоЗПП, in force since 2026-03-01): once a consumer refuses, the seller may not use
     the saved card for periodic payments again, and must accept the refusal electronically
     ([КонсультантПлюс](https://www.consultant.ru/law/hotdocs/91121.html)).
   - ЮKassa requires the merchant to obtain consent first. The consent must state the schedule and
     amount and how to opt out, and the shop must be enabled by a ЮKassa manager
     ([ЮKassa: порядок интеграции](https://yookassa.ru/developers/payment-acceptance/scenario-extensions/recurring-payments/basics)).
   - Nothing in the member app collects such consent today.

## Goal / non-goals

**Goal.** A member of a club with ЮKassa can opt in, when paying online for a tariff the club marked,
to have the same tariff renewed from the saved card. The member always knows the next date and amount,
and can switch it off in one tap at any time. Staff see who is on autopay and whose charge failed. Every
charge is an ordinary online sale in the E1 journal and revenue.

**Non-goals.**
- **Stripe autopay.** Not built (§12).
- **Paying for a dependent online.** The checkout already refuses child profiles
  (`create-payment.handler.ts:112-119`) and the app hides the purchase block while acting for a child
  (`MySubscriptionScreen.tsx:172-174`). Autopay inherits that; it comes with child online payments.
- **Staff-initiated charges** («Списать сейчас») and charging cards entered by staff. Only the server
  job charges, only on agreed terms.
- **Binding a card without a purchase** (ЮKassa zero-amount binding, or the platform's 1 ₽ `CARD_CHECK`,
  `platform-payments.service.ts:283-288`). Autopay starts with an online purchase.
- **Changing the card while autopay works.** «Отключить», then tick the box at the next online payment
  (§6). A failed autopay is re-armed by paying with a new card.
- **Automatic debts.** A failed charge never creates an unpaid abonement («Ожидает оплаты» stays a staff
  sale; `renewal-rules.ts:13-17`).
- **Automatic refunds.** Refunds stay the E1 staff action (`POST refunds`).
- **New revenue metrics or glossary rows.** An autopay sale is an online sale.
- **Proration, plan switching mid-term, family billing.** Family *discounts* are E3 (§2.4).

## Ground rules

As in the [parent spec](2026-11-08-admin-cleanup.md#ground-rules-for-the-implementer):
- `CLAUDE.md` + `docs/conventions.md` are authoritative.
- `prisma db push` only, without `--accept-data-loss`. Nothing to backfill.
- Authorize in the handler.
- `serialize*` DTOs; unique controller-method and DTO names.
- Regenerate the contract.
- UI rules (one filled button per view, blocks only when true, Russian copy, `pluralRu`).
- Money and settings are `CLUB_ADMINS`. Reading an abonement's autopay state is `SPORT_LEADS`, with
  amount and card stripped for non-club-admins (conventions §1 tier rule).

## 1. Rules (the contract every slice follows)

**Agreement.**
- One member + one tariff + one saved payment method + agreed terms = a `MemberAutopay` row.
- At most one live (not cancelled) agreement per member and tariff.
- Setting up an agreement on a tariff whose scope equals another live agreement's scope (`sameScope`,
  `current-subscriptions.ts:71`) cancels the older one (the member switched tariff). Two agreements can
  never renew the same abonement.

**What the next charge renews (the anchor).**
- Each pass computes the anchor: the member's latest same-scope abonement that is held and not
  `CANCELLED`, current or ended within `RENEWAL_LAPSED_DAYS` (30, `renewal-rules.ts:38`).
- It is the abonement `onlineGrantStart` (`online-grant-start.ts:60-92`) renews from.
- A same-scope abonement sold by staff (cash) or bought by the member moves the anchor, so autopay
  never charges for a period already paid.

**When a charge is due.** All times are club-local (`workspace.timezone`, `wallClockToUtc` /
`localDateInTz`). `S` = the club-local day the renewal starts = `localDateInTz(anchor.endDate)`, the
same day `onlineGrantStart` uses.

| Anchor | Due at | Pre-charge reminder |
|---|---|---|
| Time-based (`classesTotal = null`) | `S − 1` 10:00 | `S − 4` 10:00 (3 days before the charge) |
| Class pack | the first of: classes used up (`classesRemaining ≤ 0`) and the last deducting check-in ≥ 1 h old; or `S` 10:00 (term over, unused classes lapse as today, `schema.prisma:2010-2013`) | `S − 4` 10:00 if classes remain; plus one notice when `classesRemaining` reaches 1 |
| Waiting for its first visit (`startDate = null`) | never (no end to renew from; `onlineGrantStart` refuses it) | — |

- Charges and reminders run only between 10:00 and 20:00 club-local. A due item outside the window
  waits for the next window.
- A pack is never charged while classes remain and the term runs: `onlineGrantStart` refuses that sale,
  because the classes would be lost.
- The one-hour wait after the last check-in lets a coach undo a mistaken mark (unmark refunds the class,
  `schema.prisma:2011-2012`).

**Amount.**
- `amount = priceSale({ listPrice: plan.price, discount: resolveAutomaticDiscount(...) }).amount` (E3,
  §2.4).
- Charge only if `amount ≤ termsAmount`, `plan.durationDays = termsDurationDays` and
  `plan.classCount = termsClassCount`. A lower amount is charged and lowers `termsAmount`.
- Anything else (price up, family discount lost, shorter term, fewer classes) → `NEEDS_ACTION /
  TERMS_CHANGED` and no charge until the member accepts the new terms in the app.

**Retries.** Attempt 1 is at the due time. After a decline the next attempts are at 10:00 on: the next
day, the day after, then two days later. So attempts are `S − 1`, `S`, `S + 1`, `S + 3` for a time-based
anchor. After the 4th decline: `NEEDS_ACTION / CHARGE_FAILED`.

| Decline reason | Handling |
|---|---|
| `permission_revoked` | cancel at once (`SYSTEM`); the token is wiped |
| `card_expired` | `NEEDS_ACTION` at once |
| network error / 5xx | not a decline: the same request (same Idempotence-Key) is re-sent next pass, as the platform does (`platform-payments.service.ts:736-739,768`) |
| anything else | counted; the next retry is scheduled |

**After the term ends without payment.**
- The member simply has no abonement. Access follows the existing rules.
- A later successful attempt or re-arm grants a new abonement from *now* (`onlineGrantStart` → `now`).
  The member never pays for days they didn't have.
- An agreement still not charged `RENEWAL_LAPSED_DAYS` after `S` is cancelled (`SYSTEM`, «давно не
  продлевался»): the member left.

**Cancellation** stops future charges immediately. It wipes `paymentMethodId` in the same write, and
nothing can charge a cancelled agreement. The current, already paid abonement is untouched. Who and
what cancels:
- the member;
- staff on the member's request;
- `SYSTEM`, when:
  - membership ends or the account is deleted;
  - the tariff is retired or loses `purchasableOnline` / `autopayAvailable`;
  - the club turns autopay off, changes provider or shop, or disconnects payments;
  - staff cancel the anchor abonement and no other same-scope current abonement exists;
  - `permission_revoked`;
  - the lapse above;
  - a newer same-scope agreement replaces it.

**Freezes.**
- A freeze moves `endDate` forward in its transaction (`schema.prisma:2074-2081`,
  `subscription-freeze.service.ts:264-269`), so `S`, the reminder and the charge move with it. No
  special case.
- A frozen abonement is never due, because its end is past the freeze.

**Club gates.** A pass charges nothing for a club that is not entitled to `ONLINE_PAYMENTS`
(`isWorkspaceEntitled`, `create-payment.handler.ts:47`) or has the abonement section off. Its
agreements are skipped, not cancelled, and resume when the club does.

## 2. Data model (Prisma, additive; `db push` without `--accept-data-loss`)

### 2.1 New table

```prisma
enum MemberAutopayStatus {
  ACTIVE        // charges when due
  NEEDS_ACTION  // stopped until the member acts (needsActionReason)
  CANCELLED     // final; paymentMethodId wiped
}

// A member's consent to renew one tariff from a payment method saved by the
// club's provider (YooKassa). Only the provider's token and display hints are
// kept — never card data. Created by the activation of the setup payment;
// charged by MemberAutopayService (domains/autopay). Sport-agnostic: renews
// whatever the tariff grants (term or class pack).
model MemberAutopay {
  id          String    @id @default(uuid()) @db.Uuid
  workspaceId String    @db.Uuid
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  // The member. Restrict like Payment.userId: account deletion de-identifies
  // the User row (and cancels this agreement first), it never deletes it.
  userId String @db.Uuid
  user   User   @relation("MemberAutopays", fields: [userId], references: [id], onDelete: Restrict)

  // SetNull keeps the history if the tariff is deleted (the agreement is
  // cancelled before); planName is the snapshot shown in lists.
  planId   String? @db.Uuid
  plan     Plan?   @relation(fields: [planId], references: [id], onDelete: SetNull)
  planName String  @db.VarChar(255)

  // `${userId}:${planId}` while not CANCELLED, null after: one live agreement
  // per member and tariff (unique on a new table — conventions §5).
  liveKey String? @unique @db.VarChar(80)

  status            MemberAutopayStatus @default(ACTIVE)
  // CHARGE_FAILED | CARD_EXPIRED | TERMS_CHANGED | GRANT_REFUSED; null when ACTIVE/CANCELLED.
  needsActionReason String?             @db.VarChar(32)

  provider           PaymentProvider          // YOOKASSA only (Decisions)
  // YooKassa payment_method.id; null once cancelled (376-ФЗ: never reused).
  paymentMethodId    String? @db.VarChar(64)
  paymentMethodTitle String? @db.VarChar(64)  // «Bank card *4444», for display
  cardLast4          String? @db.VarChar(4)
  // The shop the token belongs to; a different shopId in the settings cancels.
  shopId             String  @db.VarChar(64)
  // Receipt e-mail at consent; a charge uses the member's current e-mail first.
  receiptEmail       String  @db.VarChar(255)

  // The terms the member agreed to: renewal amount (after automatic
  // discounts, without one-off promos — §2.4), term, pack size.
  termsAmount       Int
  currency          String  @db.Char(3)
  termsDurationDays Int
  termsClassCount   Int?
  consentVersion    String   @db.VarChar(64)   // AUTOPAY_CONSENT_VERSION shown
  consentedAt       DateTime                   // setup or last terms acceptance

  // Declines in a row for attemptAnchorId; reset by a success or a new anchor.
  failedAttempts  Int       @default(0)
  attemptAnchorId String?   @db.Uuid
  nextAttemptAt   DateTime?
  lastError       String?   @db.VarChar(500)   // Russian decline text
  lastChargedAt   DateTime?

  cancelledAt   DateTime?
  cancelSource  String?  @db.VarChar(16)  // MEMBER | STAFF | SYSTEM
  // Display only, no FK (like markedPaidById): the staff member who cancelled.
  cancelledById String?  @db.Uuid
  cancelReason  String?  @db.VarChar(200)

  payments Payment[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([workspaceId, status])
  @@index([status, nextAttemptAt])  // the pass
  @@index([workspaceId, userId])
  @@index([planId, status])         // tariff edits, tariff page count
}
```
Back-relations: `Workspace.memberAutopays`, `User.memberAutopays @relation("MemberAutopays")`,
`Plan.autopays`.

### 2.2 New columns on existing tables (all nullable or defaulted)

```prisma
model Plan {
  // Members may opt in to renew this tariff automatically when paying online.
  // Needs purchasableOnline and the club's autopayEnabled. Off by default.
  autopayAvailable Boolean @default(false)
}

model WorkspacePaymentSettings {
  // The club offers member autopay (YooKassa only). The admin confirms that
  // YooKassa enabled autopay in the shop and that the club's own offer to
  // members covers it. Off by default.
  autopayEnabled     Boolean   @default(false)
  // Last refusal of an autopay setup by YooKassa (e.g. the shop isn't
  // enabled); shown in the settings card, cleared when the toggle is saved.
  autopayLastError   String?   @db.VarChar(500)
  autopayLastErrorAt DateTime?
}

model Payment {
  // The agreement this payment set up (setup checkout) or charged (renewal).
  autopayId             String?        @db.Uuid
  autopay               MemberAutopay? @relation(fields: [autopayId], references: [id], onDelete: SetNull)
  // Set on a checkout where the member ticked autopay: the consent text
  // version shown. The activation creates the agreement from it.
  autopayConsentVersion String?        @db.VarChar(64)
  // Why the provider refused (YooKassa cancellation_details.reason).
  failureReason         String?        @db.VarChar(500)

  @@index([autopayId])
}
```
- `Payment.idempotenceKey` stays `VarChar(64)`. The renewal key `autopay:<anchorUuid>:<attempt>` is
  ≤ 48 characters.
- No change to `Subscription`. An autopay sale is a normal `GATEWAY` / `ONLINE` abonement, linked through
  `Payment.subscriptionId` and `Payment.autopayId`.
- No new enum value on existing enums; `MemberAutopayStatus` is new.
- No backfill and no `migrations()` entry.

### 2.3 Consent text (code, versioned)

`domains/autopay/autopay-consent.ts`:
- `AUTOPAY_CONSENT_VERSION = '2026-11-15'`.
- `autopayConsentLines({ clubName, amountNow, renewalAmount, currency, durationDays, classCount })` →
  string[].
- The server returns the lines in the purchase options (§3.3). The app renders them verbatim, so the text
  has one source, and the version the member saw is the version recorded.

Text (time-based / pack):
> **Продлевать автоматически**
> Сейчас спишем {amountNow}. Дальше клуб «{club}» будет списывать {renewalAmount} с этой карты за
> каждый следующий абонемент «{plan}»: за день до окончания срока / когда закончатся занятия или срок.
> За 3 дня до списания пришлём напоминание. Отключить автоплатёж можно в любой момент в разделе
> «Мой абонемент» — следующих списаний не будет. Если клуб изменит цену или условия тарифа, спишем
> новую сумму только после вашего подтверждения. Данные карты хранит ЮKassa, клуб и ClubSpace их не
> видят. [Условия автоплатежа]

The link opens the public page `/legal/autopay` (§5.3).

### 2.4 Discounts (E3 contract, agreed with `DiscountsDesign`)

- Sale rows gain `listPrice`, `discountId`, `discountName`, `discountAmount` (E3). Autopay `Payment`
  rows and the abonements they grant set all four through `priceSale`, like any online sale.
- **`termsAmount` is the renewal price, not the first sale's amount.**
  - At a checkout with autopay, the server computes `renewalAmount = priceSale({ listPrice: plan.price,
    discount: resolveAutomaticDiscount(...) })`: automatic (family) discount only, no promo code, no
    staff discount.
  - The consent shows «сейчас X ₽ · дальше Y ₽». `termsAmount = Y`.
  - So a promo-priced first sale does not trigger `TERMS_CHANGED`.
- At each charge the same function runs again. A member who lost the family discount sees the rise as
  `TERMS_CHANGED`.

## 3. Server

### 3.1 Domain — `domains/autopay/`

| File | Content |
|---|---|
| `autopay-rules.ts` (+spec) | pure: `pickAnchor(subs, planScope, now)`; `autopayDueAt(anchor, tz, lastConsumedAt)` (§1 table); `inChargeWindow(now, tz)` (10–20 local); `reminderAt(anchor, tz)`; `autopayRetryAt(now, tz, failedAttempts)` → next 10:00 local after +1, +1, +2 days, or `null` after the 4th; `termsCheck(agreement, plan, amount)` → `'ok' \| 'lower' \| 'changed'`; `MAX_AUTOPAY_ATTEMPTS = 4`, `AUTOPAY_WINDOW = { from: 10, to: 20 }`, `AUTOPAY_REMINDER_DAYS = 3` |
| `autopay-consent.ts` | §2.3 |
| `member-autopay.service.ts` (+spec) | `runCharges(now)`, `runReminders(now)`, `chargeOne(id, now)`, `setUpFromPaymentInTx(tx, payment, gateway, sub)`, `onChargeSucceededInTx`, `onChargeDeclined(payment, reason, now)`, `onGrantRefused(payment, reason)`, `cancel({ id, source, actorId?, reason })`, `cancelForUser(...)`, `cancelForPlan(...)`, `cancelForWorkspace(...)`, `notifyTermsChanged(planId)` |
| `member-autopay.processor.ts` (+spec) | the BullMQ job (§3.2) |
| `autopay-notifications.ts` | texts + `notifyUser` / e-mail calls (§3.6) |
| `autopay-recipients.ts` | staff recipients: owner + ACTIVE `CLUB_ADMINS` members (owner has no member row; copies `findFreezeRequestDeciders`, `freeze-request-recipients.ts:8-35`) |

`DECLINE_REASON_RU` and `declineReasonRu` move from `platform-payments.service.ts:92-105` to
`domains/payments/decline-reasons.ts`, and both callers import them from there. Two new entries are
added: `card_expired` «срок действия карты истёк», `permission_revoked` «владелец карты запретил
автосписания».

### 3.2 The job

```ts
export const MEMBER_AUTOPAY_QUEUE = 'scheduler-member-autopay'
// Same shape as PLATFORM_AUTOPAY_QUEUE: one queue, one scheduler upserted by
// id, global concurrency 1 across replicas. Hourly at :40 (the platform pass
// is :20), so a due item is picked within the hour of its club-local window.
@Processor(MEMBER_AUTOPAY_QUEUE)
export class MemberAutopayProcessor extends WorkerHost implements OnModuleInit {
  onModuleInit: setGlobalConcurrency(1); upsertJobScheduler(name, { pattern: '40 * * * *', tz: 'UTC' },
    { name, opts: { removeOnComplete: { count: 50 }, removeOnFail: { count: 200 } } })
  process: if (!environment.memberAutopay.enabled) return
           charges = await autopay.runCharges(now); reminded = await autopay.runReminders(now); log counts
}
```
Registered like `PlatformAutopayProcessor` (`BullModule.registerQueue` in the billing module's sibling).
The service, processor and queue go in `app.module.ts`.

**Why one hourly pass, not a delayed job per charge.** Due times derive from rows that change under
the job: freezes move `endDate`, staff sell renewals, check-ins empty packs, prices change. A delayed
job would have to be rescheduled by every one of those writers. The pass reads the truth each hour. It
is idempotent per anchor and attempt, the same proven shape as the platform pass. A crashed or
overlapping run charges nothing twice.

**`runCharges(now)`:**
- Candidates: `MemberAutopay where { status: 'ACTIVE', OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] }`.
  The club's settings must have `autopayEnabled` and provider `YOOKASSA`.
- Ordered by `nextAttemptAt` nulls first, then `id`. At most `MAX_CHARGES_PER_RUN = 200`; the rest wait
  an hour.
- Each candidate goes through `chargeOne` in `try/catch`. One failure never stops the run (platform
  pattern, `platform-autopay.service.ts:76-89`).
- Returns `Partial<Record<'CHARGED'|'PENDING'|'DECLINED'|'SKIPPED'|'NEEDS_ACTION'|'CANCELLED', number>>`.

**`chargeOne(id, now)`**, in order (each refusal returns an outcome with a reason, for logs and specs):
1. Load the agreement with its workspace (tz, type, `subscriptionEnabled`, entitlement, owner), payment
   settings and plan (price, currency, `durationDays`, `classCount`, `isActive`, `purchasableOnline`,
   `autopayAvailable`, directions). Also load the member's `WorkspaceMember` with same-scope
   abonements (`onlineGrantAbonementSelect` + `classesRemaining` + the latest consumed check-in time)
   and the user (e-mail, deletion state).
2. **Cancel** (`SYSTEM`, with notice) when:
   - there is no member row;
   - the plan is gone or retired, or lost `purchasableOnline` or `autopayAvailable`;
   - the club setting is off;
   - `settings.provider ≠ YOOKASSA` or `settings.shopId ≠ agreement.shopId`.
   These cases are also cancelled eagerly by their writers (§3.5). The pass is the safety net.
3. **Skip** without a state change when the club is not entitled or the section is off.
4. Anchor = `pickAnchor`.
   - None, or not due (`autopayDueAt > now`), or outside the window → skip.
   - Anchor ended more than `RENEWAL_LAPSED_DAYS` ago → cancel (`SYSTEM`).
   - Anchor `CANCELLED` by staff with no other same-scope current one → cancel (normally done eagerly,
     §3.5).
5. If `attemptAnchorId ≠ anchor.id`, reset `failedAttempts = 0` (`updateMany` CAS on the old values).
   This is a new cycle.
6. Amount = `priceSale(...)`. `termsCheck`:
   - `changed` → `NEEDS_ACTION / TERMS_CHANGED`, notify once per anchor
     (`claim('subscription.autopay_terms_changed', ${id}:${anchor.id})`), stop.
   - `lower` → continue with the lower amount; `termsAmount` is lowered when the charge succeeds.
7. `onlineGrantStart(...)` → `blocked` → skip (defensive; the due rules exclude it).
8. **In-flight guard** (`platform-payments.service.ts:839-861` pattern). Skip if the member has a
   `PENDING` `Payment` for this plan that is either:
   - a member checkout younger than `PENDING_REUSE_MS`; or
   - an autopay charge with `providerPaymentId` younger than 3 days.
9. `idempotenceKey = autopay:${anchor.id}:${failedAttempts}`. `findUnique`:
   - exists and (not `PENDING` or has `providerPaymentId`) → skip «уже списано»;
   - exists and younger than 10 min → skip «уже списывается»;
   - exists, older → re-send with the same key;
   - absent → `payment.create` with:
     - `autopayId`, `planId`, `planName`, `amount`, `currency`;
     - `provider: 'YOOKASSA'`;
     - `receiptEmail = user.email ?? agreement.receiptEmail`;
     - the E3 price fields.
     A P2002 on the key → skip.
10. `gateway.createPayment(creds, { …, paymentMethodId, returnUrl: environment.appUrl, customerEmail,
    itemName: \`Абонемент «${plan.name}»\`, description: \`Автоплатёж: абонемент «${plan.name}» — ${club}\` })`.
    The receipt is built by `buildYookassaReceipt` when `receiptEnabled` (`yookassa-api.ts:105-107`).
    - `PaymentGatewayError` with status `null` or ≥ 500 → leave `PENDING`, outcome `SKIPPED`
      «не ответила — повторим».
    - Other 4xx → decline with `providerMessage`.
11. Store `providerPaymentId`, then hand the answer to `PaymentActivationService.applyProviderStatus` —
    the same path as the webhook (§3.4). A `pending` answer (e.g. «сначала чек, потом платёж»,
    [ЮKassa: проведение автоплатежа](https://yookassa.ru/developers/payment-acceptance/scenario-extensions/recurring-payments/pay-with-saved))
    is settled later by the webhook.

**`runReminders(now)`**:
- Scans `ACTIVE` agreements of enabled clubs. For each anchor whose `reminderAt ≤ now < dueAt`, inside
  the window, it sends `subscription.autopay_reminder` once per anchor
  (`claim(kind, ${id}:${anchor.id})`).
- Text: «Через 3 дня, {date}, клуб «X» спишет {amount} за абонемент «{plan}» с карты •• 4444.
  Отключить — в «Мой абонемент».» A lower price says «(цена снизилась)».
- If the terms changed, the reminder is replaced by the terms-changed notice (step 6 semantics) at
  reminder time. The member then has 3 days to confirm before the charge.
- Packs get one more notice at `classesRemaining = 1` (refId `${id}:${anchor.id}:low`): «Осталось одно
  занятие. Когда оно пройдёт, спишем {amount} за новый абонемент «{plan}».»

### 3.3 Member checkout and purchase options (`features/online-payments/`)

- **`CreatePaymentInput`** gains:
  - `autopay: z.boolean().default(false)`;
  - `autopayConsentVersion: z.string().max(64).optional()`, required by `superRefine` when `autopay`.
  In `create-payment.handler.ts`, with `autopay = true`:
  - refuse with 400 when unavailable: settings provider `≠ YOOKASSA`, club `autopayEnabled` off, plan
    `autopayAvailable` off → «Автоплатёж для этого тарифа недоступен»;
  - refuse with 400 when the version is stale: `autopayConsentVersion ≠ AUTOPAY_CONSENT_VERSION` →
    «Условия автоплатежа обновились — обновите экран»;
  - a live agreement on this plan in `ACTIVE` → 400 «Автоплатёж по этому тарифу уже включён». A
    `NEEDS_ACTION` one is allowed: paying re-arms it with the new card.
  - The `recent` reuse (`create-payment.handler.ts:89-106`) also matches on
    `autopayConsentVersion: autopay ? { not: null } : null`. A tap with the other choice never reuses
    the wrong payment.
- **`startProviderPayment`** (`start-provider-payment.ts`) takes `savePaymentMethod: boolean | null`
  and stores `autopayConsentVersion` on the `Payment`.
  - Autopay → `true`. ЮKassa then uses mandatory saving and warns on its own form.
  - A one-off payment in a club with `autopayEnabled` → `false`, so a card is never saved without our
    consent. Clubs without it → field omitted, as today.
  - A 4xx from ЮKassa on an autopay checkout:
    - writes `settings.autopayLastError/At`;
    - notifies club admins once a day (`claim('subscription.autopay_setup_refused', ${workspaceId}:${ymd})`);
    - returns 400 «Не удалось подключить автоплатёж — оплатите без него или обратитесь в клуб».
- **`buildYookassaCreatePayment`** (`yookassa-api.ts:94-99`): `savePaymentMethod` becomes tri-state.
  `true` → `save_payment_method: true`; `false` → `save_payment_method: false`; `undefined` → omitted.
  `CreateGatewayPaymentInput.savePaymentMethod` is retyped `boolean | undefined`, and its comment loses
  «The platform's own billing only».
- **`GET me/online-purchase`** (`get-online-purchase-options.handler.ts:143-157`). Each plan gains
  `autopay: { renewalAmount, consentVersion, consentLines: string[] } | null`. It is non-null when the
  club and plan allow it, the provider is ЮKassa, and the member has no `ACTIVE` agreement on that plan.
  The top level gains `autopayTermsUrl` (`${appUrl}/legal/autopay`) or `null`.

### 3.4 Activation (`domains/payments/services/payment-activation.service.ts`)

`PaymentRow` gains `autopayId`, `autopayConsentVersion`. `applyProviderStatus` keeps its flow:

- **Success, abonement granted** (`activate`, `:188-308`), inside the claim transaction:
  - **Setup** (`autopayConsentVersion` set):
    - if `gateway.paymentMethod?.saved && id` → `setUpFromPaymentInTx`:
      - cancel any live same-scope agreement of the member (`SYSTEM`, «заменён новым автоплатежом»);
      - re-arm this plan's `NEEDS_ACTION` row or create a row with token, title, last4, `shopId`,
        `receiptEmail`, `termsAmount` (the `renewalAmount` recomputed with the same E3 function),
        `termsDurationDays = sub.durationDays`, `termsClassCount = sub.classesTotal`, `consentVersion`,
        `consentedAt = payment.createdAt`;
      - set `payment.autopayId`.
    - If nothing was saved, the abonement stands, no agreement is made, and the push says it (§3.6).
  - **Renewal charge** (`autopayId` set, no consent version) → `onChargeSucceededInTx`:
    - `failedAttempts 0`, `attemptAnchorId/nextAttemptAt/lastError null`, `lastChargedAt now`;
    - `status ACTIVE`, `needsActionReason null`;
    - `termsAmount = min(termsAmount, payment.amount)`.
  - The member push text depends on the case (§3.6). Audit `payment.succeeded` metadata gains
    `autopayId` and `autopay: 'setup' | 'charge'`.
- **Canceled** (`:87-96`): `failureReason = gateway.cancellationReason` in the same `updateMany`. When
  `autopayId` is set and the payment is not a setup → `onChargeDeclined`:
  - `failedAttempts + 1`, `attemptAnchorId`, `lastError = declineReasonRu(reason)`;
  - the reason rules of §1: `permission_revoked` → cancel; `card_expired` or the 4th decline →
    `NEEDS_ACTION`; otherwise `nextAttemptAt = autopayRetryAt(...)`;
  - audit `autopay.chargeFailed`;
  - member notice every time; staff notice on the first decline and on the move to `NEEDS_ACTION`.
- **Paid, not granted** (`recordUnactivated`, `:313-351`): e.g. staff sold a same-scope pack seconds
  earlier. E1's unapplied flow stays: `activationError`, the journal strip, staff refund. A renewal
  charge additionally → `onGrantRefused`: `NEEDS_ACTION / GRANT_REFUSED`, plus a staff notice «Списали
  N ₽ автоплатежом, но абонемент не оформлен: {reason}. Верните деньги в «Платежах» или оформите
  абонемент вручную». A setup payment that isn't granted creates no agreement.
- The webhook handlers are unchanged. Autopay payments carry the same `metadata.paymentId/workspaceId`
  (`yookassa-api.ts:101-104`), and the ЮKassa handler re-reads the payment with the club's credentials
  (`handle-yookassa-webhook.handler.ts:27-89`). The re-read includes `payment_method`.

### 3.5 Endpoints and writer hooks

New slice `features/member-autopay/`:

| Endpoint | Method name | Tier | DTOs | Audit |
|---|---|---|---|---|
| `GET workspaces/:workspaceId/me/autopays` (`@AllowExpiredAccess`) | `listMyAutopays` | any member (no `@Roles`) | out `ListMyAutopaysOutput` `{ data: MyAutopay[] }` | — |
| `POST workspaces/:workspaceId/me/autopays/:autopayId/cancel` (`@AllowExpiredAccess`) | `cancelMyAutopay` | any member; handler: `agreement.userId = user.userId` else 404 | out `MyAutopayOutput` | `autopay.cancelled` (source MEMBER) |
| `POST workspaces/:workspaceId/me/autopays/:autopayId/accept-terms` | `acceptMyAutopayTerms` | any member; own row; `NEEDS_ACTION / TERMS_CHANGED` or a pending rise | in `AcceptMyAutopayTermsInput` `{ amount, durationDays, classCount: int\|null, consentVersion }`, out `MyAutopayOutput` | `autopay.termsAccepted` |
| `GET workspaces/:workspaceId/members/:userId/autopays` | `listMemberAutopays` | `SPORT_LEADS` + `assertSportLead`; money stripped unless `isClubAdmin` | out `ListMemberAutopaysOutput` | — |
| `POST workspaces/:workspaceId/autopays/:autopayId/cancel` | `cancelMemberAutopay` | `SPORT_LEADS` + `assertSportLead` | in `CancelMemberAutopayInput` `{ reason: 1–200 }`, out `MemberAutopayOutput` | `autopay.cancelled` (source STAFF) |

- `@AllowExpiredAccess` on the member reads and on cancel: a member whose access ran out must still
  be able to refuse (376-ФЗ).
- `accept-terms` echoes what the screen showed. If the plan changed again meanwhile → 409 «Условия
  снова изменились — обновите экран». Success sets the terms, `consentVersion`, `consentedAt = now`,
  `status ACTIVE` (with `failedAttempts` kept).
- Cancel is idempotent: an already cancelled row returns itself.

DTOs:
- `MyAutopay` (member):
  - `id`, `planId`, `planName`, `status`, `needsActionReason`;
  - `cardLabel` («карта •• 4444» / «сохранённый способ оплаты»), `termsAmount`, `currency`;
  - `nextCharge: { on: z.iso.date(), amount, kind: 'term' \| 'pack' } | null` (computed by the rules;
    `pack` = «когда закончатся занятия или {date}»);
  - `lastError`, `nextAttemptOn`;
  - `newTerms: { amount, durationDays, classCount } | null` (when a rise is pending);
  - `consentedAt`, `cancelledAt`, `cancelSource`.
  The list returns live agreements plus those cancelled in the last 30 days (so the member sees the
  confirmation).
- `MemberAutopay` (staff) = the same plus `cancelReason`, `cancelledBy { userId, name } | null`, and
  `createdAt`. For non-club-admins, `termsAmount`, `newTerms.amount` and `cardLabel` are `null`
  (server-side strip, conventions §1).

**Hooks in existing writers** (eager cancel; the pass is the net). Each cancel writes the audit and
notifies the member:

| Writer | Hook |
|---|---|
| `manage-plans` update / archive / delete | price, `durationDays` or `classCount` changed and the new terms exceed a live agreement's → `notifyTermsChanged(planId)` after commit (immediate push, status unchanged until charge time); `isActive`/`purchasableOnline`/`autopayAvailable` turned off or plan deleted → `cancelForPlan` (`SYSTEM`, «клуб больше не продлевает этот тариф автоматически»). Plan output gains `autopayAvailable`; the plan detail (`get-plan.handler.ts`) gains `autopayCount` (live agreements) for club admins. `canSellOnline` (`manage-plans/schemas.ts`) also gates `autopayAvailable` |
| `update-payment-settings` / `delete-payment-settings` | `autopayEnabled` → false, provider or `shopId` changed, or disconnect → `cancelForWorkspace`; saving `autopayEnabled = true` clears `autopayLastError/At`. Output (`payment-settings-view.ts`) gains `autopayEnabled`, `autopayLastError`, `autopayLastErrorAt`, `autopayLiveCount` |
| `member-subscriptions/cancel-subscription.handler.ts:58` | after `subscriptions.cancel`, if the member has a live same-scope agreement and no other same-scope current abonement → cancel (`SYSTEM`, «абонемент отменён клубом») |
| `remove-workspace-member.handler.ts` | `cancelForUser(workspaceId, userId)` («участник больше не в клубе») |
| `delete-account.handler.ts` | `cancelForUser` in every club before de-identification (tokens wiped) |
| `list-awaiting-payment` (`SPORT_LEADS`) | output gains `autopayAttention: { total, data: [{ autopayId, member { userId, name }, planName, reason: needsActionReason, lastError, nextAttemptOn \| null, since }] }` — `NEEDS_ACTION` agreements plus `ACTIVE` ones with `failedAttempts > 0`, oldest first, capped at 50. No amount. Not part of the receivable (`countAwaitingPaymentMembers` unchanged) |
| `list-renewal-candidates` (`SPORT_LEADS`) | each row gains `autopay: { status, nextChargeOn } \| null`, so staff don't call a member whose renewal is on autopay |
| E1 `payment-journal` | `PaymentJournalEntry.online` gains `autopay: boolean` (`Payment.autopayId` set); the detail adds `cardLabel` |

`route-tier-consistency.spec.ts`:
- The `CLUB_ADMINS` list is unchanged (settings and plan routes already in it).
- The two `SPORT_LEADS` routes are checked by its tier scan.
- The member routes have no `@Roles`.

### 3.6 Notifications

New kinds, all under `subscription.`, so they are mute-exempt by prefix (`notification-mute.ts:7-14`).
They have no opt-out category (money), are best-effort (try/catch, as `notifyChargeFailed`,
`platform-payments.service.ts:685-731`) and use `feature: 'subscription'`. E-mails are EMAIL rows via
`NotificationsService.sendNotification`, as the platform does (`:709-723`).

| Kind | To | Push | E-mail | Copy (short) |
|---|---|---|---|---|
| `payment.succeeded` (existing) | member | ✓ | ЮKassa receipt | setup: «Абонемент «X» оформлен. Автоплатёж включён: следующее списание — {when}, {amount}.» / setup not saved: «…оформлен. Автоплатёж не подключился — платёжная система не сохранила карту.» / charge: «Автоплатёж: списали {amount} за абонемент «X». Действует до {date}.» |
| `subscription.autopay_reminder` | member | ✓ | ✓ | §3.2 |
| `subscription.autopay_failed` | member | ✓ | ✓ | «Не удалось списать {amount} за абонемент «X»: {reason}. Повторим {date}.» / last: «Автоплатёж остановлен. Оплатите абонемент в приложении — новая карта сохранится.» |
| `subscription.autopay_terms_changed` | member | ✓ | ✓ | «Клуб «Y» изменил тариф «X»: было {old}, стало {new}. Без вашего подтверждения деньги не спишутся. Подтвердить или отключить — в «Мой абонемент».» |
| `subscription.autopay_cancelled` | member | ✓ | ✓ | «Автоплатёж по тарифу «X» отключён{ — reason}. Следующих списаний не будет. Текущий абонемент действует до {date}.» (also on the member's own cancel: written confirmation of the refusal) |
| `subscription.autopay_staff_alert` | owner + club admins | ✓ | — | first decline / `NEEDS_ACTION` / grant refused / setup refused by ЮKassa; links to `retention?tab=renew` or `subscriptions/payments?entry=…` |

Mobile routing (`apps/mobile/src/features/notifications/notification-route.ts:90-96`): the four member
kinds → `gated("MySubscription")`. The staff alert has no mobile screen → `null` (inbox row only).
Retention (`domains/scheduler/data-purge.service.ts:27-29`): `subscription.autopay_reminder: 60`, the rest default.

## 4. Admin UI

**Settings → «Онлайн-оплата»** (`features/payments/PaymentSettingsCard.tsx`). This block renders only
for a connected ЮKassa. For Stripe there is one muted line: «Автоплатежи доступны только с ЮKassa».
- Checkbox «Автоплатежи для учеников». It is saved with the card's existing «Сохранить» (no new
  button).
- Hint: «Ученик сможет включить автопродление при оплате тарифа в приложении. Сначала попросите
  менеджера ЮKassa подключить автоплатежи в вашем магазине и добавьте условия автоплатежа в вашу оферту
  для учеников.»
- Turning it off with live agreements → `confirmDialog` (destructive): «Отключить автоплатежи?» ·
  «Автоплатёж отключится у {n} {pluralRu(ученика)}. Им придёт уведомление, деньги больше не будут
  списываться.»
- When `autopayLastError` is set: a destructive line «ЮKassa отказала в подключении автоплатежа
  {date}: {text}. Проверьте у менеджера ЮKassa, что автоплатежи включены.»

**Tariff form** (`features/subscriptions/PlanFormSheet.tsx:312-327`):
- Under «Можно купить онлайн», a checkbox «Можно продлевать автоплатежом». It is disabled unless
  «Можно купить онлайн» is on and the club setting is on.
- The disabled hint names the reason: «Включите автоплатежи в разделе «Онлайн-оплата»».
- On save, when `autopayCount > 0`:
  - the new price, term or pack size is less favourable → `confirmDialog`: «У {n} учеников
    автоплатёж по этому тарифу» · «Новые условия спишутся только после их подтверждения в приложении.
    Мы отправим им уведомление.»;
  - unticking autopay or online sale, or archiving → «Автоплатёж отключится у {n} учеников».
- The tariff page (`features/subscriptions/…` plan detail) shows one muted line «Автоплатёж у {n}
  {pluralRu}» only when n > 0.

**Member card** (`features/subscriptions/MemberSubscriptionPanel.tsx`). A self-contained
`MemberAutopayBlock.tsx` (own fetch of `listMemberAutopays`) renders under the abonements only when the
member has a live agreement or one cancelled within 30 days:
- line 1: «Автоплатёж «БЖЖ 12» · следующее списание 14 дек.» (pack: «когда закончатся занятия, не
  позже 14 дек.»). Club admins also see « · 4 000 ₽ · карта •• 4444».
- `NEEDS_ACTION`, destructive tone:
  - «Автоплатёж остановлен: {lastError}. Ученик может оплатить в приложении.»;
  - «Ждёт подтверждения новой цены 4 500 ₽» (club admins see the amount).
- `ACTIVE` with declines: «Не прошло списание {date}: {reason}. Повторим {date}.»
- Cancelled: muted «Автоплатёж отключён {date} — {учеником / {staff name} / автоматически: reason}».
- «⋯ → Отключить автоплатёж» (sport leads). It opens a dialog with «Причина» (required, e.g. «Попросил
  по телефону») and the destructive «Отключить». It is the panel's only destructive action for the block
  (UI rules).
- `features/subscriptions/subscription-display.ts:65` `paymentLabel` → «Онлайн · автоплатёж» when the
  abonement's payment came from an agreement (the staff abonement DTO gains `paidByAutopay: boolean`,
  `member-subscriptions/schemas.ts`).

**«Удержание → Продлить»** (`app/…/retention/renew-list.tsx:211-215`):
- Above «Ожидают оплаты», a block «Автоплатёж не прошёл · {n} {pluralRu(ученик)}» renders only when
  `autopayAttention.total > 0`.
- Rows: name · tariff · reason text · «повтор {date}» or «ждёт ученика». Row tap opens the member card.
  No buttons.
- A renewal row with autopay shows a muted second line «продлится автоплатежом {date}».

**«Деньги → Абонементы → Платежи»** (E1 journal):
- An autopay sale's method text is «Онлайн · автоплатёж».
- The entry panel's online facts add «Автоплатёж, карта •• 4444».
- Refund is the E1 form, unchanged. A refund never touches the agreement; the hint line adds
  «Автоплатёж останется включённым — отключить его можно в карточке ученика» when the sale is an autopay
  one.

**Audit labels** (`features/audit/audit-meta.ts`): `autopay.enabled` «Автоплатёж включён»,
`autopay.cancelled` «Автоплатёж отключён» (source, reason), `autopay.termsAccepted` «Новые условия
автоплатежа приняты», `autopay.chargeFailed` «Автоплатёж не прошёл»; settings key `autopayEnabled`
«автоплатежи для учеников»; plan key `autopayAvailable` «продление автоплатежом».

**Coaches:** nothing new. The block is on the sport-lead card; the plain coach's mobile abonement
screen is unchanged.

## 5. Mobile / client

### 5.1 Purchase (`apps/mobile/src/features/payments/OnlinePurchaseSection.tsx`)
- A plan with `autopay ≠ null` shows a switch row «Продлевать автоматически» above its «Оплатить»
  button. It is **off by default**: consent is never pre-ticked.
- Switching it on reveals `consentLines` (small text) and the «Условия автоплатежа» link
  (`autopayTermsUrl`, opened like the payment page, `open-payment-page.ts`).
- «Оплатить {price}» sends `{ planId, autopay: true, autopayConsentVersion }`. The button label is
  unchanged; one filled button per plan as today.
- A plan with an `ACTIVE` agreement shows «Автоплатёж включён» instead of the switch.
- The return screen (`PaymentReturnScreen.tsx`) appends «Автоплатёж включён: следующее списание
  {when}» or «Автоплатёж не подключился» from `MyPaymentOutput.autopay: 'on' | 'not_saved' | null`
  (`serializeMyPayment` gains it).

### 5.2 «Мой абонемент» (`features/subscription/MySubscriptionScreen.tsx`)

`AutopayCard.tsx` (own fetch of `listMyAutopays`) sits under the abonement cards and above «Оплатить
онлайн» (`:173`). It renders only with a live agreement or one cancelled in the last 30 days.
- `ACTIVE`: «Автоплатёж включён · карта •• 4444» / «Следующее списание 14 декабря — 4 000 ₽» (pack:
  «Когда закончатся занятия, но не позже 14 декабря — 4 000 ₽»). Outline «Отключить автоплатёж» →
  `Alert` «Отключить автоплатёж?» · «Следующих списаний не будет. Абонемент действует до {date}.» ·
  «Отключить» (destructive) / «Отмена».
- Declines pending: warn tone «Не удалось списать {date}: {reason}. Повторим {date}. Пополните карту
  или отключите автоплатёж.»
- `NEEDS_ACTION / TERMS_CHANGED`: «Клуб изменил тариф: было 4 000 ₽ за 30 дней, стало 4 500 ₽ за 30
  дней.» Filled «Подтвердить 4 500 ₽» (the screen's one filled button while shown) + text button
  «Отключить автоплатёж».
- `NEEDS_ACTION / CHARGE_FAILED | CARD_EXPIRED | GRANT_REFUSED`: «Автоплатёж остановлен: {reason}.
  Оплатите абонемент ниже — новая карта сохранится, и автоплатёж продолжится» + «Отключить
  автоплатёж». The switch in «Оплатить онлайн» is still required for the new card (fresh consent).
- Cancelled (≤ 30 days): muted «Автоплатёж отключён {date}» (+ reason when not the member's own).
- Hidden while acting for a child (`actingAs`), like the purchase block.
- The hint at `:198-201` gains «Отключить автоплатёж можно здесь же.» when a live agreement exists.
- The lock screen (expired access) renders `AutopayCard` too, so a lapsed member can cancel.

### 5.3 Client web — `/legal/autopay`
- `apps/client/src/features/legal/autopay/autopay-2026-11-15.tsx` + `registry.ts` entry (edition =
  `AUTOPAY_CONSENT_VERSION`). It is a public page «Условия автоплатежа в приложении ClubSpace».
- It says:
  - the seller and payee is the club; ClubSpace is the software;
  - the card is stored by ЮKassa, and the club/ClubSpace keep only a token and the last 4 digits;
  - charge timing (§1) and the 3-day reminder;
  - price and terms changes need the member's confirmation;
  - cancel any time in «Мой абонемент» or by asking the club, effective immediately; a written
    confirmation follows;
  - refunds of an unused abonement are made by the club under its offer and art. 32 ЗоЗПП;
  - 54-ФЗ receipts are e-mailed by ЮKassa.
- Owner/legal review before rollout (§11).

## 6. MCP / AI

No new tool and no change to `revenue_report` / `club_overview`: autopay sales are online sales and
already counted. `abonement_states` (`features/mcp/tools/money-tools.ts:281-384`) gains `autopay:
'on' | 'needs_action' | null` per member, so the AI doesn't suggest calling someone on autopay.
Update `docs/mcp.md`.

## 7. CSV

`payments.csv` (E1): «Способ оплаты» for an autopay sale = «Онлайн (автоплатёж)». No new column and no
new export: the live agreements are visible per member, and no requester asked for an autopay list.

## 8. Security

- **No card data.** Stored: the ЮKassa `payment_method.id`, title, last 4 digits and the shopId. A
  token is useless without the club's secret key, which is AES-GCM encrypted (`schema.prisma:3311-3313`,
  `payment-credentials.ts`) and decrypted only for the provider call.
- **Tokens never leave the server.** DTOs carry `cardLabel` only. Staff without club-admin rights don't
  get the last 4 digits.
- **Refusal is final.** Cancelling nulls `paymentMethodId` in the same write that sets `CANCELLED`, so
  no code path can reuse it (376-ФЗ). Account deletion cancels first.
- **Only the job charges.** There is no endpoint that charges. The amount is computed server-side and
  capped by the agreed terms. The activation re-checks the provider's amount (`payment-activation.service.ts:99-109`).
- **Idempotence.**
  - Provider side: an Idempotence-Key per anchor and attempt, unique on `Payment.idempotenceKey`.
  - Our side: the PENDING → SUCCEEDED compare-and-set in activation (`:198-203`).
  - Execution: global concurrency 1, plus the in-flight guard.
- **Webhooks** stay untrusted: re-read with the club's credentials (`handle-yookassa-webhook.handler.ts:27-29`).
- **Abuse limits.** `MAX_CHARGES_PER_RUN`; at most 4 attempts per anchor; charges only in daytime.
- **Audit:** every enable, cancel, terms acceptance and decline; charges via `payment.succeeded`.

## 9. Tests

Server unit (Prisma mocked, conventions §1 «every handler»):
- `domains/autopay/autopay-rules.spec.ts`:
  - `pickAnchor` (current vs ended, cancelled excluded, scope equality, staff renewal moves it);
  - `autopayDueAt` for term, pack-exhausted (1 h guard) and pack-term-end, and first-visit → null;
  - Moscow and Vladivostok `S − 1` 10:00;
  - the window edges 10:00 / 20:00;
  - retry schedule and the 4th → null;
  - `termsCheck` (same, lower, higher, term/pack changed);
  - freeze-extended end moves due.
- `member-autopay.service.spec.ts`:
  - charge happy path (Payment row fields, key, receipt e-mail fallback);
  - second run / P2002 → skip; young PENDING → skip; old PENDING without provider id → re-send same
    key; 5xx → stays PENDING; 4xx → decline;
  - in-flight member checkout → skip;
  - `permission_revoked` → cancelled + token null; `card_expired` → `NEEDS_ACTION`;
  - 4th decline → `NEEDS_ACTION` + staff notice (first + final only);
  - new anchor resets attempts and re-activates `CHARGE_FAILED`;
  - terms rise → `NEEDS_ACTION` + one notice; lower → charged and `termsAmount` lowered;
  - plan off / club off / provider or shop changed / member gone / lapse 30 d → cancel;
  - unentitled club → skip without state change;
  - reminders once per anchor, pack «one left», none outside the window.
- `member-autopay.processor.spec.ts`: scheduler upsert, env flag off → nothing.
- `payment-activation.service.spec.ts`:
  - setup saved → agreement created (terms from the abonement, renewal amount), same-scope one
    replaced, `NEEDS_ACTION` re-armed;
  - setup not saved → none + text;
  - charge success resets;
  - canceled → `failureReason` + `onChargeDeclined`;
  - unactivated charge → `GRANT_REFUSED` + staff alert.
- `create-payment.handler.spec.ts` (`member-payments.handler.spec.ts`):
  - autopay refused for Stripe, club off, plan off, stale version, `ACTIVE` agreement;
  - `NEEDS_ACTION` allowed;
  - reuse separated by choice;
  - `save_payment_method` true / false / omitted;
  - ЮKassa 4xx on setup → `autopayLastError` + admin alert + 400.
- `get-online-purchase-options` spec: `autopay` block conditions, `consentLines` amounts (renewal ≠
  promo price).
- Handler specs for the five new endpoints: member 404 on a foreign row; owner bypass; coach → 403 on
  staff routes; money stripped for a head coach; cancel idempotent; accept-terms 409 on stale terms;
  `@AllowExpiredAccess` present.
- Writer hooks: `update-plan` (rise notifies, off cancels), `update/delete-payment-settings`,
  `cancel-subscription`, `remove-workspace-member`, `delete-account`.
- `list-awaiting-payment` / `list-renewal-candidates` specs: `autopayAttention` rows, no amount, count
  unchanged; `autopay` field.
- `yookassa-api.spec.ts`: tri-state `save_payment_method`; `payment_method_id` with `receipt`.
- `decline-reasons` spec; the platform specs keep passing on the moved import.
- `route-tier-consistency.spec.ts` picks up the new routes.

Server e2e (`apps/server-e2e/src/payments/`, `FakeGateway` with saved methods):
- `member-autopay.e2e-spec.ts`:
  - checkout with autopay → abonement + agreement;
  - time travel to `S − 1` 10:00 → `runCharges` → back-to-back abonement from `S`, journal row «автоплатёж»,
    `revenue_30d` up by the amount (= journal «Итого»);
  - second run → no second charge;
  - decline ×4 → `NEEDS_ACTION`, `awaiting-payment.autopayAttention` lists it, re-arm via checkout;
  - member cancel → token null, no charge at `S − 1`;
  - price rise → no charge until `accept-terms`;
  - staff cash renewal → autopay skips that period;
  - head coach sees state without amount; coach 403.
- `member-autopay-pack.e2e-spec.ts`: last class checked in → no charge for 1 h → charge → new pack
  starts now; unmark within the hour → no charge; pack term end with classes left → charged at `S`.
- Update `online-payment.e2e-spec.ts` (one-off payments send `save_payment_method: false` when the club
  has autopay on).

Admin:
- `MemberAutopayBlock` render spec (states, ⋯ only for sport leads, amount only for club admins).
- `PlanFormSheet` (checkbox gating, confirm on rise).
- `PaymentSettingsCard` (toggle only for ЮKassa, confirm on off).
- `renew-list` (block only when > 0).
- `journal-view.spec.ts` (method text).
- `contract-limits.spec.ts` (`cancelMemberAutopay.reason`).
- Smoke crawl: no new route.

Mobile:
- `autopay-text.spec.ts` (next-charge lines, plurals, pack wording).
- `OnlinePurchaseSection` (switch off by default; sends the version).
- `notification-route.spec.ts` (four kinds → MySubscription).

## 10. Rollout

1. **PR «Автоплатежи учеников»**:
   - `db push` (one table, columns on `Plan`, `WorkspacePaymentSettings`, `Payment`);
   - contract regen;
   - `docs/mcp.md`; CHANGELOG.
   No backfill. Rollback = redeploy the previous image (old code ignores the new columns; agreements
   just stop being charged).
2. **Global switch** `MEMBER_AUTOPAY_ENABLED` (`environment.memberAutopay.enabled`, default `false`).
   While off:
   - the settings checkbox is hidden;
   - purchase options return `autopay: null`;
   - checkouts refuse `autopay`;
   - the processor does nothing.
   Cancel endpoints and `listMyAutopays` always work, so a refusal is never blocked.
3. **Owner verification on a ЮKassa test shop** (autopay works there by default): setup, charge,
   decline (test cards), cancel, receipt. Then the switch goes on in production.
4. **Per club:** the club asks its ЮKassa manager to enable autopay, adds autopay terms to its member
   offer, ticks «Автоплатежи для учеников», then marks tariffs. `docs/store-distribution.md` «Оплата»
   section and the in-app hint explain the steps.
5. CHANGELOG line for clubs: «Автоплатежи учеников (ЮKassa): ученик сам включает при оплате,
   отключает в приложении; списание за день до окончания абонемента».

## 11. Acceptance checklist

- [ ] Club with ЮKassa and the setting on, tariff ticked: the app shows «Продлевать автоматически» off
      by default. With it on, the consent states club, amounts now/next, timing, the reminder, how to
      cancel and the terms link.
- [ ] Paying with the switch on creates the abonement and an agreement with card •• last4. The return
      screen and the push say the next charge date and amount.
- [ ] A one-off payment in that club sends `save_payment_method: false`; no agreement appears.
- [ ] Time-based: a reminder 3 days before; the charge on the last day 10:00–20:00 club-local; the new
      abonement starts right after the old one; the journal shows «Онлайн · автоплатёж»; revenue and
      journal «Итого» include it; ЮKassa e-mails the receipt.
- [ ] Pack: charged ≥ 1 h after the last class is used, or at term end; never while classes remain.
- [ ] A freeze moves the reminder and the charge date.
- [ ] Decline: member push + e-mail each time; staff alert on the first and the last; «Продлить» shows
      «Автоплатёж не прошёл»; 4 attempts in 5 days, then «остановлен». Paying again with the switch
      re-arms it.
- [ ] `permission_revoked` cancels at once.
- [ ] Price rise: push at once, no charge, «Подтвердить N ₽» in the app charges after confirmation.
      Price drop: charged at the lower price.
- [ ] Member cancels (also with expired access): token wiped, confirmation push + e-mail, no further
      charge, current abonement unchanged. Staff cancel with a reason works for a head coach; a coach
      gets 403.
- [ ] Turning the tariff or club toggle off, changing the shop, removing the member or deleting the
      account cancels with notices.
- [ ] Two runs at once, or a crash mid-charge, never charge twice (e2e).
- [ ] Stripe club: no autopay anywhere, one explanatory line in settings.
- [ ] tsc (server, admin, mobile, client), tests, contract drift, admin smoke for the four roles green.

## 12. Decisions

- **ЮKassa only; Stripe autopay is not built.**
  - Stripe needs a Customer, Checkout `setup_future_usage: off_session`, off-session PaymentIntents and
    a second webhook family (`payment_intent.*`; today only Checkout Session events,
    `PaymentSettingsCard.tsx:42-49`).
  - SCA can fail an off-session charge with `authentication_required`, which needs a member-return flow.
  - The platform is Russia-first (54-ФЗ receipts come only from ЮKassa) and the saved-card code already
    exists only for ЮKassa.
  - Stripe clubs keep one-off payments. Revisit on demand.
- **Opt-in at two levels plus the member.** Club setting (with its confirmation that ЮKassa enabled
  autopay and its offer covers it) → tariff checkbox → the member's unticked switch with consent shown.
  Nothing is pre-ticked; nothing is enabled for existing members.
- **Autopay starts only with a purchase** (mandatory save, `save_payment_method: true`). No
  zero-amount binding (it needs separate ЮKassa enablement, `platform-payments.service.ts:283-287`) and
  no card change while active. Re-arming = paying with the switch on. Boring and one flow.
- **One-off payments explicitly don't save** (`false`) in clubs with autopay on, so consent is collected
  only by our text.
- **Agreed terms are stored, and a rise needs consent.**
  - A renewal is a new sale. Charging more, or for less, without agreement is a unilateral change the
    consumer didn't accept.
  - Price drops apply automatically.
  - Any change of term length or pack size counts as a change.
  - The renewal amount excludes one-off promos (E3 contract) so promos don't trip it.
- **Charge timing:** term → the last day 10:00 local. Like the platform's 24 h lead
  (`billing-rules.ts:126-128`), this leaves a day to fix the card before access ends. Pack → when used up
  (1 h after the last deducting check-in) or at term end. Packs and terms both renew at term end, so the
  rule reads the same for every discipline (time-based gyms, class-pack studios). Daytime window
  10:00–20:00.
- **Reminder 3 days before the charge,** plus «one class left» for packs, always with the amount. This is
  not mandated by law, but ЮKassa requires the schedule to be clear, and it cuts disputes and chargebacks.
- **Retries:** 4 attempts over ~5 days (`S − 1`, `S`, `S + 1`, `S + 3`). Then stop and ask the member;
  never retry indefinitely. Revoked permission → cancel. Expired card → stop.
- **No automatic debt on failure.** The member is not granted an unpaid abonement. Staff see the failure
  in «Продлить» («Автоплатёж не прошёл», next to «Ожидают оплаты», not inside it), and may still sell
  on credit by hand. This keeps the glossary's «Ожидают оплаты» = staff sales unchanged.
- **A late success starts the abonement now,** not at the old end (`onlineGrantStart`); the member never
  pays for days without access.
- **Anchor computed each pass,** not stored. Staff cash renewals, member purchases and freezes are
  respected without hooks in every writer.
- **One hourly pass, global concurrency 1,** the platform autopay shape, with the idempotence key per
  anchor and attempt. No per-charge delayed jobs.
- **The same activation path as the webhook** for the synchronous answer and the notification, so a
  charge is applied once whichever arrives first.
- **Cancel anywhere, effective immediately, token wiped, written confirmation** (376-ФЗ). Member
  endpoints work with expired access. Staff cancel is `SPORT_LEADS`: it only stops charges, and the
  people who take a member's phone call must be able to honour a refusal. Enable, toggles and terms
  stay club-admin or member only.
- **Cancel never refunds or ends the current abonement.** A refund is the E1 staff action; ЗоЗПП art. 32
  refunds of the unused part stay the club's decision through it.
- **Unapplied autopay charge** (paid, grant refused): E1's strip + staff refund, with the agreement
  stopped and staff alerted. No automatic refund (money-moving automation without a human, rare race).
- **Visibility:** status for sport leads (renewal work), amount and card only for club admins.
  «Продлить» rows show «продлится автоплатежом» so nobody calls a member who is covered.
- **Notifications** under `subscription.` (mute-exempt, no opt-out: money). E-mail for the reminder, a
  decline, a terms change and a cancellation, because a push may be off.
- **Global env switch + club setting.** The env switch lets the owner test on a ЮKassa test shop
  first. It never blocks a cancellation.
- **No dependents** until child online payments exist (checkout already refuses them).
- **Legal text** (consent lines + `/legal/autopay`) is drafted here, versioned in code, and
  owner/legal-reviewed before the env switch goes on.
- **(implementation, slice A2)** Additions to §3.5, agreed with the client slices:
  - `MyAutopay` also carries `termsDurationDays`, `termsClassCount`, `cancelReason`, `lastFailedOn`
    (club-local day of the latest declined charge) and `newTerms.consentVersion` (echoed by
    `accept-terms`). Staff `MemberAutopay` also strips `nextCharge.amount` for non-club-admins.
    `nextCharge.on` is the retry day while declines are pending.
  - Settings output gains `autopayOffered` (= `MEMBER_AUTOPAY_ENABLED`) so the admin hides the box
    while the switch is off. Saving `autopayEnabled: true` is refused for Stripe and while the switch
    is off; the cancel on settings change runs only when the saved setting was on.
  - `accept-terms` also lifts a `TERMS_CHANGED` stop whose price came back down (no `newTerms`) on the
    current terms, and takes the tariff's currency. A stale `consentVersion` is 400 (as checkout).
  - The tariff box: only *ticking* `autopayAvailable` checks the club setting (a form re-sending a
    ticked box after the club turned autopay off still saves); turning `purchasableOnline` off clears
    `autopayAvailable` in the same write.
  - Membership also ends by the member leaving (`my-memberships/leave-workspace.handler.ts`), so it
    calls `cancelForUser` too (outside the §13 list; nobody else owns it).
  - `paidByAutopay` sits on `SubscriptionOutput` (true only in `listMemberSubscriptions`, like
    `pricedBy`); the journal detail's `cardLabel` is a top-level field.
  - `renewals_due` gains the same `autopay` field as `abonement_states` (it is the tool where «don't
    call» matters; same data as the «Продлить» row).
  - `autopayAttention.since` = the agreement's last state change (`updatedAt`).
- **(implementation, slice D)** `/legal/autopay` reuses the offer/DPA edition machinery
  (`LegalEditionPage` kind `autopay`, `AUTOPAY_EDITIONS` in `registry.ts`, plus
  `/legal/autopay/<version>` so the edition recorded in `consentVersion` stays reachable). Unlike the
  offer, the version is not read from `GET /public/legal`: it is a server code constant, so the newest
  client edition is in force and `apps/client/specs/legal-autopay.spec.tsx` fails unless it equals
  `AUTOPAY_CONSENT_VERSION` (read from `autopay-consent.ts`). A new edition = client file + server
  constant in one PR. The §5.3 points are written out as numbered clauses (plus the amount, retries,
  freeze and re-enable rules from §1, so the page matches the consent lines). Also touched outside the
  slice table: `LegalDocument.tsx` (kind + footer link), `app/sitemap.ts`, `docs/legal/README.md`
  (document row, edition rule, lawyer question).
- **(implementation, slice C)** Mobile:
  - `MyAutopay` gained, agreed with A2: `termsDurationDays` / `termsClassCount` (the «было 4 000 ₽ за
    30 дней» half of the terms-changed line), `cancelReason` (shown unless the member cancelled),
    `lastFailedOn` («Не удалось списать {date}») and `newTerms.consentVersion` (echoed by
    `accept-terms`).
  - The return screen and the purchase block's outcome read the next charge from `listMyAutopays`
    (the agreement with the payment's `planId`). `MyPayment` carries only `autopay: 'on' | 'not_saved'`,
    so the next charge has one source (A1).
  - A pending rise on an `ACTIVE` agreement (`newTerms` set before the charge) shows the same
    «Подтвердить N ₽» block as `NEEDS_ACTION / TERMS_CHANGED`.
  - The switch row always shows «Сейчас X · дальше Y». X is the promo-quoted amount once a code is
    applied, and the quote's own `autopay` block (consent lines + version) replaces the tariff's. The
    consent lines render verbatim as one paragraph.
  - «Условия автоплатежа» opens with `openWebLink`, a new tab on web. It does not use the payment page's
    same-tab redirect, which would drop the checkout the member is in the middle of.
  - The purchase block fetches `listMyAutopays` too, for «Автоплатёж включён» on a tariff with an
    `ACTIVE` agreement. A failed read just shows the switch (the server refuses a duplicate).
- **(implementation, slice B)** Admin:
  - The settings view gained `autopayOffered` (= `MEMBER_AUTOPAY_ENABLED`, agreed with A2), so the
    settings checkbox and the tariff checkbox are hidden while the switch is off and their flags are
    then not sent (a save keeps them). The tariff form reads the club setting itself
    (`getPaymentSettings` when the panel opens).
  - Besides turning the setting off, saving a provider switch or another ЮKassa `shopId` also asks
    first when agreements are live («Перейти на Stripe?» / «Сменить магазин?» — both cancel them,
    §3.5), and the «Отключить онлайн-оплату?» dialog names the count. The card shows one muted line
    «Автоплатёж включён у N учеников» only when N > 0.
  - The tariff form's disabled hint names the section by its real title, «Настройки → Оплата» (same
    entity, same name), not «Онлайн-оплата». The confirm reads `autopayCount` from `getPlan` at save
    time, only when the saved tariff has autopay and the save ends it or changes price up / term /
    pack size (`autopayImpact`). Archiving from the tariffs list (`subscriptions/page.tsx`, outside
    the slice table) asks «Автоплатёж отключится у N учеников» too. The tariff page's «Онлайн-продажа»
    fact says «можно продлевать автоплатежом».
  - «⋯ → Отключить автоплатёж» opens its own dialog (`confirmDialog` has no input) with the required
    «Причина» (`FORM_LIMITS.autopayCancel.reason`) and the destructive «Отключить». The block mounts
    only for sport leads (`isSportLead`) and re-reads whenever the panel re-reads the abonements
    (cancelling one may end its autopay). Declines show `lastFailedOn`: «Не прошло списание 13 дек.:
    …. Повторим 15 дек.». A pending rise on an `ACTIVE` agreement shows the same «Ждёт подтверждения
    новой цены» line, in the warning tone.
  - Journal rows use `entryMethodLabel` (`PaymentJournal.tsx`, outside the slice table); the entry
    panel's «Онлайн» fact appends «Автоплатёж, карта •• 4444» (detail `cardLabel`).
  - Plans and renewals have no `plans.ts` / `renewals.ts`: their wrappers live in
    `shared/api/subscriptions.ts` and derive the new fields from `ApiTypes`, so only `autopay.ts` is
    new. The vocabulary guard allows `autopay-text.ts` (an abonement's «занятия», like
    `subscription-display.ts`) and the audit label «Занятий».
- **(integration)** A pack with classes left is charged at S 10:00 **or at the pack's own end time if
  that is later the same day** (`autopayDueAt`). An online grant ends at its purchase time, so a pack
  bought after 10:00 is still live at S 10:00 with classes; `onlineGrantStart` / `grantFromPlan`
  refuse a new pack over it, and charging then would take money for an abonement that can't be
  granted. Found by the e2e suite failing only when run after 10:00 Moscow time.
- **(implementation, slice A1)** Server core:
  - The writer API is its own injectable, `MemberAutopayAgreementsService`
    (`member-autopay-agreements.service.ts`: setup, charge outcomes, `cancel*`, `notifyTermsChanged`),
    because `PaymentActivationService` calls it and the pass (`MemberAutopayService`: `runCharges`,
    `runReminders`, `chargeOne`) calls the activation — one service would be a DI cycle.
  - The pass also visits `NEEDS_ACTION` with `CHARGE_FAILED` / `GRANT_REFUSED` (a new anchor — e.g. a
    cash renewal — resumes it) and `TERMS_CHANGED` (resumes by itself when the terms fit again).
    `CARD_EXPIRED` waits for a new card.
  - `MAX_CHARGES_PER_RUN` caps provider requests, not candidates: candidates are paged by id, so
    agreements that are not due never starve the rest.
  - «Ended more than 30 days ago» is `pickAnchor` returning null (it already drops older ones);
    no separate `anchorLapsed`.
  - The pack reminder is S − 3 (3 days before its latest charge day S), the term one S − 4; the copy
    names the real day count («Через 3 дня, 14 декабря, клуб…»).
  - `termsCheck` also treats a currency change as changed; a renewal priced at 0 ₽ is skipped.
  - `DECLINE_REASON_RU` already had `card_expired` / `permission_revoked`; their texts are kept (the
    admin `billing-view.ts` mirrors them).
  - `MyPaymentOutput.autopay` is set once granted (`subscriptionId`); the return screen reads the
    next charge from `listMyAutopays` (one source). `GET me/checkout-quote` gained the same `autopay`
    offer with «сейчас» = the quoted (promo) amount, so the consent is exact with a code.
  - Event-ticket checkouts in an autopay club also send `save_payment_method: false`
    (`savePaymentMethodFor` in `start-provider-payment.ts`).
  - The cancellation confirmation is sent even with the abonement section off (written refusal
    confirmation); other member notices use `feature: 'subscription'`. Staff alerts go to the owner +
    club admins one `notifyUser` per recipient (refId `…:${userId}`).
  - A renewal `Payment.createdAt` is the pass's `now`, so the re-send window and the in-flight guard
    read one clock.
  - A setup checkout's `Payment` also carries `autopayId` (the agreement it created); «автоплатёж» in
    the journal / CSV is a renewal charge: `autopayId` set and `autopayConsentVersion` null.

## 13. Implementation slices

One PR. The server slice lands schema, DTOs and controllers first (contract regenerated), then the
client slices work in parallel against real types. Nobody runs the full gate mid-flight; the integrator
runs it once. E1 phase B and E3 must be merged first: they own `Refund`, `receiptEmail` and the
`priceSale` / sale price columns this design calls.

| Slice | Owns (only these files) | Size |
|---|---|---|
| A1 server core | `apps/server/prisma/schema.prisma`; `apps/server/src/domains/autopay/**` (new); `domains/payments/{decline-reasons.ts (new),yookassa-api.ts,payment-gateway.types.ts}` (+specs); `domains/billing/services/platform-payments.service.ts` (import move only); `domains/payments/services/payment-activation.service.ts` (+spec); `features/online-payments/{create-payment.*,start-provider-payment.ts,get-online-purchase-options.*,schemas.ts,load-buyer.ts,member-payments.handler.spec.ts}`; `environments/environment.ts`; `app/app.module.ts` | M–L (≈ 4 d) |
| A2 server surfaces | `features/member-autopay/**` (new); `features/online-payments/{update-payment-settings.*,delete-payment-settings.*,payment-settings-view.ts,payment-settings.handler.spec.ts}`; `features/manage-plans/**`; `features/member-subscriptions/{cancel-subscription.handler.ts,schemas.ts}` (+specs); `features/remove-workspace-member/**`; `features/delete-account/**`; `features/list-awaiting-payment/**`; `features/list-renewal-candidates/**`; `features/payment-journal/**` + `domains/payments/journal.ts` (`online.autopay`, coordinate with the E1 owner); `features/data-export/export.service.ts` (method text); `features/mcp/tools/money-tools.ts`; `domains/scheduler/data-purge.service.ts` (retention); `shared/access/route-tier-consistency.spec.ts`; `apps/server-e2e/src/payments/{member-autopay,member-autopay-pack,online-payment}.e2e-spec.ts`; `open-api.json`; `libs/api-client/src/openapi/*`; `docs/mcp.md` | M (≈ 3 d) |
| B admin | `apps/admin/src/features/payments/{PaymentSettingsCard,PaymentEntrySheet,journal-view}*`; `features/subscriptions/{PlanFormSheet,MemberSubscriptionPanel,MemberAutopayBlock (new),subscription-display}*`; the plan detail page; `app/…/retention/renew-list.tsx`; `features/audit/audit-meta.ts`; `shared/api/{autopay.ts (new),payments.ts,plans.ts,renewals.ts}`; `shared/lib/contract-limits.ts` | M (≈ 2 d) |
| C mobile | `apps/mobile/src/features/payments/{OnlinePurchaseSection,PaymentReturnScreen,payment-helpers}*`; `features/subscription/{MySubscriptionScreen,AutopayCard (new),autopay-text (new)}*`; the lock screen that hosts `OnlinePurchaseSection`; `shared/api/{autopay.ts (new),payments.ts}`; `features/notifications/notification-route.ts` (+spec) | S–M (≈ 1.5 d) |
| D client legal | `apps/client/src/features/legal/autopay/**` (new), `features/legal/registry.ts`, the `/legal/autopay` route; `docs/store-distribution.md` «Оплата» | S (≈ 0.5 d) |

Checks for the integrator:
- tsc server / admin / mobile / client;
- `npx nx test @clubspace/server -- autopay`, `-- payment-activation`, `-- online-payments`, `-- yookassa`,
  `-- manage-plans`, `-- awaiting-payment`, `-- renewal-candidates`, `-- route-tier`;
- admin and mobile tests;
- server e2e `payments/*`;
- contract drift;
- `npm run test:admin-e2e` for the four roles;
- `cs-reviewer` before merge.

## 14. Open risks

- **ЮKassa shop enablement is outside our control.** A club may tick the setting before its manager
  enables autopay. The first autopay checkout then fails with a 4xx, which shows in settings and alerts
  admins. [INFERENCE] ЮKassa refuses `save_payment_method: true` for a non-enabled shop with a 4xx rather
  than silently not saving; the `saved: false` path covers the other case.
- **`save_payment_method: false` on shops without autopay** is sent only when the club setting is on, to
  avoid an unknown reaction from non-enabled shops.
- **Legal text — черновик, требует проверки юристом.** Drafted by engineering; the consent lines
  (`autopay-consent.ts`) and the `/legal/autopay` edition `2026-11-15`
  (`apps/client/src/features/legal/autopay/autopay-2026-11-15.tsx`) must be reviewed by the owner or a
  lawyer before `MEMBER_AUTOPAY_ENABLED` goes on (question listed in `docs/legal/README.md`). 376-ФЗ
  formally targets subscription contracts «в сети Интернет». Applying it to every club is the
  conservative reading. The page says «чеки по 54-ФЗ присылает ЮKassa», true only while the club keeps
  ЮKassa receipts on (`receiptEnabled`, default on). The ClubSpace ↔ club offer
  (`offer-2026-11-01.tsx`, §5 covers only the platform fee) should gain a clause on member autopay in its
  next edition.
- **Freeze after the renewal was charged.** A freeze requested on the last day, after the charge, leaves
  two overlapping abonements (the existing manual-renewal behaviour, `subscription-freeze.service.ts:276-304`).
  It is rare with a one-day lead; staff resolve it as today.
- **A tariff's directions edited** while agreements live: the anchor follows the plan's new scope, and
  an agreement whose member has no abonement in that scope lapses and cancels after 30 days. Not
  treated as a terms change.
- **Charge-window starvation** at > 2 000 due charges per club-day per instance
  (`MAX_CHARGES_PER_RUN × 10` windows). Far above today's clubs (≤ 2 000 members); raise the cap if
  needed.
- **E-mail changes:** the receipt goes to the member's current e-mail, else the one at consent. A member
  who removed their e-mail still gets receipts at the old address.
- **Dependents** are excluded. Kids' clubs (a large segment) get no autopay until child online payments
  are designed.
