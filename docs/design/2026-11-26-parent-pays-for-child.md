# A parent pays for a child; a parent's notification settings cover the child

Status: **design** · 2026-11-26 · base: `main` @ `d434461c` (plus uncommitted demo-readiness fixes)
Parent: [concept](../strategy/concept.md) §2.9 («Онлайн-оплата за ребёнка пока закрыта («оплатите в клубе»);
настройки уведомлений родителя пока не применяются к уведомлениям ребёнка», `concept.md:155-156`) and §3
item 6 (`concept.md:188`). Siblings: [member autopay](2026-11-15-member-autopay.md),
[discounts](2026-11-15-discounts.md), [payments journal](2026-11-15-payments-journal.md).
File:line references are as of `d434461c`. The owner was asleep while this was written; every choice he
would normally make is in §10 «Decisions» and may be overruled.

## Кратко (для владельца)

Сейчас родитель в профиле ребёнка («Я / Миша») не может купить ребёнку абонемент онлайн: сервер
отвечает «оплатите его в клубе», а в приложении кнопки «Оплатить онлайн» в детском профиле просто нет.
Билеты на события за ребёнка уже можно оплатить онлайн, а абонементы — нет. Вторая дыра: уведомления
ребёнка приходят родителю, но настройки родителя к ним не применяются. Родитель выключил «Объявления»,
а объявления группы ребёнка всё равно приходят. Заглушить клуб ребёнка нельзя совсем.

Что сделаем:
1. **«Оплатить онлайн» в профиле ребёнка.** Покупатель — родитель: чек 54-ФЗ уходит на его e-mail.
   Абонемент получает ребёнок. В журнале платежей видно «Оплатила: Елена Петрова (родитель)», в
   истории изменений действие записано на родителя. Возврат идёт на ту же карту, обычным путём.
   Семейная скидка и промокоды считаются как обычно, на ребёнка.
2. **Автоплатёж для детей пока не включаем.** Карта принадлежит родителю, у ребёнка может быть два
   родителя, связь «родитель — ребёнок» можно разорвать. Безопасного простого варианта нет, поэтому
   ребёнку абонемент продлевают покупкой. Переключатель «Продлевать автоматически» в профиле ребёнка
   не показывается, и сервер его не примет.
3. **Настройки уведомлений родителя действуют и на уведомления ребёнка.** Если родитель выключил
   категорию (объявления, новые видео, повышения, «давно не были», «доступ истекает»), он не получает
   её ни за себя, ни за детей. Если родитель заглушил клуб у себя, заглушены и уведомления ребёнка из
   этого клуба. Уведомления об оплате, доступе и изменениях в записи по-прежнему приходят всегда.
4. **В профиле ребёнка можно заглушить его клуб** (например, родитель не ходит в этот клуб сам). Это
   общий выключатель для обоих родителей.

Демо: онлайн-оплаты в демо нет (нет магазина ЮKassa), поэтому показываем заглушение клуба в профиле
Миши. Покупку за ребёнка проверяем на тестовом магазине ЮKassa.

## Problem

1. **The abonement checkout refuses a child.** `create-payment.handler.ts:166-177` reads the holder's
   e-mail; a child profile has none (`User.email` is null for dependents, `schema.prisma` model `User`)
   and the handler throws «Оплатить абонемент ребёнка онлайн пока нельзя — оплатите его в клубе».
   `CreatePaymentFeature` carries only `userId` (`create-payment.feature.ts` class at the end), and
   `payments.controller.ts:30-41` passes only `user.userId`: the handler can't see who pressed the button.
2. **The app hides the purchase in a child's profile.** `MySubscriptionScreen.tsx:184-203` wraps both
   `AutopayCard` and `OnlinePurchaseSection` in `!actingAs` («Paying for a child's abonement isn't offered
   yet, nor autopay»); the lock screen does the same (`AccessExpiredScreen.tsx:154-163`).
3. **Event tickets already work, with a reuse bug.** `event-registrations.controller.ts:126-150` passes
   `user.guardianId ?? user.userId` as the actor; `pay-event-registration-online.handler.ts:146-161` sends
   the receipt to the holder's e-mail, else the guardian's (e2e `event-ticket-online-payment.e2e-spec.ts:401-430`).
   The pending-payment reuse (`:114-124`) matches on the registration only, so a second guardian tapping
   within 30 minutes gets the first guardian's provider page, created with the first guardian's e-mail.
