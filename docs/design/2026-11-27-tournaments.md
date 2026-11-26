# Federation tournaments MVP: divisions, weigh-in, brackets, results

Status: **design** · 2026-11-27 · base: `main` @ `1c0321ed` (federation hub merged in #510)
Parent: [federation hub MVP](2026-11-26-federation-hub-mvp.md) §12 item 1 (the sketch this doc expands), §1 (rules),
§2 (models), §3.3 (registration), §10 (decisions). File references are as of `1c0321ed`. The owner was asleep: every
owner-level choice is in §13 «Decisions» and may be overruled.

## Кратко (для владельца)

Сейчас федерация может опубликовать турнир и собрать запись. Дальше всё идёт на бумаге: взвешивание, сетки, протокол.
Этот документ описывает, как провести турнир в ClubSpace от записи до итогов. Объём рассчитан на одну ночь работы
трёх агентов: сервер, админка, телефон + демо.

1. **Категории задаёт сама федерация в каждом турнире:** пол, возраст, пояс по стандарту федерации, вес. Это
   настройки турнира, а не список, зашитый в программу. Форма «Добавить категории» создаёт разом все весовые
   категории для выбранных пола, возраста и поясов. Категории прошлого турнира можно скопировать.
2. **Заявка:** ученик (за ребёнка — родитель) записывается на турнир, как и сейчас, и указывает вес. Его тренер
   подтверждает заявку, и система сама находит категорию. Заявку, которую подал тренер, подтверждать не нужно.
3. **Взвешивание на планшете:** поиск по фамилии, записать вес. Если вес не подходит, система предлагает
   соседнюю категорию: «Перевести в «−82 кг»» одной кнопкой. Тех, кто не пришёл на взвешивание, в сетки не берём.
4. **Сетки на выбывание собираются автоматически:** спортсмены одного клуба разводятся как можно дальше друг от
   друга, «свободные проходы» достаются, если участников не 4, 8, 16…
5. **За столом у ковра:** экран «Ковры». На нём текущая схватка и очередь. Секретарь отмечает победителя, способ
   победы и, если нужно, очки, а победитель сам переходит в следующий круг. Ошибку можно отменить. Если два
   планшета записали одну схватку, запишется первый результат, а второй планшет увидит «Результат уже записан».
6. **Места 1, 2, 3, 3** (без схватки за третье место). Итоги публикует администратор федерации. После публикации
   места попадают в реестр как «призёр» и в «Мои пояса» спортсмена — только у тех, кто дал согласие федерации.
7. **Телефон:** спортсмен и родитель видят категорию, сетку и следующую схватку («Ковёр 2, перед вами 2
   схватки»). Тренер видит своих спортсменов: категорию, ковёр, очередь и места.
8. **Персональные данные (152-ФЗ, дети):** согласие федерации расширяется. Год рождения, пол и вес нужны
   федерации для категорий, а имена в сетках и итогах видят участники клубов федерации. Тот, кто давал старое
   согласие, при подаче заявки подтверждает новую редакцию одним нажатием. Вес и год рождения видят только
   федерация, свой тренер и сам спортсмен. Вес стирается через 30 дней после публикации итогов.
9. **Демо:** в федерации три турнира. «Кубок федерации, 2-й этап» идёт прямо сейчас, на 3 коврах. «Кубок
   федерации, 1-й этап» прошёл 40 дней назад, итоги опубликованы. «Открытый турнир Томской области» ещё впереди,
   идёт приём заявок. Добавлен новый вход для секретаря турнира: `secretary@academy.demo`.

Не входит: судейский планшет с секундомером и табло, круговая система, командный зачёт, взносы, заявки в день
турнира без записи через приложение, публичная страница итогов (§15).

## 1. Problem, goal, non-goals

**Problem.** The hub ships a federation calendar with free registration (`OrganizationEvent` kind `COMPETITION`,
`OrganizationEventRegistration`, `schema.prisma:4416-4470`; booking under a row lock, `domains/organizations/org-events.ts:87`).
After registration nothing exists: no divisions, weights, brackets or results. The head coach's demo stops at
«23 записи по клубам», and a real tournament is still run on paper and Excel.

**Goal.** The head coach of a city federation can run one individual single-elimination tournament end to end inside
ClubSpace. He configures divisions, takes entries from existing registrations (declared weight, confirmed by the
athlete's coach) and runs a tablet weigh-in with moves between divisions. Brackets are auto-seeded with same-club
athletes apart and byes, and mat-side tables enter results that advance winners automatically. Placings 1/2/3/3
are published, and published podiums feed the registry and the athlete's «Мои пояса». Athletes and parents follow
their division and next match in the app; club coaches follow their own athletes.

**Non-goals:** §15. **Ground rules:** as in the hub doc §«Ground rules»: additive `db push`, `@unique` only on new
tables, authorize in the handler, `serialize*`, unique controller-method/DTO names, contract regen, sport-agnostic code
(BJJ only in demo content and in the org-type vocabulary), the UI rules of `ui-slop-detector` (§9).

## 2. The rules

### 2.1 Lifecycle

`Tournament.status` (one per `OrganizationEvent` of kind `COMPETITION`):

| Status | Who moves it | Clubs may | Org staff may |
|---|---|---|---|
| `SETUP` | created by an org admin | declare / confirm / cancel entries (until `registrationClosesAt`, as booking) | edit divisions, see entries, move entries |
| `WEIGH_IN` | org staff (`SETUP ↔ WEIGH_IN`) | nothing (409 `TOURNAMENT_LOCKED`) | weigh, move, withdraw, edit divisions, draw a division |
| `RUNNING` | org staff (`WEIGH_IN → RUNNING`, one way) | nothing | record / undo results, redraw a division without results, move between divisions without results |
| `FINISHED` | org admin «Опубликовать итоги» (every drawn division finished) | — | admin may «Снять публикацию» → back to `RUNNING` |

- **Start** (`WEIGH_IN → RUNNING`) draws every undrawn division that has eligible entries. Eligible means
  `CONFIRMED`, weighed and with a division. Confirmed entries that were never weighed become `WITHDRAWN` with
  reason «Не взвешен»; the confirm dialog names the count first. The start is refused while a weighed entry has
  no division (409 `TOURNAMENT_UNASSIGNED`, «3 участника без категории»).
- **`FINISHED` is «published»**: `resultsPublishedAt` is set, places become visible outside the console, and the
  registry and «Мои пояса» show podiums. Unpublishing hides them again until the next publish.
- Phase changes and club-side entry writes take `SELECT … FOR UPDATE` on the `Tournament` row, so a declaration
  can't slip in after «Начать взвешивание».

### 2.2 Roles

| Action | Org admin | Org coach (секретарь, судья-секретарь) | Club coach (`COACHING_ROLES`) | Athlete / guardian (act-as) |
|---|---|---|---|---|
| Create tournament on a COMPETITION event, edit mats | ✓ | — | — | — |
| Divisions, weigh-in, moves, withdrawals, draw, phase SETUP↔WEIGH_IN→RUNNING | ✓ | ✓ | — | — |
| Record / undo a result (not after publication) | ✓ | ✓ | — | — |
| Publish / unpublish results | ✓ | — | — | — |
| Declare an entry (weight, sex, birth year) | — | — | own-scope students (`assertCanWriteMember`) — auto-confirmed | self / own child |
| Confirm an entry, pick a level when the registry has none | — | — | own-scope students | — |
| See own athletes' entries, weights, schedule | (all) | (all) | own scope (admin scope: whole club) | self / own child |
| See a bracket / results of the tournament | ✓ | ✓ | ✓ (names per §2.3) | ✓ (names per §2.3) |

Org staff never get club routes and club staff never get org routes (hub §1). A federation volunteer at a
table is added as `ORG_COACH` (hub «Команда»); a dedicated per-event judge role is §15.

### 2.3 What is visible to whom

| Datum | Org staff | Own club coach | Self / guardian | Members of other federation clubs |
|---|---|---|---|---|
| Name, club in bracket / results | if visible¹ | ✓ | ✓ | if visible¹ |
| Division, place, match method / score | ✓ | ✓ | ✓ | ✓ |
| Birth year, sex, declared / weighed weight | if visible¹ | ✓ | ✓ | **never** |
| Level (belt) | as registry, or the coach-picked level | ✓ | ✓ | division label only |

¹ *Visible* = a live `ORGANIZATION_SHARING` consent for this org at or above `TOURNAMENT_CONSENT_MIN_VERSION`, own
or a guardian's for a child (hub `consent.ts:101`), **and** the club still `ACTIVE` in the org. Otherwise the
person shows as «Участник скрыт», with no club, everywhere including the console. The bracket keeps its shape, so
withdrawing consent never rewrites results. The hub has the same rule for registrations (`hiddenCount`, hub §10).

### 2.4 Consent (152-ФЗ, children)

- **Reuse the one federation consent; bump its edition.** `ORG_SHARING_CONSENT_VERSION` becomes `2026-11-27.1`. The
  text (own and the guardian's «моего ребёнка» wording, `consent.ts:18`) adds: «для турниров федерации — год
  рождения, пол и вес на взвешивании; имя, клуб, категория и результаты видны участникам и тренерам клубов
  федерации». It keeps «Федерация не получает контакты, дату рождения и фото» (birth *year* only).
- `TOURNAMENT_CONSENT_MIN_VERSION = '2026-11-27.1'`. `hasOrgConsent(prisma, orgId, personId, { minVersion })`
  compares editions as strings (date-prefixed). Older editions still count for the registry and plain
  registration (they cover what they said), but an entry needs the new one.
- An entry write with an older edition → **409 `ORG_CONSENT_REQUIRED`**: the existing mobile flow opens
  `OrgConsentSheet` with the server's current `consentText`, and «Разрешить» re-grants. `grantOrgConsent` now
  writes a new record when the live one is older than the current edition. Without a live one it writes a new
  record as before; a current live record is still a no-op.
- A coach can't consent for a student. A coach declaration for a student on an old edition gets the same 409, and
  the coach sees «Ученик должен обновить согласие в приложении».
- **Children:** only a guardian's consent counts (confirmed guardianship). Pushes for a child go to guardians
  (`guardian-routing`, already in `NotificationProducerService`). No photos anywhere in tournament screens.
- **Retention:** the minute job sets `declaredWeightG` and `weighedWeightG` to null 30 days after
  `resultsPublishedAt`, or 30 days after the event's end (its start without an end) when the results are not
  published, so an abandoned or unpublished tournament doesn't keep weights and a republish never restarts the
  clock. Places stay (they are the result), birth year and sex stay (they explain the division).
- Lawyer questions go to `docs/legal/README.md` (§16).

## 3. Data model (Prisma, additive; `db push` without `--accept-data-loss`)

Notation as in the hub doc: every model also has `id String @id @default(uuid()) @db.Uuid`, `createdAt`, `updatedAt`;
FKs `@db.Uuid` with the `onDelete` noted. Weights are **grams as `Int`** (no Decimal round-trips; the API speaks kg
with one decimal).

```prisma
enum TournamentStatus      { SETUP WEIGH_IN RUNNING FINISHED }
enum CompetitorSex         { FEMALE MALE }
enum TournamentEntryStatus { DECLARED CONFIRMED WITHDRAWN }
enum MatchWinMethod        { FINISH POINTS DECISION DISQUALIFICATION WALKOVER } // labels via org-type vocabulary

model Tournament {
  organizationId → Organization (Cascade)            // denormalized for org-scoped reads
  eventId String @unique → OrganizationEvent (Cascade)
  status TournamentStatus @default(SETUP)
  matCount Int @default(1)                           // 1..12
  resultsPublishedAt DateTime?
  createdById? → User (SetNull, @relation("TournamentCreatedBy"))
  @@index([organizationId])  @@index([resultsPublishedAt])
}
model TournamentDivision {                           // config per tournament — no global weight/age/belt enums
  tournamentId → Tournament (Cascade)
  name String @db.VarChar(120)                       // generated from the criteria, editable
  sortOrder Int
  sex CompetitorSex?                                 // null = mixed
  ageMin Int?   ageMax Int?                          // inclusive; age = event's local year − birth year
  templateId String? @db.Uuid                        // org ladder template (plain id: survives template edits)
  levelOrderFrom Int?   levelOrderTo Int?            // inclusive range of OrganizationLadderTemplateLevel.order
  levelLabel String? @db.VarChar(120)                // snapshot «Синий – коричневый» for display
  weightMinG Int?                                    // exclusive; null = no lower bound
  weightMaxG Int?                                    // inclusive; both null = open weight («абсолютная»)
  mat Int?   matOrder Int?                           // queue order on that mat
  drawNo Int @default(0)                             // +1 per draw; part of the seeding salt
  drawnAt DateTime?   finishedAt DateTime?           // finishedAt = places final
  @@index([tournamentId, sortOrder])
}
model TournamentEntry {
  tournamentId → Tournament (Cascade)
  registrationId String @unique → OrganizationEventRegistration (Cascade)
  userId → User (Cascade)                            // the athlete (a child, not the guardian)
  workspaceId → Workspace (Cascade)                  // club of the registration
  divisionId? → TournamentDivision (SetNull)
  status TournamentEntryStatus @default(DECLARED)
  sex CompetitorSex   birthYear Int
  declaredWeightG Int?                               // required on write; null only after retention
  declaredById String? @db.Uuid
  templateLevelId String? @db.Uuid   levelName String? @db.VarChar(255)   // snapshot at confirmation
  levelSetById String? @db.Uuid                      // null = taken from the registry; set = coach picked it
  confirmedById String? @db.Uuid   confirmedAt DateTime?
  weighedWeightG Int?   weighedAt DateTime?   weighedById String? @db.Uuid
  withdrawnReason String? @db.VarChar(120)
  place Int?                                         // 1 | 2 | 3 once the division is finished
  @@unique([tournamentId, userId])
  @@index([tournamentId, divisionId])  @@index([workspaceId])  @@index([userId])
}
model TournamentMatch {
  divisionId → TournamentDivision (Cascade)
  tournamentId String @db.Uuid                       // denormalized (mat queue, polling reads)
  round Int   position Int                           // round 1 = first; position 1..bracketSize/2^round
  entryAId? → TournamentEntry (SetNull, @relation("MatchEntryA"))
  entryBId? → TournamentEntry (SetNull, @relation("MatchEntryB"))
  isBye Boolean @default(false)                      // round 1 with one athlete: decided at draw, never queued
  winnerEntryId? → TournamentEntry (SetNull, @relation("MatchWinner"))
  method MatchWinMethod?   scoreA Int?   scoreB Int?   note String? @db.VarChar(120)
  decidedAt DateTime?   decidedById String? @db.Uuid
  @@unique([divisionId, round, position])  @@index([tournamentId, decidedAt])
}
```

Existing models gain only back-relation fields (no columns): `Organization.tournaments`,
`OrganizationEvent.tournament Tournament?`, `OrganizationEventRegistration.tournamentEntry TournamentEntry?`,
`User` (entries + `TournamentCreatedBy`), `Workspace.tournamentEntries`. No backfill; `deploy/update.sh` untouched.

**Limits** (zod, read by admin `contract-limits.ts`): division name ≤ 120; ≤ 60 divisions per create call, ≤ 200 per
tournament; ≤ 64 entries drawn per division (more → 400 «Разделите категорию»); `matCount` 1–12; weight
10.0–250.0 kg, step 0.1; birth year 1930–current year; ages 3–99; scores 0–999; note ≤ 120.

## 4. Domain — `apps/server/src/domains/tournaments/` (new, sport-agnostic)

### 4.1 `divisions.ts` (pure)

- `ageFor(birthYear, eventLocalDate)` = event year − birth year (Russian federations' «по году рождения» rule).
- `fits(entry, division, levelOrder)` checks sex (null division = any), age band, level range
  (`templateId` matches the level's template and `order` is within the range; `templateId` null = any level), and
  weight (`min < w ≤ max`). Weight is the weighed weight once present, else the declared one.
- `matchDivision(entry, divisions)` → the one fitting division, or `null` when none or several fit (the org assigns
  by hand; the list filter «Без категории» finds them).
- `suggestDivision(entry, divisions, currentId)` → for an off-weight entry, the fitting division with the same
  sex/age/level criteria (the next weight up or down).
- `divisionName(criteria, levels, vocabulary)` → «Мужчины · 18–35 лет · Синий – коричневый · до 76 кг» / «св. 94 кг»
  / «абсолютная». It also powers the preview rows of «Добавить категории».

### 4.2 `bracket.ts` (pure) — seeding, advancement, placings

- `bracketSize(n)` = smallest power of two ≥ n (1 → 1: no matches).
- `seedBracket(entries: {id, clubId}[], salt)` → `slots: (entryId | null)[]` of length P, then
  `firstRoundMatches(slots)`. Salt = `${divisionId}:${drawNo}`; `h(x)` = sha256(salt + x).
  1. Order: clubs by size desc, then `h(clubId)`; within a club, by `h(entryId)`. Input order doesn't matter.
  2. `place(list, size)`: a node with `k` athletes gives the left half `ceil(k/2)` and the right half `floor(k/2)`.
     Since n > P/2, every subtree keeps k ≥ size/2. So **byes land only in round 1 and never two in one pair**, and
     there are P − n of them.
  3. Filling the halves: walk the ordered list; each athlete goes to the half with fewer athletes of *their* club.
     On a tie, it goes to the half with more free capacity; on a further tie, to the side chosen by `h(clubId)`
     bit. A full half is skipped. Recurse into each half with its sub-list.
  4. Invariant (unit-pinned): at every node, for every club, `|left − right| ≤ 1` unless one side is at
     capacity. Two athletes of a club with c ≤ P/2^(r) members never meet before round r+1. For example, two
     teammates in an 8-bracket meet only in the final, and four go one per quarter.
- `nextSlot(round, position)` → `{ round: round + 1, position: ceil(position / 2), side: position odd ? 'A' : 'B' }`.
- Byes are written at draw as `isBye` matches with `winnerEntryId` = the athlete and advanced at once. A bye is
  never queued; the bracket shows it as the name with muted «проходит без схватки».
- `placingsFor(matches, entries)`:
  - 1 = final winner, 2 = final loser, 3 = each loser of the semifinal round (one or two).
  - A loser by `WALKOVER` or `DISQUALIFICATION` gets no place.
  - A division of one athlete gets place 1 at draw (`finishedAt` set; the UI says «без соперника»).
  - A division of two is the final only (1/2). A division of three has one bronze.
- Pure functions only; the demo seed (S3) calls the same `seedBracket` and `placingsFor`, so demo brackets are
  real brackets.

### 4.3 `schedule.ts` (pure)

- `matQueue(divisions, matches, mat)` lists the **ready** matches of that mat: both athletes known, undecided, not a
  bye. Order: division `matOrder`, then `round`, then `position` (a division runs to its end before the next).
  Divisions without a mat aren't queued (the console shows «Ковёр не назначен»).
- `nextMatchFor(entryId, …)` → `{ mat, ahead, opponent | null, waitingFor? }`:
  - `ahead` is the count of queued matches in front;
  - a missing opponent gives `waitingFor` = the feeding match («ждёт победителя схватки Петров — Сидоров»);
  - eliminated or finished → null, plus the place when there is one.
- `autoAssignMats(divisions, matCount)`: longest-first greedy by estimated matches (`entries − 1`) over mats,
  `matOrder` by `sortOrder`; touches only divisions without results.

### 4.4 `tournament-store.ts` (transactions)

- Every bracket write takes `SELECT … FROM "TournamentDivision" WHERE id = $1 FOR UPDATE`: draw, result, undo,
  move, withdrawal. A move locks both divisions in id order (no deadlock).
- **Draw:** refused when any non-bye match of the division is decided (409 `DIVISION_HAS_RESULTS`). It deletes the
  old matches, `drawNo + 1`, writes all rounds (later rounds empty), resolves byes, and stamps `drawnAt`.
- **Result** (`recordResult`):
  - match ready (both athletes, not a bye); `winnerEntryId` ∈ {A, B};
  - `claimUnchanged(expectedUpdatedAt)` on the match (conventions §1, `StaleUpdateError` 409 `STALE_UPDATE`);
  - **idempotent retry:** a decided match whose stored result equals the request (winner + method + scores)
    returns 200 with the current state, whatever the `expectedUpdatedAt`;
  - writes the result, puts the winner into `nextSlot`, and on the final computes places
    (`TournamentEntry.place`) and sets `finishedAt`.
- **Undo:** refused when the tournament is `FINISHED` (409 `TOURNAMENT_PUBLISHED`), and refused when the next
  match (where the winner went) is decided (409 `MATCH_UNDO_BLOCKED`, «Сначала отмените схватку …»). It uses
  `claimUnchanged` too. It clears the result and the winner's slot downstream, and clears the division's places and
  `finishedAt`.
- **Move:** allowed in `SETUP`/`WEIGH_IN`. In `RUNNING` it is allowed only when neither division has results; it
  then clears both divisions' brackets (`drawnAt` null; the UI warns «Сетки обеих категорий нужно будет собрать
  заново»).
- **Withdrawal:** before the division is drawn only. After the draw, the table records `WALKOVER` for the
  opponent.

### 4.5 `tournament-read.ts` — the allow-listed readers

`loadTournamentForOrg`, `loadEntriesView`, `loadBracketView(audience)`, `loadResultsView`, `loadClubAthletes`,
`personPodiums(prisma, orgId, userIds, { publishedOnly })`. The single place that applies §2.3:
- names via `consentedPersonIds` with `minVersion` plus the ACTIVE club check;
- weights and birth year only for `audience: 'org' | 'ownClub' | 'self'`;
- the serialized bracket row for `'member'` audience has no weight, birth year or user id. A `personKey`
  (hub HMAC) is the stable handle for highlighting «you» on the client: the club bracket returns `isMe` and
  `isMyClub` booleans instead.

`data-source.spec.ts` (hub §3.1) widens its allow-lists: delegates `tournament\w*`, domain `tournaments`.

### 4.6 `tournament-dispatch.ts` (minute job, quiet hours)

See §6. Also runs the weight retention `updateMany` (§2.4), guarded by `@@index([resultsPublishedAt])`.

## 5. API

All new controllers: guards as the hub's (`OrganizationsEnabledGuard` first, then `AuthGuard,
OrganizationMemberGuard` + `@OrgRoles` on org routes; `AuthGuard, WorkspaceMemberGuard, RoleGuard` on club routes).
Tiers repeat in the handler (`assertOrgAdmin` / `assertOrgStaff`; club: `resolveCoachScope` +
`assertCanWriteMember`). `route-tier-consistency.spec.ts` checks the pairs automatically. No new env flag: the hub's
`ORGANIZATIONS_ENABLED` covers it.

### 5.1 Org console — `features/organizations/tournaments/` (prefix `orgs/:organizationId`)

| Route | Tier | Method name |
|---|---|---|
| `POST events/:eventId/tournament {matCount}` (COMPETITION only; one per event, idempotent on P2002) | admin | `createOrgTournament` |
| `GET tournaments/:tournamentId` (event title/date/tz, status, mats, counts: registrations, entries by status, unassigned, unweighed, divisions drawn/finished) | staff | `getOrgTournament` |
| `PATCH tournaments/:tournamentId {matCount, expectedUpdatedAt}` | admin | `updateOrgTournament` |
| `POST tournaments/:tournamentId/status {status: SETUP\|WEIGH_IN\|RUNNING}` (§2.1 transitions; RUNNING draws) | staff | `setOrgTournamentStatus` |
| `POST tournaments/:tournamentId/publication {published}` | admin | `publishOrgTournamentResults` |
| `GET tournaments/:tournamentId/divisions` (criteria, mat, counts, state) | staff | `listTournamentDivisions` |
| `POST tournaments/:tournamentId/divisions {rows[]}` (≤ 60) | staff | `createTournamentDivisions` |
| `POST tournaments/:tournamentId/divisions/copy {fromTournamentId}` (same org; criteria + mats, no entries) | staff | `copyTournamentDivisions` |
| `PATCH tournaments/:tournamentId/divisions/:divisionId {…criteria, name, mat, matOrder, expectedUpdatedAt}` | staff | `updateTournamentDivision` |
| `DELETE tournaments/:tournamentId/divisions/:divisionId` (no entries) | staff | `deleteTournamentDivision` |
| `POST tournaments/:tournamentId/mats/assign` (`autoAssignMats`) | staff | `assignTournamentMats` |
| `GET tournaments/:tournamentId/entries?q&divisionId&filter&curPage&perPage` (`filter`: all/unweighed/offWeight/unassigned/withdrawn/declared) | staff | `listTournamentEntries` |
| `PUT tournaments/:tournamentId/entries/:entryId/weigh-in {weighedKg}` → entry + `fits` + `suggestedDivisionId` (a DECLARED entry becomes CONFIRMED by the weigher) | staff | `recordTournamentWeighIn` |
| `POST tournaments/:tournamentId/entries/:entryId/move {divisionId}` | staff | `moveTournamentEntry` |
| `POST tournaments/:tournamentId/entries/:entryId/withdrawal {withdrawn, reason?}` | staff | `setTournamentEntryWithdrawn` |
| `POST tournaments/:tournamentId/divisions/:divisionId/draw` | staff | `drawTournamentDivision` |
| `GET tournaments/:tournamentId/divisions/:divisionId/bracket` | staff | `getTournamentBracket` |
| `GET tournaments/:tournamentId/mats/:mat/queue` (current + next 5) | staff | `getTournamentMatQueue` |
| `POST tournaments/:tournamentId/matches/:matchId/result {winnerEntryId, method, scoreA?, scoreB?, note?, expectedUpdatedAt}` | staff | `recordTournamentMatchResult` |
| `POST tournaments/:tournamentId/matches/:matchId/undo {expectedUpdatedAt}` | staff | `undoTournamentMatchResult` |
| `GET tournaments/:tournamentId/results` (podiums per division; finished flags) | staff | `getTournamentResults` |

Changes to hub routes (S1):
- `getOrgEvent` / `listOrgEvents` add `tournament: { id, status } | null`.
- `updateOrgEvent` refuses changing `kind` away from COMPETITION while a tournament exists (400).
- `deleteOrgEvent` refuses while the tournament is `RUNNING`/`FINISHED` (409 `TOURNAMENT_STARTED`).
- `getOrganizationRegistryPerson` adds `podiums[]` (`{ tournamentTitle, date, divisionName, place }`, published
  only) and `searchOrganizationRegistry` rows add `podiumCount` («призёр» mark).

### 5.2 Club side — `features/club-organizations/tournaments/` (prefix `workspaces/:workspaceId`)

| Route | `@Roles` / handler | Method name |
|---|---|---|
| `GET org-events/:eventId/tournament` → status, mats, my entry (self / act-as child: state, division, declared/weighed kg, next match, place), `consentCurrent`, `levels` (org template levels used by divisions, for the coach picker), staff: `toConfirmCount` | any member; event visible to this club as `listClubOrgEvents` | `getClubTournament` |
| `PUT org-events/:eventId/tournament/entry {userId?, declaredWeightKg, sex, birthYear?}` — needs a BOOKED registration through this club, `SETUP`, consent ≥ edition. `birthYear` defaults from `User.dateOfBirth` (required when absent). Self → `DECLARED` (a changed weight resets a confirmation); coach (`userId` set) → `CONFIRMED` + auto-division | any member; `userId` → `resolveCoachScope` + `assertCanWriteMember` (as `registerForOrgEvent`, `register-for-org-event.handler.ts:58`) | `declareTournamentEntry` |
| `POST tournament-entries/:entryId/confirm {templateLevelId?}` → CONFIRMED + `matchDivision`; level from the registry belt (`registryBeltsFor`), else the picked level (required then) | `COACHING_ROLES`; `assertCanWriteMember` | `confirmTournamentEntry` |
| `GET org-events/:eventId/tournament/athletes` → own-scope students with registration/entry state, division, weights, next match, place (admin scope: whole club) | `STAFF_ROLES`; `resolveCoachScope` | `listClubTournamentAthletes` |
| `GET org-events/:eventId/tournament/divisions/:divisionId/bracket` (RUNNING/FINISHED; `member` audience + `isMe`/`isMyClub`) | any member | `getClubTournamentBracket` |
| `GET org-events/:eventId/tournament/results` (FINISHED; podiums, `member` audience) | any member | `getClubTournamentResults` |

Changes to hub club routes (S1):
- `listClubOrgEvents` adds `tournament: { id, status } | null` and `myEntryState` (for the Events row line).
- `cancelOrgEventRegistration` refuses after `SETUP` (409 `TOURNAMENT_LOCKED`) and deletes a `SETUP` entry with the
  registration (cascade).
- `listMyClubOrganizations` adds `consentCurrent` and `podiums[]` for the caller (self / act-as; published only;
  own data, shown regardless of the current consent); one cache key `my-orgs:<ws>` keeps feeding «Мои пояса».
- `setMyOrganizationConsent` grants the current edition (re-grant over an older one).

### 5.3 Error codes

409 `TOURNAMENT_LOCKED` («Заявки закрыты — изменения через секретаря турнира»), 409 `ORG_CONSENT_REQUIRED` (reused),
409 `STALE_UPDATE` (reused; «Результат уже записан с другого планшета»), 409 `DIVISION_HAS_RESULTS`, 409
`MATCH_UNDO_BLOCKED`, 409 `TOURNAMENT_PUBLISHED`, 409 `TOURNAMENT_UNASSIGNED`, 409 `TOURNAMENT_STARTED`; 400 for
transitions out of order, «Разделите категорию», publishing with unfinished divisions («Не закончены: 2 категории»).
Errors are `DefaultError` subclasses next to the domain (as `OrgEventFullError`, `org-events.ts:65`).

### 5.4 Audit

Org side (`organizationId`, `workspaceId: null`), `<entity>.<camelCaseVerb>`:
- `tournament.create`, `tournament.update`, `tournament.statusChange`, `tournament.publish`, `tournament.unpublish`;
- `tournament.divisionsCreate`, `tournament.divisionsCopy`, `tournament.divisionUpdate`, `tournament.divisionDelete`,
  `tournament.matsAssign`;
- `tournament.weighIn`, `tournament.entryMove`, `tournament.entryWithdraw`, `tournament.draw`;
- `tournament.matchResult`, `tournament.matchUndo` (metadata carries the previous result: undo history is in the
  journal).

Club side (both ids): `tournament.entryDeclare`, `tournament.entryConfirm`. Metadata holds ids, division name, round
and method, **never** athlete names or weights. Admin `audit-meta.ts` gets the labels.

## 6. Notifications (quiet hours via `domains/notifications/quiet-hours.ts`)

Three kinds, all **mutable** (category as `org_event.reminder`). Recipients are the entrants only; a child's push goes
to guardians automatically. No pushes to club coaches (they are at the venue and see the list) or to org staff.

| Kind | When | Quiet hours (the entrant's club tz) | Claim |
|---|---|---|---|
| `tournament.bracket_ready` | minute job: entry in a drawn division of a `RUNNING` tournament | wait: first run outside 22:00–09:00 (`isQuietHour`) | `tournament.bracket_ready` / `<entryId>:<drawNo>` |
| `tournament.match_soon` | right after a result: entrants of queue positions 0–1 on that mat | **drop** when quiet (stale news) | `tournament.match_soon` / `<matchId>:<entryId>` |
| `tournament.results_published` | minute job after `resultsPublishedAt` (lookback 2 days, as hub announcements) | wait until 09:00 | `tournament.results_published` / `<entryId>` |

- Text: «Сетки готовы: Мужчины · до 76 кг, ковёр 2». «Скоро ваша схватка: ковёр 2, перед вами 1 схватка». «Итоги
  «Кубок федерации»: 2 место» / «Итоги опубликованы».
- Metadata `{ kind, workspaceId, organizationId, eventId, tournamentId }`.
- Wiring: `dispatchTournamentPushes` in `reminders.service.ts` next to `dispatchOrgEventReminders`;
  `notifyMatchSoon` called by the result handler after commit.
- Mobile `notification-route.ts`: all three → `OrgTournament { workspaceId, eventId }`.
- `notification-mute.spec.ts` pins them as mutable.

## 7. Admin UI (org console)

No new sidebar item (hub's 7 stay). Tournaments live under «Календарь».

- **Entry point:** `OrgEventSheet` for a COMPETITION event shows one row «Турнир · 8 категорий · 52 участника ›» →
  the tournament page. With no tournament, admins see «Провести турнир в ClubSpace» (secondary) → creates it with
  `matCount` 1 and opens it. Calendar rows show muted «идёт» for `RUNNING`.
- **Page** `org/[orgId]/events/[eventId]/tournament/page.tsx`:
  - Header: title + date + one status line («Взвешивание · взвешено 46 из 52»).
  - One primary action per status: SETUP «Начать взвешивание»; WEIGH_IN «Начать турнир» (confirm names
    unweighed/unassigned counts); RUNNING with all finished «Опубликовать итоги» (admin); FINISHED none.
  - «⋯» (≥ 3 items): «Ковров: N…», «Вернуть приём заявок» (WEIGH_IN only), «Снять публикацию» (FINISHED, admin,
    destructive last).
  - In-page tabs (`role=tablist`, `?tab=`): **Категории · Участники · Ковры · Итоги**. «Ковры» and «Итоги» render
    only from `RUNNING` on (truth rule).

| Tab | Who · moment · job | Content |
|---|---|---|
| Категории | head coach · days before · build the division list | Table: name · ковёр · участников · state (muted text: «нет сетки» / «сетка» / «идёт» / «итоги»). Primary «Добавить категории» → `AddDivisionsSheet`: sex (Мужчины / Женщины / Все), age from–to, standard + level from–to, weights as one text field «58 64 70 76 +76» → preview rows → «Создать N категорий». Header «⋯»: «Скопировать из турнира…», «Распределить по коврам». Row tap → division page |
| Участники | weigh-in volunteer · weigh-in hour · find, weigh, move | Search first (autofocus, large), one Select filter (Все / Не взвешены / Не в весе / Без категории / Ждут тренера / Сняты). Rows: name · club · category · «76,0 → 77,4 кг» · status icon. Row tap → `WeighInSheet`: weight input (`inputMode=decimal`, prefilled with declared) → «Записать вес» (primary). Result line «Подходит: до 76 кг» or «Не в весе для «до 76 кг»» + button «Перевести в «до 82 кг»»; «Другая категория» select; «⋯ → Снять с турнира». In SETUP the sheet shows the category select only |
| Ковры | table secretary · during the event · record the match on this mat | Mat switcher (segmented 1…N, `?mat=`). «Сейчас»: one large match card (A and B: name + club) with «Записать результат» (primary). «Далее»: next 5 rows (row tap = record that match out of order). Poll 10 s while visible |
| Итоги | head coach · end of day · check and publish | Per division: 1 · 2 · 3 · 3 rows (name · club); unfinished divisions read «идёт». Secondary «Скачать протокол (CSV)» |

- **Division page** `…/tournament/divisions/[divisionId]/page.tsx`:
  - Header: name + criteria line. Primary «Жеребьёвка» only when undrawn and status ≥ WEIGH_IN. «⋯»: «Изменить
    категорию» (side panel `DivisionSheet`, dirty guard, `expectedUpdatedAt`), «Пережеребить» (drawn, no results),
    «Удалить» (empty).
  - Body: before the draw, the entry list; after it, the **bracket**. Rounds are columns («1/8 · 1/4 · 1/2 ·
    Финал»), match cards are two lines (name, club); the winner is bold with a short method («болевой», «8:2»), a
    bye shows the name + muted «без схватки». Tap a ready or decided match → `MatchResultSheet`. Poll 10 s while
    RUNNING.
- **`MatchResultSheet`** (tablet first):
  - Two full-width winner targets (name + club, ≥ 56 px).
  - Method as one segmented row of 5 (vocabulary labels; GRAPPLING: «Болевой/удушающий · По очкам · Решение судей
    · Дисквалификация · Неявка»).
  - Score inputs A : B only for «По очкам» / «Решение судей»; «Приём» text only for the finish method.
  - Primary «Записать». After saving: toast «Победа: Иванов» with «Отменить» for 10 s (same undo route).
  - A decided match opens read-only with «⋯ → Отменить результат» (confirm names the downstream effect: «Выход
    Иванова в полуфинал тоже отменится»).
  - On 409 `STALE_UPDATE`: `<StaleUpdateNotice>` showing the stored result + «Обновить». On
    `MATCH_UNDO_BLOCKED`: the server message.
- **Registry:** a «призёр» muted mark on rows with `podiumCount > 0`; `RegistryPersonSheet` gets a «Турниры»
  list (place · tournament · division · date).
- **Wrappers / vocabulary:**
  - `shared/api/tournaments.ts` (`ApiTypes.*`), ttl 0 reads;
  - `contract-limits.ts` entries for the division and weigh-in forms;
  - `libs/ui-kit/brand/vocabulary.ts` gains `matchFinish` (GRAPPLING «Болевой/удушающий», others «Досрочная
    победа») and `level` noun reuse for «Пояс»/«Уровень».

Tablet rules: targets ≥ 48 px (56 for winner buttons), no hover-only affordances, sheets full height under 1024 px.
The same features run on desktop.

## 8. Mobile

- **«События»** (`OrgEventsSection`): a COMPETITION row with a tournament gets one state line, the truest of:
  «Укажите вес для заявки» / «Заявка у тренера» / «до 76 кг» / «Ковёр 2 · перед вами 2 схватки» / «2 место»
  (staff: «Ждут подтверждения: 3»). Row tap → **`OrgTournamentScreen`** (root stack, `{ workspaceId, eventId }`).
- **`OrgTournamentScreen` — athlete / parent (act-as):** «вы» or the child's name in the title context. Sections
  render only when true:
  - SETUP without entry: «Заявка: укажите вес» row → `TournamentEntrySheet`: weight (kg, decimal keyboard), sex
    (segmented), birth year only when the profile has none → «Отправить тренеру». An older consent → the
    existing `OrgConsentSheet` first;
  - entry: «Категория: Мужчины · 18–35 · синий · до 76 кг» or «Заявка у тренера»; weights shown only to the
    athlete, guardian and coach;
  - RUNNING: «Следующая схватка — ковёр 2, перед вами 2 схватки, соперник: Пётр Сидоров (Беркут)» or «ждёт
    победителя схватки …»; then the row «Сетка категории ›»;
  - place when the division is finished; FINISHED: row «Итоги турнира ›».
  - Refetch on focus + pull-to-refresh; poll 30 s while focused and RUNNING.
- **Same screen — club coach** (`isStaffWorkspace`):
  - «Ждут подтверждения (N)» rows → `TournamentConfirmSheet`: name, weight, sex, birth year, level from the
    registry or a level picker («Пояс по стандарту федерации») → «Подтвердить». The result line shows the division
    or «Категорию назначит федерация».
  - «Мои спортсмены»: name · category · state («ковёр 2, через 1» / «1 место» / «выбыл» / «нет веса»); row tap →
    their bracket. Students without an entry: row tap → declare for them (auto-confirmed).
- **`TournamentBracketScreen`:**
  - Phone: round tabs («1/8 · 1/4 · 1/2 · Финал») with a vertical match list; tablet: all columns.
  - Own athlete (`isMe`) highlighted with the accent border, own club (`isMyClub`) with a muted dot.
  - Read-only, «Участник скрыт» where §2.3 says so.
- **`TournamentResultsScreen`:** podiums per division, own club marked; nothing else.
- **«Мои пояса»:** under the existing federation line, one line per podium «2 место — Кубок федерации, 1-й этап · 12
  окт» (from `listMyClubOrganizations.podiums`).
- **Plumbing:** `shared/api/tournaments.ts`; `navigation.ts` + `App.tsx` routes `OrgTournament`,
  `TournamentBracket`, `TournamentResults`; `notification-route.ts` (§6).

No Home card: the Events row, the push and the screen cover the moment. Home stays as audited
(`clubspace-cases.md` «Home»).

## 9. UI gate (ui-slop-detector, proposal stage)

| Element | Role · moment · frequency | Verdict |
|---|---|---|
| Tournament page: 1 primary per status, ≤ 3-item «⋯» | head coach · each phase · few/day | keep |
| «Добавить категории» generator | head coach · setup · once per tournament, 30–60 divisions | keep (cuts 60 forms to ~6) |
| Weigh-in search-first list + sheet with one primary | volunteer · weigh-in · hundreds of taps | keep |
| «Ковры» current match + queue | secretary · all day · every 5 min | keep (core task, not behind «⋯») |
| Per-row buttons in lists (weigh / move / record) | — | **cut**: row tap opens the sheet |
| Status chips row on «Участники» | — | **cut**: one Select filter |
| Live timer / scoreboard in result sheet | — | **cut** (§15) |
| Score inputs always visible | — | **cut**: only for points/decision methods |
| Toast-undo + `⋯ → Отменить` | secretary · mistake · rare | keep both (fast path + later path); no confirm on save |
| Home card «ваша схватка» on phone | — | **cut**: Events row + push |
| Push to coaches on every result | — | **cut** (needy); coach list is ambient |
| Seeding controls / manual seeds | — | **cut**: auto with «Пережеребить» |
| Badges «новое» on brackets | — | **cut** |
| Weights/birth year on member bracket | — | **never render** (§2.3) |

Done gate: S2 and S3 screenshot each new screen (admin at 1180×820 tablet + desktop; phone 1080×2400) and count
filled buttons per viewport (≤ 1, paired Cancel/Save excepted) and row actions (row tap + ≤ 1 icon).

## 10. Demo data (S3; deterministic given `now`)

`domains/demo/demo-tournaments.ts` builds the rows, using `seedBracket` / `placingsFor` from S1's pure
`bracket.ts`. `seedDemoOrganization` calls it after events and registrations. Ids are `demoUuid('org:tomsk:…')`, and
randomness is the existing `draw(key, id)` hash. Everything is replaced on each reset (hub §10 «Federation seed runs
after every demo reset»).

- **Seeded consents** use the new edition (the constant), so every entrant is visible. `parent@`'s undecided state and
  Аня's refusal stay; Аня isn't entered.
- **New account `secretary@academy.demo`** — Ирина Ковалёва, «Секретарь турнира (демо)», `ORG_COACH`. It is
  `DEMO_FEDERATION_SECRETARY_ACCOUNT` next to `DEMO_FEDERATION_ACCOUNT` in `demo-clubs.ts` (fixed-code sign-in,
  console card), and `isDemoOnlyAccount` covers it.
- **«Кубок федерации, 1-й этап»** (`autumn`) — FINISHED 40 days ago:
  - host Беркут, 2 mats, ~10 divisions (adult men by belt × 3 weights, women open weight, kids 8–9 / 10–11 by
    weight), ~48 entries from both clubs;
  - all matches decided; results published at 19:00 that day;
  - `student@academy.demo` (Максим Иванов) took 3rd → «Мои пояса» and the registry «призёр»; Миша (`parent@`'s
    child, consented) took 2nd in kids;
  - weights already cleared by the 30-day retention (the seed writes them null — shows the rule).
- **«Кубок федерации, 2-й этап»** (`cup`) — RUNNING now:
  - `startAt` = floor-to-10-min(now − 2 h), `endAt` + 8 h; host ACADEMY, 3 mats;
  - divisions copied from 1-й этап (the seed writes them the same way `copyTournamentDivisions` does), ~36
    entries;
  - progress: divisions 1–3 finished (places), 4–6 mid-way, 7–8 drawn but not started;
  - `decidedAt` = start + 7 min × index (≤ now);
  - `student@` is in a mid-way division with his next match ready on Ковёр 2 behind one match; one entry was
    moved at weigh-in (`tournament.entryMove` audit row), one withdrawn «Не взвешен»; methods and scores from
    `draw()`.
- **«Открытый турнир Томской области»** (existing `tournament`, in 24 days) — SETUP:
  - divisions configured;
  - of its 23 registrations, ~12 confirmed with a division, 3 declared and waiting for `coach@academy.demo`
    («Ждут подтверждения: 3»), the rest without weight.
- **`docs/demo.md`:** account row for `secretary@`, the «Турниры» section, and a 5-minute script:
  1. Mac `federation@` → «Календарь» → «Кубок федерации, 2-й этап» → «Турнир» → «Ковры» → Ковёр 2 → «Записать
     результат» → the bracket advances.
  2. Phone `student@` → «События» → «Кубок…» → «Следующая схватка».
  3. «Итоги» of 1-й этап → «Реестр поясов» → «Иванов» → «призёр».
  4. Phone `coach@academy.demo` → «Открытый турнир…» → confirm one entry.

## 11. Tests

**Server unit (S1):**
- `bracket.spec.ts`:
  - sizes and byes for n = 1…64; byes only in round 1, never paired;
  - the club invariant (§4.2.4) over a seeded PRNG sweep (n ≤ 32, 1–6 clubs) plus a brute-force optimum check for
    n ≤ 8;
  - two teammates in 8 meet only in the final; four teammates go one per quarter;
  - input-order independence; same salt → same bracket; `drawNo + 1` → a different bracket for some input;
  - `nextSlot`; `placingsFor` for n = 1, 2, 3, 4, 5, 8 and for walkover/DQ losers.
- `divisions.spec.ts`: age by birth year across New Year; weight bounds (min exclusive, max inclusive, open); level
  range by template; mixed sex; none / one / several fits; `suggestDivision`; names.
- `schedule.spec.ts`: queue order, byes skipped, unassigned mat, `ahead`, `waitingFor`, eliminated/placed;
  `autoAssignMats` balance.
- `tournament-store.spec.ts`: draw refused with results; result + advancement + places on final; idempotent
  identical retry; stale 409; undo blocked downstream and after publish; move clears both brackets in RUNNING only
  without results.
- Handler specs (each refusal, the not-found path, every happy branch; the owner bypass on club routes):
  - `createOrgTournament` (org coach 403, non-COMPETITION 400, second → same);
  - `setOrgTournamentStatus` (order, unassigned 409, unweighed → withdrawn);
  - `publishOrgTournamentResults` (org coach 403, unfinished 400);
  - `recordTournamentWeighIn` (DECLARED → CONFIRMED by weigher, `fits`/suggestion);
  - `declareTournamentEntry` (no booking 404, other club's booking 404, WEIGH_IN 409, old edition 409, coach of
    another group 403, coach → CONFIRMED);
  - `confirmTournamentEntry` (athlete 403, level required without registry belt);
  - `getClubTournamentBracket` (no weights/birth year/user ids in the payload; hidden names);
  - `listClubTournamentAthletes` (coach scope vs admin scope);
  - `cancelOrgEventRegistration` (locked after SETUP); `deleteOrgEvent` (started 409).
- `consent.spec.ts` (`minVersion`; re-grant over an older edition; no-op on current).
- `registry.spec.ts` (podiums: published only, consent live, unpublish hides).
- `tournament-dispatch.spec.ts` (quiet club waits / match_soon dropped / once-only claims / retention clears weights
  after 30 d only).
- `notification-mute.spec.ts`; `data-source.spec.ts`; `route-tier-consistency.spec.ts` (new controllers pass).
- Demo (S3): `demo-tournaments.spec.ts`:
  - deterministic for a fixed `now`;
  - counts, statuses, every decided `decidedAt ≤ now`;
  - brackets equal `seedBracket` output; places equal `placingsFor`;
  - `student@`'s next match is ready on mat 2 with ahead = 1; ids match the literals pinned in admin
    `role-matrix.ts`.
- `demo-organization.spec.ts` (idempotent with tournaments, `isDemoOnlyAccount(secretary)`).

**Server e2e (S1)** `apps/server-e2e/src/organizations/` (fixtures in `org-fixtures.ts`), run with
`bash /tmp/run-e2e-wait.sh`:
- `tournament-entries.e2e-spec.ts`:
  - `athlete declares weight, own coach confirms and the entry lands in the matching division`;
  - `a coach of another group cannot confirm and org staff cannot call the club routes`;
  - `an older consent edition gets ORG_CONSENT_REQUIRED and passes after re-granting`;
  - `after weigh-in starts the club can neither change nor cancel an entry`.
- `tournament-run.e2e-spec.ts`:
  - `weigh-in moves an off-weight athlete and start draws five entrants with three byes and teammates apart`;
  - `results advance winners and the final yields places 1, 2, 3, 3`;
  - `two tablets record one match: the second gets STALE_UPDATE, an identical retry succeeds`;
  - `undo is blocked while the next match is decided and works after undoing that one first`.
- `tournament-results.e2e-spec.ts`:
  - `publishing is admin-only and needs every division finished`;
  - `published podiums reach the registry and My ranks; withdrawn consent hides the name in brackets and the
    registry`;
  - `a member of another federation club sees the bracket without weights or birth years`.

**Admin (S2):**
- Unit: `tournament-view.spec.ts` (status line, primary per status, kg format «77,4», division row state,
  CSV rows) and `bracket-layout.spec.ts` (round labels, column positions, byes).
- Component specs: `MatchResultSheet.spec.tsx` (score fields only for points/decision; stale notice) and
  `WeighInSheet.spec.tsx` (suggestion button), with `<ConfirmDialogHost />` where confirms are used.
- **Admin smoke role matrix additions** (`apps/admin-e2e/src/role-matrix.ts`):

| Account | Routes (relative to `/org/<id>/`) | Expectation |
|---|---|---|
| `federation@academy.demo` | existing 7 + `events/<cupEventId>/tournament`, `…?tab=entries`, `…?tab=mats&mat=2`, `…?tab=results`, `events/<cupEventId>/tournament/divisions/<cupDivisionId>`, `events/<autumnEventId>/tournament?tab=results` | populated, no `NaN`/`undefined`; mats tab shows a current match; finished results show «Опубликовано» |
| `secretary@academy.demo` (new, ORG_COACH) | `''`, `registry`, `events`, `announcements`, `ladders` + the same tournament routes | populated; no «Опубликовать итоги» / «Снять публикацию»; `team`, `settings` show «Раздел доступен администраторам федерации» |
| `owner@academy.demo` | `events/<cupEventId>/tournament` | the `OrgGate` notice (403) |

Event and division ids are pinned literals (`demoUuid` is deterministic); S3's demo spec asserts they match.

**Mobile (S3):** `tournament-helpers.spec.ts`:
- the row state line for each entry state and staff;
- the next-match line (ahead 0/1/n, waiting, placed, eliminated);
- round labels; kg formatting;
- hidden participant label; sections shown per status.

Also `notification-route.spec.ts` (three kinds).

## 12. Acceptance checklist

- [ ] `federation@` opens «Календарь → Кубок федерации, 2-й этап → Турнир»: status «Идёт», 3 mats. «Ковры → Ковёр
      2» shows the current match. Recording it moves the winner into the next round on the division page and
      updates `student@`'s «перед вами» on the phone after refresh.
- [ ] A wrong result is undone from the toast and, later, from «⋯ → Отменить результат». Undo of a match whose next
      match is decided is refused with the server message.
- [ ] Two browser tabs record the same match: one succeeds, the other shows «Результат уже записан…» with the stored
      result (e2e covers the API).
- [ ] «Добавить категории» with «Мужчины · 18–35 · синий–коричневый · 64 70 76 82 +82» previews and creates 5
      named divisions; «Скопировать из турнира» copies 1-й этап's set.
- [ ] Weigh-in: search by surname → weight 77,4 for «до 76 кг» → «Перевести в «до 82 кг»» moves the athlete.
      «Начать турнир» withdraws the unweighed after the confirm and draws all divisions. No first-round pair has
      two byes, and teammates are apart.
- [ ] Places 1/2/3/3 on «Итоги»; «Опубликовать итоги» is absent for `secretary@`. After publishing, «Реестр поясов
      → Иванов» shows «призёр» with the tournament, and `student@`'s «Мои пояса» shows «3 место — Кубок федерации,
      1-й этап».
- [ ] `coach@academy.demo` on the phone sees «Ждут подтверждения: 3» on «Открытый турнир…» and confirms one; the
      division appears.
- [ ] `student@` (or `parent@` acting for Миша) sees the division, the bracket with themselves highlighted, and the
      next match. No weights or birth years of others appear anywhere on the phone.
- [ ] A person with an old consent edition is asked to re-confirm before declaring; withdrawing consent turns their
      name into «Участник скрыт» in brackets and removes the registry podium.
- [ ] Pushes: `results_published` is held through 22:00–09:00 club-local; `match_soon` is never sent at night
      (unit).
- [ ] Hub sidebar unchanged (7 items); club apps without federations see nothing new.
- [ ] tsc server / admin / mobile; unit tests; server e2e `organizations/*`; contract drift; admin e2e; `cs-reviewer`.

## 13. Decisions

1. **One `Tournament` per COMPETITION `OrganizationEvent`**, an extension rather than a new calendar object: the hub's
   registration, capacity and consent stay the entry funnel.
2. **Divisions are per-tournament config rows** (sex, age band, level range on an org standard, weight range), with a
   generator and copy instead of global presets. Only `CompetitorSex` is an enum: it is a fact about the person,
   not sport config.
3. **Age by birth year**, the common Russian federation rule; exact-date age is §15.
4. **Sex, birth year and weight live on the entry, not on `User`.** That is minimum data, scoped to the
   tournament, and retention clears weights after 30 days.
5. **Entry = registration + declaration + coach confirmation.** A coach's own declaration counts as confirmed; the
   weigher may confirm a DECLARED entry at the scale (the federation's call on the day).
6. **Reuse the federation consent, new edition**, rather than a new consent kind. One switch for the person, one
   409 the app already handles. Old editions keep covering what they said.
7. **Hidden, not deleted:** withdrawal or a departed club turns a name into «Участник скрыт» everywhere, and the
   brackets stay intact.
8. **Single elimination, 1/2/3/3, no bronze match; WO/DQ losers unplaced; a lone athlete gets 1st «без соперника».**
9. **Seeding is automatic and deterministic** (salted hash, club separation, byes evenly in round 1); «Пережеребить»
   bumps the salt. No manual seeds in the MVP.
10. **Mat queue = whole division before the next on that mat**; positions, not clock times.
11. **Concurrency:** a row lock per division plus `expectedUpdatedAt` per match (the existing `STALE_UPDATE`
    convention) plus idempotent identical retries (tablet Wi-Fi blips).
12. **Undo only at the frontier** (next match undecided) and never after publication; admins unpublish to correct.
    History lives in the journal.
13. **Org coach runs the day, org admin publishes.** No per-event judge role yet.
14. **Polling, not sockets:** 10 s on console bracket/mats views, 30 s on the phone screen, while visible and RUNNING.
    Org rooms don't exist (hub §3.4).
15. **Podiums are computed from `TournamentEntry.place` of published tournaments**, never written into club tables
    (`Achievement` stays club-owned). The registry shows them only for people it already lists.
16. **Three mutable pushes to entrants only**, quiet hours respected (wait or drop). No coach or staff pushes.
17. **Club coaches act on the phone only.** The club admin web gets nothing new in the MVP.
18. **Demo** gains a running and a finished tournament plus `secretary@academy.demo`; the running one is anchored to
    `now − 2 h` so its timeline is always coherent.

**Server, S1 (implementation):**
- **Start withdraws DECLARED as well as CONFIRMED entries without a weight** (implementation): the weigher confirms at
  the scale, so a still-DECLARED entry was never weighed; both become WITHDRAWN «Не взвешен».
- **Changing who is in a drawn division drops its bracket while it has no results** (implementation): a move, a
  withdrawal or a first weigh-in into a drawn division clears its matches (`drawnAt` null, a new draw follows — the
  start redraws undrawn divisions); with results it is 409 `DIVISION_HAS_RESULTS`. Withdrawal is therefore allowed
  until the first result, not only before the draw.
- **Weigh-in only in WEIGH_IN** (implementation; 400 otherwise). An entry without a division gets the one that fits at
  the scale; `fits` on the answer is the weight check only (the level was settled at confirmation).
- **A decided match with a different result is 409 `STALE_UPDATE` even without `expectedUpdatedAt`** (implementation):
  changing a result goes through undo. Identical retries (winner, method, scores) answer 200.
- **Undo of a bye is refused** (400): byes change only with a redraw.
- **Coach level picker**: confirmation needs a level only when some division is defined on a standard; without one
  and without a registry level it is 400 `TOURNAMENT_LEVEL_REQUIRED`. Club athletes rows carry `registryLevel`.
  The registry level comes from the newest registry belt whose club level maps to a standard level.
- **Kids' names**: generated division names say «Мальчики / Девочки» when the age band ends under 18.
- **Registry podiums need the tournament edition of the consent** (results show names); a person on an older edition
  stays in the registry without the «призёр» mark. Own podiums in «Мои пояса» show regardless of consent.
- **Fewer mats unassign the dropped mats' divisions** («Ковёр не назначен»), results stay.
- **A self-declaration keeps an existing confirmation when weight, sex and birth year are unchanged**; any change resets
  it to DECLARED with the division cleared.
- **A conflicting match result says what happened** (implementation): the 409 `STALE_UPDATE` for a match already
  decided with another result carries «Результат уже записан с другого планшета» and the stored result in `metadata`
  (`winnerEntryId`, `method`, `scoreA`, `scoreB`, `decidedAt`). A stale `expectedUpdatedAt` on an undecided match keeps
  the generic stale message (nothing was recorded).
- **A coach confirms only while the event still reaches the club** (implementation): a club that left the federation
  gets 404 on «Подтвердить», as on every other club tournament route.
- **Every result takes the tournament row lock as well as the division's** (implementation), so a result can't
  interleave with «Опубликовать итоги» or the start; results on different mats queue for milliseconds.
- **«Мои спортсмены» lists booked people in the coach's write scope** (implementation): `listClubTournamentAthletes`
  returns the people booked on the event through the club whom the coach may confirm (own groups even where coaches
  see every group; admin scope: all). An entry needs the booking, the phone polls the list while the tournament runs,
  and the list and «Ждут подтверждения» now agree with «Подтвердить».
- **Publishing counts drawable entrants only** (implementation): an unweighed entry returned to the tournament after
  the start can never be drawn, so it doesn't make its undrawn division «не закончена».
- **«Вернуть приём заявок» drops every bracket drawn during the weigh-in** (implementation, review): club-side
  cancel, re-declaration and confirmation don't touch brackets, so a bracket kept over SETUP would hold ghosts. A
  re-declaration that resets the confirmation also clears the weigh-in (weigh again).
- **The club can't revive a withdrawn entry** (implementation, review): a declaration over a WITHDRAWN entry is
  400 «Заявка снята», as confirmation already was.
- **Hidden means hidden in the console too** (implementation, review): for a hidden person the console's entry rows
  carry no sex, birth year, weights, fit or withdrawal reason (§2.3 table), matching the consent text «после отзыва
  федерация перестаёт видеть эти данные». They sort by id, not surname. A hidden person in a club bracket carries no
  «ваш клуб» mark.
- **«перед вами N» counts matches not ready yet** (implementation, review): `matchesAhead` counts every undecided match
  of the divisions queued earlier on the mat and the earlier rounds/positions of one's own division, so the number
  only goes down; `match_soon` uses the same count.
- **«По очкам» needs both scores, the winner's higher** (implementation, review; 400 otherwise). A decision may be
  level.
- **Discipline words in server copy** (implementation, review): pushes and errors say «схватка» / «пояс» for
  GRAPPLING federations and «выступление» / «уровень» otherwise (`tournament-words.ts`); store errors use the neutral
  «пара». The mat stays «ковёр».
- **Minute job bounded** (implementation, review): «Сетки готовы» goes to entrants in a bracket (weighed) of divisions
  drawn within 2 days, and the job reads existing claims before claiming, so a long tournament isn't re-claimed every
  minute. The withdrawal journal row stores `reasonGiven`, never the free text. Cancelling a booking releases its entry
  in the same transaction.

**Admin console, S2 (implementation):**
- **No «⋯» on the tournament header** (implementation). By status it would hold one or two items (the
  `ui-slop-detector` guard: a 1–2 item «⋯» is worse than showing them). The step back is a quiet outline button beside
  the primary: «Вернуть приём заявок» (WEIGH_IN), «Снять публикацию» (FINISHED, admin). «Ковров: N» is the admin's
  dotted «3 ковра» in the date line, opening a small dialog (`expectedUpdatedAt`). The division page keeps its «⋯»
  (up to three items: «Изменить категорию», «Пережеребить», «Удалить»).
- **«Категории» header actions are buttons, not a 2-item «⋯»** (implementation): «Скопировать из турнира» (outline,
  only when the federation has another tournament) and «Распределить по коврам» (ghost). «Добавить категории» is filled
  only while the list is empty; once divisions exist the page's phase button is the one filled button. Likewise
  «Начать взвешивание» stays outline while there are no divisions.
- **`MatchResultSheet` and `WeighInSheet` put the rare action as a quiet button** (implementation): «Отменить
  результат» (outline, destructive text) on a decided match and «Снять с турнира» / «Вернуть в турнир» (ghost) at the
  bottom of the weigh-in sheet, instead of a one-item «⋯». After a weigh-in that misses the division, «Перевести в
  «до 82 кг»» becomes the filled button and «Записать вес» turns outline.
- **The result toast reuses the calendar's `UndoToast`** (implementation; 15 s, not 10 s), so the admin keeps one toast.
  A refused toast undo (the next match is already decided) replaces it with the server's message.
- **STALE_UPDATE on a result** re-reads the division and shows «Записано: Победа: … · …» under `<StaleUpdateNotice>`;
  «Обновить» opens that match read-only (implementation).
- **Undo confirm wording** (implementation): «Выход в полуфинал тоже отменится (Иванов).» — names are not declined
  (a genitive «Иванова» can't be built reliably); after a final: «Места в категории тоже снимутся.»
- **`matchFinishLabel(type)` is a standalone export of `libs/ui-kit/brand/vocabulary.ts`, not a `ClubVocabulary` field**
  (implementation): GRAPPLING and FITNESS share one vocabulary object and the server mirror spec pins the object, so a
  grappling-only word lives beside it. «Пояс»/«Уровень» comes from the org type the same way (`levelWord`).
- **The org journal words a match method neutrally** («досрочная победа»; it has no discipline) and labels `method`
  «Способ победы» by value, since payments use the same key (implementation).
- **Admin smoke** (implementation): `ORG_MATRIX` rows gain `blocked` and `pages` (routes outside the sidebar with
  `expect` / `absent` words); the club-owner check is its own test and also opens a tournament page by URL.
- **Demo secretary account lives in `demo-accounts.ts`** (implementation), next to `DEMO_FEDERATION_ACCOUNT` (that is
  where the administrator actually is, not `demo-clubs.ts`), and is listed with ACADEMY's accounts in `demo-clubs.ts`.
  The seed refuses (`blocked`) when the address belongs to a real account, as for the administrator.
- **Demo divisions: 9 per tournament** (implementation): adult men «Белый» and «Синий – Чёрный» × 3 weights, women
  in open weight, children 7–9 and 10–13 in open weight, mixed sex. The demo clubs have few children with a guardian's
  consent, so weight classes for children would leave most of them alone. The cup and the open tournament copy the
  1st stage's set (`tournament.divisionsCopy`). The cup's mats are longest-first with student@'s division pinned
  second on mat 2; the 1st stage's are longest-first on 2 mats.
- **Demo facts the database doesn't hold** (implementation): sex is read from the Russian surname/first name
  (`sexFromName`; there is no sex on `User`), birth year from `dateOfBirth`, the level from the latest promotion on a
  ladder linked to a federation standard. Weights are a stable per-person draw ± a little per tournament.
- **The running cup is simulated, not hand-written** (implementation): every mat decides its `matQueue` head 7 min
  apart from the start. Mats 1 and 3 stop mid-way through their second division. Mat 2 stops at the first moment
  student@'s match is ready with exactly one match ahead after his division began. The script's outcomes are forced:
  student@ loses the 1st stage's semifinal on points (3rd), Миша its final (2nd), both win every decided cup match.
  Walkover/DQ happen only before the semifinal and never to them. Pinned by `demo-tournaments.spec.ts` (14 days ×
  5 hours) and by the sweep spec over the generated clubs (14 days × 3 hours).
- **A reset never pushes** (implementation): the seed pre-claims `tournament.bracket_ready` `<entryId>:1` for every
  drawn cup entry and `tournament.results_published` for the 1st stage's entries in `notificationDispatchLog`
  (`skipDuplicates`). Seeded journal rows use the live metadata shapes (`statusChange` with
  `withdrawnCount`/`drawnCount`, `entryMove` with both division names, `matchResult` with round and position).
- **Demo open tournament** (implementation): the 3 waiting entries are ACADEMY adults (self-booked first), declared by
  themselves; coach@ (head coach, whole-club scope) sees «Ждут подтверждения: 3». The confirmations seeded for the
  other 12 are by the club's hub coach (bjj@ / Беркут's coach). Club-side `entryDeclare`/`entryConfirm` journal rows
  are not seeded (they'd flood the clubs' journals).
- **Mobile Events card** (implementation): a competition with a tournament makes the whole card the tap target with
  one accent state line + chevron; the registration buttons inside keep working. The line shows the full division
  name, since «до 82 кг» alone is ambiguous between belts.
- **Mobile confirm sheet reads `registryLevel`** (implementation; S1 added it to the athletes row): «Пояс: Синий (из
  реестра федерации)» or the level picker up front. That's better than discovering 400 `TOURNAMENT_LEVEL_REQUIRED`
  after the tap.
- **Mobile consent re-confirmation** (implementation): the entry sheet's 409 `ORG_CONSENT_REQUIRED` (or
  `consentCurrent: false` up front) closes the sheet and opens `OrgConsentSheet` with the current text from
  `my-orgs:<ws>`. «Разрешить и продолжить» re-grants and reopens the entry sheet, so a sheet never opens a sheet. A coach
  declaring for a student gets «Ученик должен обновить согласие в приложении».
- **Mobile web paths** `clubs/:workspaceId/tournaments/:eventId` (+ `/divisions/:divisionId`, `/results`)
  (implementation; `linking.ts` is required by the typed route table). Tournament pushes without `eventId` fall back
  to «События».
- **The event and division titles appear once** (implementation): the tournament screen's header carries the event
  title and the body opens with «Миша · Идёт · 3 ковра», naming the child when a guardian is acting for one. The
  bracket's header says «Сетка» and the division name wraps in the body, because a long name such as «Мужчины · от
  18 лет · Синий – Чёрный · до 76 кг» would be cut off in the header. The routes take no `title` param.
- **An empty bracket slot names its feeder match** (implementation): «победитель схватки Ильин — Афанасьев», using
  `bracket.ts`'s advancement ((r, p) → (r + 1, ⌈p/2⌉), odd positions on side A). It shows «—» only while the feeder
  match is itself still waiting for someone.
- **Gender-neutral entry states** (implementation): «Заявка снята: Не взвешен» instead of «Снят с турнира», and
  «выбыл» / «выбыла» follow the entry's `sex`.
- **A «Мои пояса» podium line opens that tournament's results** (implementation): once a tournament is over it drops
  out of «События». Without this the published results could be reached only through the `results_published` push.
  The line is a row with a chevron and no extra button.

## 14. Implementation slices

Contract first. S1 lands phase A on `feat/tournaments` early; S2 and S3 then build against the generated types while
S1 implements the handlers. Nobody runs the full gate mid-flight; the integrator runs it once.

**Hand-off order:**
1. **S1-A** (first): schema + `prisma validate/generate`; `domains/tournaments/{divisions,bracket,schedule}.ts` +
   specs (pure); every `*.feature.ts` zod input/output and the controllers (route shapes final); `app.module.ts`
   registration; regenerated `open-api.json` + `libs/api-client/src/openapi/*` + api-client dist. **S1 commits
   this and tells S2/S3 (message to each).**
2. **S2, S3 start** against the contract. S3's demo uses the schema plus `bracket.ts` only, so it is independent of
   handlers.
3. **S1-B:** store, readers, handlers + specs, hub-route changes, dispatch, consent edition.
4. **S1-C:** server e2e. S2/S3 run against a local server built from S1-B for screenshots and the admin smoke.
5. **Integrator:** the gate (below), the `cs-reviewer` pass, one squash PR.

| Slice | Owns (only these files) |
|---|---|
| **S1 server** | `apps/server/prisma/schema.prisma`; `apps/server/src/domains/tournaments/**` (new: `divisions.ts`, `bracket.ts`, `schedule.ts`, `tournament-store.ts`, `tournament-read.ts`, `tournament-dispatch.ts`, `tournament-errors.ts` + specs); `domains/organizations/{consent.ts, consent.spec.ts, registry.ts, registry.spec.ts, data-source.spec.ts}`; `features/organizations/tournaments/**` (new); `features/organizations/events/{schemas.ts, get-org-event.handler.ts, list-org-events.handler.ts, update-org-event.handler.ts, delete-org-event.handler.ts, org-events.handlers.spec.ts}`; `features/organizations/registry/{schemas.ts, get-organization-registry-person.handler.ts, search-organization-registry.handler.ts, org-registry.handlers.spec.ts}`; `features/club-organizations/tournaments/**` (new); `features/club-organizations/events/{schemas.ts, list-club-org-events.handler.ts, cancel-org-event-registration.handler.ts, club-org-events.handlers.spec.ts}`; `features/club-organizations/consent/{schemas.ts, list-my-club-organizations.handler.ts, set-my-organization-consent.handler.ts, my-club-organizations.handlers.spec.ts}`; `domains/notifications/{notification-mute.ts, notification-mute.spec.ts}`; `domains/scheduler/{reminders.service.ts, reminders.service.spec.ts}`; `app/app.module.ts`; `shared/access/route-tier-consistency.spec.ts` (only if a pin list needs the new routes); `apps/server/jest.config.cts` (coverage floor); `apps/server-e2e/src/organizations/{org-fixtures.ts, tournament-entries.e2e-spec.ts, tournament-run.e2e-spec.ts, tournament-results.e2e-spec.ts}`; `open-api.json`; `libs/api-client/src/openapi/**` |
| **S2 admin** | `apps/admin/src/app/(dashboard)/org/[orgId]/events/[eventId]/tournament/page.tsx` + `…/tournament/divisions/[divisionId]/page.tsx` (new); `apps/admin/src/features/org/tournament/**` (new: `TournamentHeader`, `DivisionsTab`, `EntriesTab`, `MatsTab`, `ResultsTab`, `AddDivisionsSheet`, `DivisionSheet`, `WeighInSheet`, `MatchResultSheet`, `Bracket`, `tournament-view.ts`, `bracket-layout.ts` + specs); `features/org/{OrgEventSheet.tsx, RegistryPersonSheet.tsx, org-view.ts, org-view.spec.ts}`; `app/(dashboard)/org/[orgId]/{events,registry}/page.tsx`; `shared/api/tournaments.ts` (new), `shared/api/organizations.ts` (event/registry type additions); `shared/lib/contract-limits.ts` (+spec); `features/audit/audit-meta.ts`; `libs/ui-kit/brand/vocabulary.ts` (`matchFinish`; land first, S3 consumes); `apps/admin-e2e/src/{role-matrix.ts, checks.ts}` |
| **S3 mobile + demo + docs** | `apps/mobile/src/features/org-events/**` (`OrgEventsSection.tsx`, new `OrgTournamentScreen.tsx`, `TournamentEntrySheet.tsx`, `TournamentConfirmSheet.tsx`, `TournamentBracketScreen.tsx`, `TournamentResultsScreen.tsx`, `tournament-helpers.ts` + spec); `features/ranks/MyRanksScreen.tsx`; `features/notifications/notification-route.ts` (+spec); `shared/api/tournaments.ts` (new), `shared/api/organizations.ts` (type additions); `src/app/{navigation.ts, App.tsx}`; `apps/server/src/domains/demo/{demo-tournaments.ts (new) + spec, demo-organization.ts, demo-organization.spec.ts, demo-clubs.ts, demo-access.ts, demo-access.spec.ts}`; `docs/demo.md`; `docs/legal/README.md` (questions §16); `docs/design/2026-11-26-federation-hub-mvp.md` (§12 item 1 → «спроектировано: 2026-11-27-tournaments.md»); `CHANGELOG.md` |

**Interface** (frozen at S1-A):
- §3 models;
- §5.1/§5.2 routes and method names, plus the hub-route field additions;
- error codes §5.3;
- notification kinds and metadata §6;
- consent constants `ORG_SHARING_CONSENT_VERSION = '2026-11-27.1'` and `TOURNAMENT_CONSENT_MIN_VERSION`;
- `bracket.ts` exports `bracketSize`, `seedBracket`, `firstRoundMatches`, `nextSlot`, `placingsFor`.

**Integrator checks:**
- `tsc` server / admin / mobile (`tsconfig.app.json`);
- `npx nx test @clubspace/server -- tournaments` (+ `organizations`, `club-organizations`, `registry`, `consent`,
  `reminders`, `notification-mute`, `route-tier-consistency`, `data-source`, `demo`);
- server e2e `organizations/*` via `/tmp/run-e2e-wait.sh`;
- contract drift; admin e2e with the new matrix; mobile helper specs; `cs-reviewer`.

## 15. Out of the MVP

- Judge scoring PWA: live mat clock, scoreboard, offline queue, per-event judge / table role, referee assignment.
- Round-robin (small divisions), double elimination, repechage, bronze match, absolute-category auto-entry, ranking
  seeds, manual seed edits.
- Team scoring / club standings, medal tables.
- Entry fees and payments (hub §12 item 2), medical clearances (hub §12 item 3), sports-committee protocols and
  rank submissions (hub §12 item 4); the CSV protocol is the bridge.
- Day-of entries without an app registration; entries of people outside member clubs.
- Public web results page, shareable links, printable PDF brackets, clock-time schedule estimates, multi-day
  scheduling.
- Age on the exact event date; per-federation rule presets.
- Results on the club admin member card, club MCP tools, automatic federation announcement of results.
- Realtime sockets / org rooms.

## 16. Open risks and lawyer questions

- **Legal basis (our reading).** Weight, sex and birth year go to a third-party operator (the federation), and
  minors' names are shown to members of other clubs. Questions for `docs/legal/README.md`:
  - is the extended in-app consent enough, or is a written guardian consent needed for children's results?
  - is body weight health data (152-ФЗ ст. 10)? We assume not and still minimise it with the 30-day retention;
  - do club members other than participants need to see names, or would «Участник · клуб» be required?

  Until answered, the feature stays behind `ORGANIZATIONS_ENABLED` (demo and pilots).
- **Seeding is greedy.** In capacity-tight cases (many teammates, many byes) it is near-optimal, not optimal. The
  invariant test bounds it; «Пережеребить» is the escape hatch.
- **Venue Wi-Fi.** There is no offline queue. Idempotent retries absorb blips; a phone hotspot or a paper sheet
  re-entered later covers outages [INFERENCE: acceptable for a city federation's first events].
- **Polling load:** a handful of tablets at 10 s plus phones at 30 s while focused. That is negligible next to the
  hub's metrics reads.
- **Consent friction:** entrants with the 2026-11-26 edition must re-confirm once. The demo seeds the new edition;
  a real federation sees one extra sheet per athlete.
- **Wrong-division risk at confirmation:** auto-match needs a level. A club that hasn't adopted the standard makes
  the coach pick it, and the federation can still move the athlete at weigh-in.
