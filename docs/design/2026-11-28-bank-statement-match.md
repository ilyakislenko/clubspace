# «Сверить выписку»: bank transfers matched to unpaid abonements

Status: **implemented** · 2026-11-28 · branch `feat/bank-statement-match`
Builds on the [payments journal](2026-11-15-payments-journal.md) (manual marks, «Перевод», «Отметил»)
and [parent pays for child](2026-11-26-parent-pays-for-child.md) (guardians as payers).

## Кратко (для владельца)

Большинство клубов в России получают оплату переводом на счёт клуба или на карту владельца. Потом
владелец часами сверяет выписку с абонементами «Ожидает оплаты».

Что сделали:
1. **«Платежи» → «Сверить выписку».** Загрузите выписку из банка: выгрузку для 1С (`.txt`, её умеет
   любой банк для бизнеса), CSV или Excel из интернет-банка (например, операции Т-Банка).
2. **Таблица сверки.** Каждое поступление сопоставлено с неоплаченными абонементами клуба:
   - **«Совпадают»** — уверенное совпадение, уже выбрано;
   - **«Нужно выбрать»** — несколько подходящих абонементов или сомнение; выберите нужный в списке;
   - **«Без пары»** — поступления, которым нет неоплаченного абонемента (аренда, корпоративный счёт);
   - **«Уже сверены»** — переводы из прошлой загрузки этой же выписки.
3. **«Отметить оплату»** отмечает выбранные абонементы оплаченными: способ «Перевод», дата — день
   перевода, сумма — сколько пришло. Если сумма отличается от цены, это написано у строки до
   подтверждения.
4. **Повторная загрузка той же выписки ничего не отметит дважды.**

Делать это могут только владелец и администраторы. Файл выписки не сохраняется; имена плательщиков
используются только для сверки во время загрузки.

## Problem