4. **Nobody records who paid.** `Payment.userId` is «The buyer» (schema comment) and is the holder. The
   activation audits `payment.succeeded` with `actorId: payment.userId` (`payment-activation.service.ts:217,374,474`),
   i.e. the child. The journal row (`domains/payments/journal.ts:281-290`, `JournalOnline`) and the CSV
   (`data-export/export.service.ts:195-210`) have no payer.
5. **The return screen 404s in the parent's own profile.** `get-my-payment.handler.ts:21-24` matches
   `userId` only. A parent who comes back from the provider's page after switching to «Я» polls their
   own id against the child's payment.
6. **The guardian's preferences are checked against the child.** Every gate runs on the addressed user,
   before routing to guardians:
   - `notification-producer.service.ts:119-131` (`notifyUser`): `canNotifyUser` (category) and
     `isMutedFor` run on the child, then `routeToGuardians`;
   - `:50-57` (`writeMany`): `filterMuted` on the child's membership, then routing;
   - `:211-216` (`notifyWorkspace`): `filterOptedIn` over member ids (the child's);
   - `daily-club.service.ts:121,178,232` (inactivity, access expiry) and `review-reminders.service.ts:134`
     read opt-outs of the child.

   A child has no `NotificationPreferences` row, so it is always «on»: `me/notification-preferences`
   is user-level (`notification-preferences.controller.ts:36`) and refused under `X-Act-As`, and the
   Settings section is hidden in a child's profile (`SettingsScreen.tsx:282-285`). `guardian-routing.ts:53-75`
   rewrites rows without looking at the guardian's preferences.
7. **A child's club can't be muted.** `PATCH me/memberships/:clubId/notifications`
   (`my-memberships.controller.ts:60-72`) has no `@ActAsAllowed()`. The mobile allowlist doesn't list it
   (`apps/mobile/src/shared/api/act-as.ts:12-31`), and `ProfileMembershipSections.tsx:18-22,51` hides club
   settings in a child's profile. The producer comment «a child's mute is its own membership's, set by the
   guardian acting for it» (`notification-producer.service.ts:47-49`) describes a path that doesn't exist.

## Goal / non-goals

Goals:
- A confirmed guardian buys a child's abonement online in the child's profile. Payer = guardian,
  holder = child, receipt e-mail = guardian's, journal, CSV, audit and refunds attribute the payer.
- One payer rule for abonements and event tickets, including the pending-payment reuse.
- The guardian's category opt-outs and own club mute apply to every row routed to them for a child.
  The child's own club mute becomes settable from the child's profile.

Non-goals:
- Autopay for children (§10).
- Paying for a child from the parent's own profile («Я»): the child's profile is where the abonement,
  freeze and history live. No cross-profile basket.
- A payer on cash, transfer or card-at-desk sales: staff record those; the journal already has «Отметил».
- Per-guardian, per-child mute (two parents choosing differently): one switch per child membership.
- Unpaid-guardian («только родитель-плательщик») rules or spending limits.
- Notification e-mail for children: `send-notification.handler.ts:68-88` already routes manual staff
  e-mails to guardians under the guardians' own channel preferences.

## 1. The payer rule

- **Holder** = `user.userId` (the child under `X-Act-As`). **Payer** = `user.guardianId ?? user.userId`.
  AuthGuard already admits only a confirmed guardian (`isActiveGuardian`, `auth.guard.ts:324-330`) and
  audits the POST as `guardian.actAs` (`:335-345`).
- **Receipt e-mail** = the holder's e-mail, else the payer's (the ticket rule, now shared). No e-mail at
  all → 400 «Для онлайн-оплаты нужен e-mail в профиле — на него придёт чек» (existing text).
- **Price** = `priceOnlineItem` for the holder. The family discount (`domains/discounts/family.ts`)
  already counts the child's guardians and siblings. Per-person promo limits count against the holder:
  the abonement is the child's.
- **Provider data:** description and item name stay as today (`Абонемент «X» — Клуб`); no child's name
  goes to the provider or the OFD (data minimisation, 152-ФЗ).
- **Pending reuse** matches the payer too: a repeated tap by the same parent reuses; the other parent
  gets a new payment.

## 2. Data model (Prisma, additive; `db push` without `--accept-data-loss`)

```prisma
model Payment {
  // …
  // Who paid when it isn't the holder: the guardian acting for a child
  // (X-Act-As). Display and audit only, no FK (like MemberAutopay.cancelledById):
  // account deletion de-identifies the User row and never touches payments.
  // null = the holder paid (every payment before this change).
  payerUserId String? @db.Uuid
}
```

Nullable, no default, no unique, no index (reads go by `id`). No backfill: old payments were paid by
their holders, except tickets bought under act-as, which keep null and show the holder. No `deploy/update.sh` step.

## 3. Server

### 3.1 Checkouts (`features/online-payments/`, `features/event-registrations/`)

- `create-payment.feature.ts`: `CreatePaymentFeature` gains `readonly actorUserId: string` (who pressed
  the button) after `userId`. `payments.controller.ts` passes `user.guardianId ?? user.userId`, the
  same way as `event-registrations.controller.ts:144`.
- `create-payment.handler.ts`:
  - autopay with `actorUserId !== userId` → `BadRequestError` «Автоплатёж для абонемента ребёнка не
    подключается — продлевайте его покупкой», checked before `assertAutopayAllowed`;
  - the pending reuse (`:130-143`) adds `payerUserId: payerOrNull` to its `where`;
  - the e-mail block (`:166-177`) becomes the shared helper below; the refusal text is deleted;
  - `startProviderPayment` gets `payerUserId`.
- New pure helper in `features/online-payments/load-buyer.ts`:
  `loadReceiptEmail(prisma, { holderId, actorId }): Promise<string | null>` (holder's e-mail ?? actor's),
  and `payerOf(holderId, actorId): string | null` (null when equal). Both checkouts use them;
  `pay-event-registration-online.handler.ts:146-161` drops its inline copy.
- `pay-event-registration-online.handler.ts`: the reuse (`:114-124`) adds `payerUserId`; passes
  `payerUserId` to `startProviderPayment`.
- `get-online-purchase-options.feature.ts`: `GetOnlinePurchaseOptionsFeature(workspaceId, userId,
  actorUserId)`. The handler sets every plan's `autopay` to `null` (and `autopayTermsUrl` to null) when
  `actorUserId !== userId`. `my-payments.controller.ts:52-63` passes the actor.
- `get-checkout-quote.feature.ts`: `GetCheckoutQuoteFeature` gains `actorUserId` the same way; the
  handler's `autopay` (`get-checkout-quote.handler.ts:65-75`) is `null` under act-as. The price is still
  the holder's.
- `get-my-payment.handler.ts:21-24`: `where: { id, workspaceId, OR: [{ userId }, { payerUserId: userId }] }`.
  The parent can follow the child's payment in either profile; a stranger still gets 404.

No new endpoints, no DTO renames. The output DTOs of the checkouts are unchanged.

### 3.2 Activation, audit, refunds (`domains/payments/`)

- `payment-activation.service.ts:217,374,474`: `actorId: payment.payerUserId ?? payment.userId`;
  `metadata.payerUserId` when set. The `payment.succeeded` push still addresses the holder, so it reaches
  every confirmed guardian with the child's name (`guardian-routing.ts`). It is mute-exempt (`payment.`).
- `refund.service.ts`: no logic change. A partial refund's receipt uses `Payment.receiptEmail`, which is
  the guardian's (`:470-474`). The provider returns the money to the card that paid. `payment.refunded`
  goes to the holder → guardians.

### 3.3 Journal and CSV

- `domains/payments/journal.ts`: `JournalOnline` gains `payerUserId: string | null`; the loader selects
  it. `loadJournalPeople` adds payers to the id set.
- `features/payment-journal/schemas.ts`: entry output gains `payer: { userId, name } | null`, set only when
  `payerUserId` is set and differs from the holder. DTO names unchanged (field added).
- `data-export/export.service.ts:195-210`: the payments CSV appends the column «Плательщик» at the end,
  with the payer's name or empty. It goes last so column positions in clubs' spreadsheets don't shift.

### 3.4 Notifications: gates on the real recipient (`domains/notifications/`)

New `domains/notifications/recipient-gates.ts` (pure where possible, one query each):

```ts
// Rows routed to a guardian (metadata.dependentId set) are checked against the
// guardian: their category opt-out and their own mute of that club.
export const filterRoutedRows = async <T extends PushNotificationRow>(
  prisma: Pick<PrismaService, 'notificationPreferences' | 'workspaceMember'>,
  rows: T[],
): Promise<T[]>
```

- A routed row is dropped when its `category` is set and the guardian's `NotificationPreferences[category]`
  is `false` (a missing row = on, like `categoryEnabled`).
- It is also dropped when its kind is not `isMuteExempt` and the guardian has an ACTIVE membership in
  `metadata.workspaceId` with `notificationsMuted = true`.
- Direct rows pass untouched: their recipient was already checked upstream.

Wiring:
- `PushNotificationRow` gains `category?: NotificationCategoryKey`. It is not persisted; it only feeds the gate.
- `writeMany`: `filterMuted` (child's membership, unchanged) → route → `filterRoutedRows` → insert. The
  realtime invalidation uses the guardians of the rows that survive.
- `notifyUser`: after `routeToGuardians`, `filterRoutedRows` with `category: p.category`. The dispatch
  claim stays before routing: a gated guardian copy is not retried later.
- `notifyWorkspace`: rows carry `category: p.category`.
- `daily-club.service.ts` (`member.inactive` → `inactivityEnabled`, `access.expiring` →
  `accessExpiringEnabled`) and `review-reminders.service.ts` set `category` on their rows. Their pre-filter
  on the addressed ids stays: it covers adults.
- The comment at `notification-producer.service.ts:47-49` is rewritten to describe both checks.

Which categories exist doesn't change. `analyticsDigestEnabled` is for owners and admins and never goes
to a child.

### 3.5 Child's club mute

- `my-memberships.controller.ts`: `@ActAsAllowed()` on `updateMembershipNotifications` (after `@Patch`, as
  `route-tier-consistency.spec.ts:335-345` requires). Its handler acts on `invokerUserId`, the child under
  act-as. `leaveWorkspace` stays refused.
- `route-tier-consistency.spec.ts:325`: the pinned `actAsAllowed` list gains the method.
- Audit: the write is recorded as `guardian.actAs` by AuthGuard, which is enough. No new action.

### 3.6 Tiers, realtime, notifications summary

| Endpoint | Tier | Change |
|---|---|---|
| `POST workspaces/:id/payments` (`createPayment`) | any member, act-as | actor passed |
| `GET workspaces/:id/me/online-purchase`, `GET …/me/checkout-quote` | any member, act-as | autopay hidden under act-as |
| `GET workspaces/:id/me/payments/:paymentId` | any member, act-as | payer may read |
| `POST …/event-registrations/:id/checkout` | any member, act-as | payer stored, reuse by payer |
| `PATCH me/memberships/:clubId/notifications` | AuthGuard, now `@ActAsAllowed` | child's mute |
| `GET workspaces/:id/payment-journal[/:entry]` | `CLUB_ADMINS` | `payer` field |

Realtime: unchanged (`subscription`, `payments`, `notifications`). Notification kinds: unchanged.

## 4. Admin UI

- **«Абонементы → Платежи», side panel** (`features/payments/PaymentEntrySheet.tsx:329` area): one
  `Fact` «Оплатил(а)» → «Елена Петрова · родитель», shown only when `entry.payer` is set. The list row is
  unchanged: no new column, one primary per view stays.
- **Member card → payments** (if it lists online payments): no change; the journal is the money view.
- **History of changes** (`features/audit/audit-meta.ts`): the `payment.succeeded` metadata label
  `payerUserId` → «Плательщик» (rendered as the person's name, as other user ids are).
- No new routes. `apps/admin-e2e/src/role-matrix.ts` is unchanged.

## 5. Mobile

- `MySubscriptionScreen.tsx:184-203`: `OnlinePurchaseSection` renders in a child's profile too. `AutopayCard`
  stays `!actingAs`. The comment becomes «Autopay isn't offered for a child (docs/design/…)».
- `AccessExpiredScreen.tsx:154-163`: the same.
- `features/payments/OnlinePurchaseSection.tsx`: in a child's profile one muted line under the price,
  «Чек придёт на ваш e-mail», and no autopay switch: the server sends `autopay: null`, and the switch
  renders only for a non-null offer (`OnlinePurchaseSection.tsx:383,411`), so nothing else changes.
- `PaymentReturnScreen` / `usePaymentPolling.ts`: no change. The server answers in either profile.
- **Child's club mute:** `ProfileMembershipSections.tsx:51` shows, in a child's profile, one row
  «Уведомления клуба для {имя}» with a switch. It doesn't open `ClubSettings`: leaving stays in the
  parent's own profile. It calls the existing `updateMembershipNotifications` wrapper and refreshes
  `get-my-workspaces` (allowlisted, returns the child's `notificationsMuted`).
- `shared/api/act-as.ts`: `USER_LEVEL_RULES` gains `{ method: "patch", path: /^\/me\/memberships\/[^/]+\/notifications$/ }`;
  `act-as.spec.ts` gets the case (and a case that `DELETE /me/memberships/<id>` is still not sent).
- `SettingsScreen.tsx:282-285`: in a child's profile, instead of nothing, one muted line: «Уведомления
  {имени} приходят вам и подчиняются вашим настройкам. Чтобы изменить их, переключитесь на «Я».» The
  vocabulary comes from the child's first name, which the profile switcher already has.

## 6. MCP / AI

No tool change. Money tools (`features/mcp/tools/money-tools.ts`) report sales by holder; the payer is not
exposed to the assistant (no need, and less personal data sent to a model).

## 7. Demo generator

The demo has no online payments and no ЮKassa shop (`docs/demo.md:411-412`), so it doesn't fake a
`Payment` row: a refund attempt on it would fail on the missing provider. Demo content:
- `domains/demo/demo-club.plan.ts`: no change in data. The parent account's children (Миша, Аня) already
  have confirmed guardianships.
- `docs/demo.md`: add a step for the parent phone: «Профиль → Миша → «Уведомления клуба для Миши»», and
  one sentence: with a test shop connected, «Оплатить онлайн» works in the child's profile, the receipt
  goes to the parent and the journal shows «Оплатила: … (родитель)».

## 8. Tests

Unit (server, `npx nx test @clubspace/server -- <substring>`):
- `create-payment` (`member-payments.handler.spec.ts`): a guardian buys for a child → `customerEmail` is
  the guardian's, `Payment.payerUserId` = guardian, `userId` = child; autopay under act-as → 400 and no
  gateway call; the holder pays for themselves → `payerUserId` null; the reuse finds the same parent's
  pending payment and ignores the other parent's; a child and a guardian both without e-mail → 400.
- `get-online-purchase-options` and `get-checkout-quote`: `autopay` null under act-as; offered for the adult.
- `get-my-payment`: the payer reads the child's payment; a third user → 404.
- `pay-event-registration-online.handler.spec.ts`: the reuse is scoped by payer; `payerUserId` written.
- `payment-activation` spec: `payment.succeeded` audit `actorId` = payer when set.
- `payment-journal` specs: `payer` set only when it differs from the holder; `export.service.spec.ts`:
  the last column «Плательщик».
- `recipient-gates.spec.ts` (new): guardian opted out of a category → routed row dropped, a second
  guardian keeps theirs; guardian's own club muted → non-exempt kind dropped, `payment.succeeded` kept;
  direct rows untouched; no category on the row → only the mute check.
- `notification-producer.service.spec.ts`: `notifyUser` / `writeMany` / `notifyWorkspace` drop a gated
  guardian copy and still deliver the other guardian's.
- `daily-club.service.spec.ts`: rows carry `category`.
- `route-tier-consistency` (the pinned act-as list) and `notification-mute`.

Server e2e:
- `apps/server-e2e/src/payments/online-payment-for-child.e2e-spec.ts`: a parent joins a child by code,
  buys a tariff under `X-Act-As` → 201, the gateway saw the parent's e-mail, `Payment.userId` = child,
  `payerUserId` = parent. The webhook succeeds → the child's abonement exists and the audit actor is the
  parent. `GET me/payments/:id` works without the header. The journal entry has `payer`. Autopay under
  act-as → 400.
- `apps/server-e2e/src/notifications/guardian-preferences.e2e-spec.ts`: the parent turns off
  announcements → a group announcement to the child's group doesn't reach the parent's inbox. The parent
  mutes the child's club (`PATCH me/memberships/:id/notifications` with `X-Act-As`) → an announcement is
  dropped, a `payment.`/`classes.` kind still arrives. The parent's own mute of the club also drops the
  child's announcement.
- `families.e2e-spec.ts`: `DELETE me/memberships/:id` with `X-Act-As` is still 403.

Admin: `PaymentEntrySheet.spec.tsx` shows «Оплатил(а)» only with `payer`. Mobile: `act-as.spec.ts`. Admin
e2e matrix: no change.

## 9. Acceptance checklist

- [ ] In a child's profile, «Абонемент» shows «Оплатить онлайн» with the club's online tariffs, without the
      autopay switch, and with «Чек придёт на ваш e-mail».
- [ ] Paying with the YooKassa test shop creates the child's abonement; the receipt e-mail is the
      parent's; the journal panel says «Оплатил(а): <parent> · родитель»; the CSV has «Плательщик».
- [ ] The history of changes shows «Оплата получена» by the parent.
- [ ] A refund from the journal returns the money (test shop), and the push reaches both parents with
      the child's name.
- [ ] Back from the provider's page in «Я», the return screen shows the result.
- [ ] Two parents: the second gets their own provider page and their own receipt e-mail.
- [ ] Event tickets: the same payer rule; the old flow still passes its e2e.
- [ ] Parent turns off «Объявления» → no announcements for the child; turns it on → they arrive.
- [ ] «Уведомления клуба для Миши» off → club chatter for Миша stops, payments and class changes still come.
- [ ] tsc server / admin / mobile clean; contract regenerated; all listed tests green.

## 10. Decisions

- **Payer = the guardian acting, holder = the child.** No new endpoint: the act-as mechanism already
  proves the link and audits the write. Paying from «Я» for a child is out: one place per child.
- **Receipt to the holder's e-mail, else the payer's.** For a child that is always the payer. Same rule
  as tickets, one helper.
- **`Payment.payerUserId`, nullable, no FK.** Additive; matches the display-only actor ids already on
  `MemberAutopay`. No backfill.
- **Autopay for children stays off,** on the server too. A saved card is the guardian's; a child can
  have two guardians and the link can be dropped (`unlink-my-dependent.handler.ts`); 376-ФЗ cancellation,
  «needs action» notices and the agreement owner would all need a second person on `MemberAutopay`. That
  isn't trivially safe. Revisit when a club asks.
- **Family discount and promo limits count on the holder.** Already true through `priceOnlineItem`. Each
  child is a person for «один раз на человека».
- **No child's name to the provider or the receipt.** Item names stay as today.
- **The pending reuse is per payer,** for tickets too. That fixes the shared-page bug.
- **The guardian's preferences gate the rows routed to them.** The check sits after routing in one
  domain helper, so every producer path (writeMany, notifyUser, notifyWorkspace, scheduler jobs) obeys
  it. Exempt kinds stay exempt.
- **Two mutes, either silences:** the child's membership mute (one switch shared by both guardians) and
  the guardian's own mute of the same club. Per-guardian per-child mute is out: it would need a new table
  for a rare case.
- **The child's mute is settable from the child's profile** through the existing route with
  `@ActAsAllowed()`. Leaving the club stays a parent-profile action.
- **CSV column goes last**, to keep positions stable.
- **No demo fake payment.**
- **(implementation) The pending payment shown in the child's «Оплатить онлайн» block and the quote's reuse
  lookup are per payer too** (`payerUserId` in their `where`), like the checkout's reuse: the other parent
  never sees or continues a page created with someone else's e-mail.
- **(implementation) «Чек придёт на ваш e-mail» is one sentence appended to the existing payment footnote**,
  not a line on every tariff card (it would repeat per card).
- **(implementation) The child's rows don't decline its name** (a rule-based genitive breaks on names like
  Марьям or Гульнар): the switch reads «Уведомления клуба: Миша» and the Settings line «Уведомления профиля
  «Миша» приходят вам и подчиняются вашим настройкам…».
- **(implementation) The audit log names `payerUserId`**: `AuditService.list` resolves it like the other
  user-id keys, so «Плательщик» shows a name, not an id.
- **(implementation) `GET me/payments/:id` without the header still needs the parent to be a member of that
  club** (WorkspaceMemberGuard is unchanged). A parent who isn't one follows the payment in the child's
  profile, which the app keeps across the trip to the provider's page.
- **(implementation) The child profile's Settings «Аккаунт» footnote no longer repeats «Уведомления … в вашем
  собственном профиле»**: the new «Уведомления» line says it once.

## 11. Implementation slices

One PR, three parallel slices. S1 commits the schema field, the feature constructor changes and the
journal DTO field first and regenerates the contract, so S3 typechecks against real types. Nobody runs
the full gate mid-flight; the integrator runs it once.

| Slice | Owns (only these files) | Size |
|---|---|---|
| S1 server payments | `apps/server/prisma/schema.prisma` (`Payment.payerUserId`); `features/online-payments/{create-payment.feature,create-payment.handler,payments.controller,load-buyer,start-provider-payment,get-online-purchase-options.feature,get-online-purchase-options.handler,get-checkout-quote.feature,get-checkout-quote.handler,my-payments.controller,get-my-payment.handler,member-payments.handler.spec}.ts`; `features/event-registrations/{pay-event-registration-online.handler,pay-event-registration-online.handler.spec}.ts`; `domains/payments/services/payment-activation.service.ts` (+spec); `domains/payments/journal.ts`; `features/payment-journal/{schemas,payment-journal-detail}.ts` (+specs); `features/data-export/export.service.ts` (+spec); `apps/server-e2e/src/payments/online-payment-for-child.e2e-spec.ts`; `open-api.json`, `libs/api-client/src/openapi/*` | 1.5 d |
| S2 server notifications | `domains/notifications/{recipient-gates.ts,recipient-gates.spec.ts,guardian-routing.ts}`; `domains/notifications/services/notification-producer.service.ts` (+spec); `domains/scheduler/{daily-club,review-reminders}.service.ts` (+specs); `features/my-memberships/my-memberships.controller.ts`; `shared/access/route-tier-consistency.spec.ts`; `apps/server-e2e/src/notifications/guardian-preferences.e2e-spec.ts`; `apps/server-e2e/src/families/families.e2e-spec.ts` | 1 d |
| S3 clients + docs | `apps/mobile/src/features/subscription/MySubscriptionScreen.tsx`; `features/auth/AccessExpiredScreen.tsx`; `features/payments/OnlinePurchaseSection.tsx`; `features/clubs/ProfileMembershipSections.tsx`; `features/profile/SettingsScreen.tsx`; `shared/api/act-as.ts` (+spec); `apps/admin/src/features/payments/PaymentEntrySheet.tsx` (+spec); `features/audit/audit-meta.ts`; `docs/strategy/concept.md` (§2.9, §3 item 6); `docs/demo.md`; `CHANGELOG.md` | 1 d |

Interface between the slices: §1 (payer rule), §3.1 (`actorUserId` on the two features; `autopay: null`
under act-as), §3.3 (`payer: { userId, name } | null` on the journal entry), §3.5 (`PATCH
me/memberships/:clubId/notifications` accepted under act-as).

Checks for the integrator: tsc server / admin / mobile; `-- online-payments`, `-- member-payments`,
`-- pay-event-registration`, `-- payment-activation`, `-- payment-journal`, `-- export.service`,
`-- recipient-gates`, `-- notification-producer`, `-- daily-club`, `-- review-reminders`,
`-- notification-mute`, `-- route-tier-consistency`; admin and mobile unit tests; server e2e
`payments/*`, `notifications/*`, `families/*`; contract drift; `cs-reviewer` before merge.

## 12. Open risks

- **Legal: who is the consumer.** The parent pays, the child receives the service. The receipt names the
  buyer's e-mail only, which matches 54-ФЗ practice; the club's offer to members should say a legal
  representative may buy for a minor. That goes into the lawyer's questions (`docs/legal/README.md`).
- **Two guardians, one shared mute.** Mom mutes Миша's club and Dad stops getting chatter too. The row
  says «для Миши», not «для меня». Accepted as the boring rule; a per-guardian switch is a new table later.
- **Guardian's own mute silencing the child** may surprise a parent who trains in the same club and muted
  it for themselves. Payment, access and class-change notices still come; the Settings line explains it.
- **Old ticket payments** made under act-as keep `payerUserId = null` and show the child as payer in the
  journal. There are few of them, it's display only, and there is no backfill source.
- **A gated guardian copy is not retried.** If a parent re-enables a category, past notices don't
  reappear. That is today's adult behaviour.
- **`listMyAutopays` in a child's profile.** `OnlinePurchaseSection.tsx:4,105` reads the child's
  agreements, which is always an empty list. It's harmless, one extra request.