- Transfers are the main way RU clubs are paid (owner's/coach's card or the club's account), and
  `POST …/subscriptions/:id/payment` («Отметить оплату») takes one abonement at a time, dated *now*.
- The data needed to match is already here: unpaid abonements (`awaitingPaymentWhere`,
  `domains/subscriptions/renewal-rules.ts`), members' names and phones, confirmed and pending
  guardians (`memberGuardiansSelect`, `features/dependents/schemas.ts`).

## Goal / non-goals

Goal: one upload → review → confirm, safe to repeat, never a silent wrong mark.

Non-goals:
- Bank API integrations (Т-Банк/Сбер business APIs): a file works for every bank and every account
  type, including a coach's personal card.
- Splitting one transfer over several abonements, or several transfers into one abonement: flagged,
  marked by hand in the member card.
- A «partially paid» abonement state: the model has none (`Subscription.isPaid`); a different amount
  is recorded as received, exactly like «Отметить оплату» with a changed amount (a one-off discount,
  `pricedById` = who confirmed).
- PDF statements, old `.xls`: refused with a message naming the formats that work.

## 1. Data model

New table, additive (`db push` without `--accept-data-loss`):

```prisma
model BankStatementMatch {
  id             String   @id @default(uuid()) @db.Uuid
  workspaceId    String   @db.Uuid   // Cascade with the club
  fingerprint    String   @db.Char(64)
  subscriptionId String   @db.Uuid   // Cascade with the sale
  amount         Int
  paidOn         DateTime
  transferDay    String   @db.Char(10) // the bank's day, YYYY-MM-DD
  matchedById    String   @db.Uuid   // display only, no FK
  createdAt      DateTime @default(now())
  @@unique([workspaceId, fingerprint])
  @@index([subscriptionId])
  @@index([workspaceId, transferDay, amount])
}
```

- **Fingerprint** = sha256 of `workspaceId | day[Ttime] | amount in kopecks | normalised payer |
  document number | n` where *n* counts identical earlier lines of the same file (two equal transfers
  on one day stay two). Nothing else about the transfer is stored: no payer name, no purpose, no file.
- Written in the **same transaction** as the mark (`SubscriptionService.markPaidInTx`); the unique
  makes a second confirm of the same transfer fail with P2002 → reported «уже сверен».
- `unmarkPaid` deletes the abonement's rows, so a wrong match undone with «Отменить отметку» can be
  matched again from the same statement.
- **Soft key** = workspace + `transferDay` + amount. The fingerprint holds only for the same export:
  the same transfer from 1C (no time) and from CSV (with a time), or read with another payer column,
  fingerprints differently. A preview row whose day and amount match a confirmed row is held back
  (never pre-selected) with `MAYBE_ALREADY_MATCHED` — «уже сверяли перевод на эту сумму в этот день».
  Two real transfers of one amount on one day get the same note; the admin decides. Confirmed rows
  whose fingerprint is in the upload itself are ignored here (they show as «уже сверены»), so
  re-uploading a partly confirmed statement doesn't flag the rest of that day.

## 2. Formats (`features/bank-statements/statement-*.ts`)

| Format | Detection | Reading |
|---|---|---|
| 1CClientBankExchange | file starts with the ASCII signature | UTF-8, else Windows-1251, else DOS-866 (whichever reads `СекцияДокумент`). Statement accounts = header and `СекцияРасчСчет` `РасчСчет=`. Credit = `ПолучательСчет` is ours and `ПлательщикСчет` isn't; without account lines, a document with `ДатаПоступило` and no `ДатаСписано`. Date = `ДатаПоступило` ‖ `Дата`; payer = `Плательщик1` ‖ `Плательщик` without ИНН/КПП/`//address//`; purpose = `НазначениеПлатежа` (+ `…1-6`). |
| CSV | anything else that decodes (UTF-8/1251/UTF-16 via `club-import-csv`) | header row = first of the first 30 rows naming a date and an amount column. Columns by name: date («Дата операции» > «Дата проведения» > «Дата»), amount («Сумма операции», «Сумма платежа», «Приход/Поступление/Кредит», «Сумма»; never cashback/rounding/fee), payer («Плательщик», «Отправитель», «Контрагент», «Описание»), purpose, currency, status (failed/declined skipped), document number, direction («Тип операции», «Дебет/Кредит», «Приход/Расход», «Направление» as text). Positive amount = incoming; a direction cell overrides that only when it reads as one side (outgoing: дебет/расход/списание…, not also incoming); any other value («Перевод СБП») falls back to the sign. |
| XLSX | `PK\x03\x04` | `read-excel-file/node` (the dependency the club import already uses), first sheet → same table reader; date cells → `ДД.ММ.ГГГГ ЧЧ:ММ`. The library never sees the upload: `statement-xlsx-guard.ts` reads the central directory (≤ 500 entries, ZIP64 sizes from the extra field, no encryption), requires each local header's method, flags and sizes to agree with it (with a data descriptor: local sizes 0 and no `PK\x07\x08` inside the data), inflates every entry with zlib's `maxOutputLength` = its declared size with the declared total capped at 50 МБ, and rebuilds a plain archive of those bytes stored uncompressed with exact sizes. That rebuilt archive is what `readSheet` gets, so nothing in it can inflate further. |

Unrecognised columns → the preview returns `columns.complete = false` with headers and three sample
rows; the admin picks date / amount / payer (/ purpose) and the client uploads the same file again
with `dateColumn`… form fields. Limits: 5 МБ, 20 000 rows, 200 columns, 3 000 incoming transfers.

**Direction.** `directionKnown` is true for 1C, when a direction cell reads as one side, for a credit-only amount column,
and when some row has a negative or empty amount. An unsigned amount without any of these may hide
refunds the club paid out, so nothing is pre-selected and the panel says «В файле не видно, где
поступления, а где списания».

**Times.** Times in CSV/Excel exports of Russian banks carry no zone and are Moscow time
(`BANK_TIMEZONE = Europe/Moscow`): a timed transfer is dated that instant; one without a time at the
club's midnight of the bank's day.

## 3. Matching (`statement-match.ts`, pure)

Candidates: the club's «Ожидают оплаты» abonements (`awaitingPaymentWhere`) whose window can reach
the statement's days, newest first, at most 5 000 (`STATEMENT_MAX_CANDIDATES`); same currency; transfer
date within `[sale/start − 30 days, sale/start + 120 days]`. Payers are the member and the guardians the
club recorded, **confirmed or not yet** (`memberGuardiansSelect`): the admin confirms every match.

Speed: each transfer and each abonement is tokenised once; an index (amount, member/guardian names,
the student's name stems, phones) gives each transfer only the abonements that could fit. A
3 000 × 1 000 statement matches in well under a second (spec guard: 5 s).

Names are normalised (lower case, ё → е, letters only). Name level of a text for a person: **3** surname
+ first name or first initial («ИВАНОВ ИВАН ИВАНОВИЧ», «Иванов И.И.»), **2** first name + surname
initial («Иван И.», card-bank style), **1** surname alone; a contradicting initial («Иванов П.») → 0.
A one-letter word is an initial only when written with a dot or right after the surname / first name
(«ИВАНОВ И И»), never in the purpose: «оплата в ноябре Петров» doesn't name Виктор. First name and
surname must be different words: «за Петрова» names no Пётр.

Score: exact amount +50 (within 10 % +20); payer = member or guardian (payer field, and the purpose
for a guardian — СБП senders in 1C) level 3/2/1 → +40/+28/+12 (a guardian counts only at level ≥ 2);
the student named in the purpose, any case form by stem («за Петрова Мишу») → +35, first name only when
a parent paid → +25; a member's or guardian's phone in the text → +45; date proximity up to +10.

**Confident (pre-selected)** only if all hold: exact amount; identity level ≥ 2 (level 2 only within
31 days of the sale/start); the best leads the second candidate by ≥ 20; the amount is not the sum of
several of the payer's abonements. An abonement two transfers point at confidently goes to neither
(`SAME_ABONEMENT_TWICE`). Everything else with candidates is «Нужно выбрать» (top 5 shown, with why);
no candidates → «Без пары». Flags shown in words: `SIMILAR_CANDIDATES`, `SEVERAL_ABONEMENTS`,
`SAME_ABONEMENT_TWICE`, `MAYBE_ALREADY_MATCHED` (soft key, §1); a picked candidate whose price differs
gets the amount warning. The preview also holds everything back when the direction is unknown (§2).

## 4. Server

| Endpoint | Method | Tier | DTOs |
|---|---|---|---|
| `POST workspaces/:workspaceId/bank-statements/preview` (multipart `file` + optional column fields) | `previewBankStatement` | `CLUB_ADMINS` + `assertClubAdmin` | `PreviewBankStatementForm` → `PreviewBankStatementOutput` |
| `POST workspaces/:workspaceId/bank-statements/confirm` | `confirmBankStatement` | `CLUB_ADMINS` + `assertClubAdmin` | `ConfirmBankStatementInput` → `ConfirmBankStatementOutput` |

- Preview: parse → fingerprints → already-matched rows (shown with the member, never re-matched) →
  soft-key rows → candidates → `matchStatement`. Payer/purpose are echoed back for the review only.
- Confirm (≤ 500 matches): refuses a payload with one abonement or one transfer twice. Each match in
  its own transaction: fingerprint row + `markPaidInTx` (`paymentMethod: 'TRANSFER'`, `amount` =
  received, `paidAt` = the bank's time in Moscow time, or the club's midnight of the bank's day,
  `markedById` = the admin). A computed `paidAt` after now or older than 400 days fails that row only.
  Results per match: `CONFIRMED`, `ALREADY_MATCHED` (P2002), `FAILED` (date out of range, paid by hand
  meanwhile, cancelled, not found) — one failure doesn't stop the rest. Audit:
  `member.markSubscriptionPaid` per mark, metadata as the manual mark + `paidOn`, `bankStatement: true`.
  Realtime: `members`, `subscription`, `payments`.
- Pinned in `route-tier-consistency.spec.ts` (CLUB_ADMINS list).

## 5. Admin

«Абонементы → Платежи» toolbar: outline «Сверить выписку» next to «Скачать CSV» (the page is already
`ClubAdminGate`). A side panel (`StatementMatchSheet.tsx`): file → (column picker if needed) → review
grouped «Совпадают / Нужно выбрать / Без пары / Уже сверены», one native select per transfer («Не
отмечать» + candidates), one primary «Отметить оплату · N» (disabled while an abonement is chosen
twice) → result with the failures. Closing with chosen matches asks first (`useDirtyGuard`). History
labels: «Дата перевода», «По банковской выписке». The page's «?» help lists the action.

## 6. Tests

- `statement-values.spec.ts` (amounts, dates, payer cleanup), `statement-parse.spec.ts` with fixtures
  in `features/bank-statements/__fixtures__/` (1C in 1251 and UTF-8, a DOS-866 sample, Т-Банк CSV,
  Сбер-style CSV with a title block and a credit column, Т-Банк XLSX, unknown columns, refusals,
  crafted zips (declared bomb, lying entry, local/central method mismatch, descriptor signature in the
  data, ZIP64 sizes, hidden entry dropped, too many entries), > 200 columns, a direction
  column, unsigned amounts, fingerprints).
- `statement-match.spec.ts`: initials, ё, «Иван И.» time limit, parent pays for a child, two siblings
  told apart by the purpose, declined names, phone, two students with the same amount, unknown payer,
  partial payment, one transfer for two abonements, two transfers for one abonement, window/currency,
  prepositions never initials («в ноябре Петров»), surname not read as the first name («за Петрова»),
  a 3 000 × 1 000 speed guard.
- `preview-bank-statement.handler.spec.ts` (RBAC, windowed and capped candidates, re-upload shows
  «уже сверены», soft key held back, unknown direction held back, parent named, column picking),
  `confirm-bank-statement.handler.spec.ts` (RBAC, marks with TRANSFER/date/amount and fingerprint +
  transfer day in one transaction, Moscow bank time, per-row date failures, audit, idempotency, partial
  failures, payload refusals).
- `subscription.service.spec.ts`: `paidAt` honoured, unmark deletes the fingerprint.
- Admin: `statement-view.spec.ts`, `StatementMatchSheet.spec.tsx` (incl. the unknown-direction note).

## 7. Decisions

- **Conservative auto-selection.** Only exact amount + a named payer + a clear lead; the admin always
  confirms. A wrong automatic mark is worse than one more click.
- **One transfer ↔ one abonement.** Sums are flagged, not split.
- **No stored statement, no stored names.** Only the fingerprint and the resulting payment.
- **Confirm trusts the reviewed values** (amount, day) the same way «Отметить оплату» trusts a typed
  amount: the route is club-admin only; the day is bounded to the past 400 days.
- **Pending guardians count as payers.** The club recorded the link itself; the admin confirms anyway.
