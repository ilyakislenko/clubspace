# ClubSpace product and concept audit (2026-11-01)

> Snapshot of `main` at #387, before the fixes merged in #388–#400+. Read-only review; `[INFERENCE]` marks a conclusion drawn rather than observed. What changed since: `docs/strategy/concept.md`.

The biggest finding at the time: in the production setup, the join links and QR codes that every invite e-mail sends people to led to a 404 page (fixed in #391).

## 1. People and clubs (data model)

**Current state**
- **`User`** (`apps/server/prisma/schema.prisma:183-263`): a single global identity, unique by `email`. `phone` exists but is never used for sign-in. `googleId` and `appleId` exist but nothing sets them. `language` can be `EN/RU/KZ/ZH` (`:18-23`). `dateOfBirth` is stored.
- **`Workspace`** (`:85-181`) is a club. It has a `key`, a `type` (GRAPPLING/FITNESS/YOGA/CUSTOM), `ownerId`, 12 on/off switches for app sections, `timezone`, `joinAutoApprove`, and contact/link/rules fields for an "About the club" page.
  - It has no logo, colours, city, address, description, public flag or slug.
- **`WorkspaceMember`** (`:568-614`) links a user to a club with a role, a status (`ACTIVE | SUSPENDED | INVITED | BLOCKED`, `:42-47`), `accessUntil`, a pointer to the current subscription, and staff notes. `@@unique([userId, workspaceId])`.
  - **One account can be in many clubs, with a different role in each.**
- **Roles** are global rows, not per club: `user`, `coach`, `head_coach`, `admin`, plus the platform-wide `Global Admin` (`apps/server/src/shared/interfaces/shared.intefaces.ts:4-10`, seeded in `apps/server/src/app/bootstrap-seed.service.ts:107-160`).
  - The owner is identified by `Workspace.ownerId`. Creating a club also gives the owner an `admin` membership row (`apps/server/src/features/platform/create-platform-workspace.handler.ts:115-128`).
  - That contradicts the comment in `domains/workspace/services/join-request.service.ts` that says "the owner has no WorkspaceMember row".
- **Locations and groups:** `Gym` (`:350-379`) has an address, optional timezone, and lat/lng. `Group` (`:382-420`) has one gym, a primary coach and assistants via `GroupCoach` (`:423-440`). There are weekly slots and exceptions (`:443-495`). Students attach through `GroupMember` (`:541-555`).
- **`MemberStatus.INVITED` means two different things.** It actually means "applied, waiting for approval" (`join-request.service.ts` header comment). An admin's "invite" creates an `ACTIVE` member straight away (`apps/server/src/features/invite-workspace-member/invite-workspace-member.handler.ts:151-187`).
- **Parents, children, family:** none. A search for guardian/parent/child/family turned up nothing beyond video categories. Because `User.email` is unique, a parent with two children needs three e-mail addresses.
- **Leaving a club:** a member cannot leave on their own. Only admins can remove someone (`features/remove-workspace-member`).
- **Ranks are per club:** `RankPromotion.workspaceId` (`:1418+`). A belt does not follow the person to another club.

## 2. Multiple clubs in the mobile app

**Current state**
- **Login:** `AuthProvider.refresh` (`apps/mobile/src/shared/auth-context.tsx`) loads `GET /get-my-workspaces`.
  - That list contains **ACTIVE memberships only** (`apps/server/src/domains/workspace/services/workspace.service.ts:27-30`), each with `accessExpired` and the section switches.
  - The active club is chosen by `pickActiveWorkspace` (`apps/mobile/src/shared/api/workspaces-cache.ts:46-51`): the last club picked (stored under `clubspace.activeWorkspaceId`), otherwise the first club with live access, otherwise any club.
- **0 clubs:** the app shows `NoWorkspaceScreen` (`apps/mobile/src/app/App.tsx` onboarding group).
  - It reads `GET /me/join-requests` and offers "Ввести код клуба" and "share my e-mail with the club".
  - Its states are decided in `apps/mobile/src/features/auth/onboarding-view.ts:16-36`.
- **1 club:** the member goes straight in.
- **N clubs:** the member also goes straight into the last-used club.
  - **The only switcher is the "Клубы" list at the bottom of the Profile tab** (`apps/mobile/src/features/profile/ProfileScreen.tsx:169-220`), plus "Добавить клуб".
  - The Home header shows the club name as plain text that can't be tapped (`apps/mobile/src/features/home/HomeScreen.tsx:346-348`).
- **Lapsed access:** `AccessExpiredScreen` lets the member jump to any club that is still live (`apps/mobile/src/features/auth/switchable-workspaces.ts:5-10`).
- **Notifications** are per user and span clubs (`Notification` has no `workspaceId`, `:266-289`).
  - Tapping one switches club using `metadata.workspaceId` (`apps/mobile/src/features/notifications/notification-route.ts:160-232`).
  - The settings are global, with no per-club muting (`NotificationPreferences`, `:291-314`).
- **Schedule, videos, subscription, ranks and feed are all scoped to one club.** Every member-facing endpoint lives under `workspaces/:workspaceId/…`. The only user-level endpoints are `/me`, `/me/notifications`, `/me/join-requests`, `/me/notification-preferences` and `/videos/*`.
  - **There is no combined "my week across all my clubs" view.**
- **Brand builds** (`apps/mobile/src/shared/brand.ts`): `EXPO_PUBLIC_BRAND` takes `grappling | fitness | yoga | custom | clubspace`, and each preset has a default `workspaceKey`. `EXPO_PUBLIC_WORKSPACE_KEY` overrides it, and `EXPO_PUBLIC_CLUB_PICKER=true` sets it to null (the neutral build).
  - In a branded build, **every** sign-in sends `workspaceKey` (`apps/mobile/src/features/auth/SignInScreen.tsx` `sendCode`). That silently files a pending request to the built-in club (`apps/server/src/features/send-auth-code/send-auth-code.handler.ts:72-74,107-134`).
- **Per-club theming: none.**
  - `brand.colors` is defined but never read anywhere in `apps/mobile/src`.
  - The theme doesn't depend on the club, and the icon and splash are a single shared set (`apps/mobile/assets/images/*`).
  - The PWA manifest name is hard-coded to «Грэпплинг Академия» (`apps/mobile/public/manifest.webmanifest:2`).

## 3. Joining and discovery

**Current state**
- **Join code:** 8 characters, stored in `WorkspaceJoinCode` (`:562-566`). It's created lazily and admins can rotate it.
  - `POST /workspaces/join` (`apps/server/src/features/join-workspace/join-workspace.controller.ts`) is rate-limited.
  - It creates an `INVITED` (pending) membership, or `ACTIVE` if `joinAutoApprove` is on (`join-workspace.handler.ts:30-140`).
  - Unknown and disabled codes return the same answer.
- **Join links and QR:** `buildJoinUrl` produces `${APP_URL}/join/<code>` (`apps/server/src/domains/workspace/invite-links.ts:15-16`). The mobile app catches `https://<web>/join/<code>` and `clubspace://join/<code>` and holds the code until sign-in (`apps/mobile/src/features/join/pending-join.ts`). There is no QR scanner inside the app.
- **Admin invite by e-mail:** creates the user if needed and makes them an ACTIVE member immediately, optionally adding them to a group (`invite-workspace-member.handler.ts:139-205`). The `member-invite` e-mail carries the code, the link and store buttons.
- **Owner welcome e-mail:** `create-platform-workspace.handler.ts:165-213` sends an admin sign-in link, the join code, and store buttons.
- **Store buttons** in e-mails are Google Play, RuStore and "Открыть в браузере" only (`invite-links.ts:28-44`). **There is no App Store URL anywhere** (`apps/server/src/environments/environment.ts:58-61`).
- **What an invited person sees after installing:** an admin invite is already ACTIVE, so signing in with that e-mail lands them straight in the club. Self-applicants see their pending/rejected requests, but **only while they have zero clubs**: `listMyJoinRequests` is used only in `NoWorkspaceScreen`.
- **Universal / App Links:** only the opt-in club-picker build declares them (`apps/mobile/src/app-variant.js:17-40`). There are no `assetlinks.json` or `apple-app-site-association` files anywhere in the repo.
- **Production web host:** `app.<domain>` is proxied to **`apps/client`** (`deploy/Caddyfile`, the `app.{$DOMAIN}` block; `docker-compose.prod.yml:289-298`).
  - `apps/client` has only `/`, `/sign-in`, `/courses`, `/courses/[id]`, `/videos/[id]`, `/profile`, `/report` and `/legal/*`. It has **no `/join` route**, no rewrites, and no `.well-known` files.
  - The Expo PWA (`dist-web`) is not deployed anywhere in `docker-compose.prod.yml` or `deploy/README.md`.
  - **So join links and QR codes in production resolve to the Next.js 404 page `[INFERENCE: from config]`.**
- **Join-request approval:** `features/list-pending-users`, `reject-pending-member`, and invite (which also approves). Staff get notified, capped at 20 per hour (`join-request.service.ts`).
- **Public club pages, club search, map, preview before joining: none.** The only unauthenticated endpoint that takes a club is the `workspaceKey` side effect of send-auth-code.
- **`apps/client`** is the legacy Next.js course catalog. The README says it is "not wired into dev/CI", yet it is the production `app.` host and serves the legal pages that the stores require (`PRIVACY_POLICY.md`).

## 4. Content

**Current state**
- **Structure:** `Video` (`:616-653`) → `Course` (`:814-851`) → `Chapter` (`:854-870`) → `CourseVideo` lessons with order, title and optional flag (`:872-895`). Videos also carry tags, categories (a tree via `parentId`), timestamps, subtitles, favourites and watch progress.
- **Uploads:** coaching roles via `admin/videos` (`@Roles(COACHING_ROLES)`). The video worker transcodes to HLS.
- **Visibility:** `Course.isPublic` plus `publishedAt` (scheduling).
  - `Course.accessLevel`, `level` and `lockedProgression` are free-text or boolean fields that nothing enforces. They only appear in DTOs and `playlist.service.ts:63-130`.
  - **There is no gating by group, rank, subscription or tariff.**
- **Offline downloads:** yes — `GET /videos/:id/offline-download` returns a presigned MP4 (`features/get-offline-download`), and there is an `OfflineLibraryScreen`.
- **Sharing curriculum between clubs, affiliations, franchises, a marketplace, selling courses: none.** Every content row is scoped to one club.

## 5. Payments

**Current state**
- **Abonements are tracked manually.** `Subscription.source` is always `MANUAL`; `GATEWAY` is reserved and nothing uses it (`:49-62`, `:1046-1050`). `isPaid` and `paidAt` exist, plus a "waiting for payment" list.
- **There is no acquiring.** I found no YooKassa, CloudPayments, Tinkoff, Stripe or in-app purchase code.
- `Plan.workspaceId` is optional (`:1107-1143`), which may have been meant for platform-wide plans, but no feature uses it that way.
- **Platform billing of clubs (SaaS): none.** No tariffs, trials, limits, invoices or club suspension.

## 6. Store readiness

| Item | State | Evidence |
|---|---|---|
| Bundle IDs | `com.clubspace.app` (iOS and Android) for **every** build, branded or neutral | `apps/mobile/app.json:11-18`; `apps/mobile/README.md` caveats |
| App name / slug | `"Грэпплинг Академия"` / `grappling-academy-mobile`, while the brand preset says "BJJ Academy" | `app.json:3-4`, `brand.ts` |
| Neutral build | opt-in profiles `club-picker` and `club-picker-store`; the default `production`/`store` profiles are the branded single-club app | `apps/mobile/eas.json` |
| EAS | `appVersionSource: remote`; `ascAppId` is still `REPLACE_…`; Android `production` builds an APK and `store` builds an AAB | `eas.json` |
| Release guard | `check-release-env.mjs` blocks placeholder URLs, brand, club key and support e-mail | `apps/mobile/scripts/check-release-env.mjs` |
| Icons / splash | one shared set, not per brand | `apps/mobile/assets/images/` |
| Permissions | none requested; microphone, storage and biometric are blocked; `ITSAppUsesNonExemptEncryption=false` | `app.json:14-34,58-64` |
| Account deletion | in-app, under Settings → «Удалить аккаунт» (`DELETE /me`); refused for owners and group coaches until they hand over | `apps/mobile/src/features/profile/SettingsScreen.tsx:133,435`; `users.service.ts:79-90` |
| Privacy / terms | served by `apps/client` at `/legal/*`; the app links to `${EXPO_PUBLIC_WEB_URL}/legal/*` | `brand.ts`, `deploy/README.md:334-341` |
| Sign-in | e-mail code only; reviewer account via `STORE_REVIEW_EMAIL/CODE`, which is not given a club automatically | `send-auth-code.handler.ts:40-48`; `environment.ts:82-87` |
| Push | Expo push tokens, sent from the server through `exp.host` | `push-registration.ts:55-60`; `apps/server/.../expo-push.client.ts:11` |
| Push config gaps | no `extra.eas.projectId`, no `android.googleServicesFile`, `expo-notifications` not in `plugins` `[INFERENCE: Android push needs the FCM config]` | `app.json` |
| Web push | none; disabled on purpose (`supportsPushNotifications`) | `push-registration.ts:33-36`; `public/service-worker.js` has no push handler |
| PWA manifest | static, name fixed to «Грэпплинг Академия»; not rewritten per brand | `public/manifest.webmanifest`, `scripts/build-pwa.mjs` |
| i18n | none: no i18n library, all UI, e-mails and server errors are in Russian; sign-in always sends `language: "RU"` | grep for i18next/intl found nothing; `SignInScreen.tsx` |

## 7. Admin and platform console

**Current state**
- **Clubs are created only by the platform owner:** `POST /platform/workspaces` (`create-platform-workspace.handler.ts`) takes a name and the owner's e-mail.
  - `/sign-up` in the admin app just redirects to `/sign-in` (`apps/admin/src/app/(auth)/sign-up/page.tsx`). There is no self-serve sign-up.
- **The platform owner can change** name, type, timezone, `isActive` (not enforced on the server, `update-platform-workspace.feature.ts:10-14`) and owner (transfer).
- **New club defaults by type:** videos and journal are off for non-grappling clubs (`domains/workspace/feature-flags.ts:130-150`).
- **No trials, plans, limits, usage metering or billing.**
- **Admin club picker:** `apps/admin/src/app/(dashboard)/workspaces/page.tsx` lists clubs where the user is staff. With one such club it goes straight in. Students are told to use the mobile app.

## 8. How clubs and coaches interact

**Current state**
- **A coach in several clubs** has a separate membership in each, which works. There is no shared coach profile.
- **Events** (`WorkspaceEvent`, `:498-538`) cover seminars, open mats and special classes inside one club.
  - The coach must be a member of that club (`manage-workspace-events/create-workspace-event.handler.ts:83-93`).
  - There is no guest instructor who isn't a member, no registration or capacity, no price, and no visibility across clubs.
- **Drop-ins / guest visits** (`features/drop-ins`) are other groups within the same club, not other clubs.
- **There is no network, organisation, affiliation or franchise level.** Nothing connects clubs beyond the one user record they share.

---

## Ranked concept gaps

| # | Sev | Gap | User impact | Proposed fix | Effort |
|---|---|---|---|---|---|
| 1 | **Critical** | **Join and invite links lead to a 404 in production.** `APP_URL/join/<code>` is served by `apps/client`, which has no `/join` route; the PWA isn't deployed; there are no `.well-known` files. | Every invite e-mail, owner welcome e-mail and QR poster is a dead end; the main way people discover a club fails. | Serve the Expo PWA (`dist-web`) at `app.<domain>`, and move `/legal/*` into it or onto a separate site. Or add `apps/client/src/app/join/[code]/page.tsx`: show a club preview, open `clubspace://join/<code>`, fall back to the store or PWA. Host `/.well-known/assetlinks.json` and `apple-app-site-association` there. Add an e2e check that `GET /join/XXXX` returns 200. | S–M |
| 2 | **Critical** | **The store distribution model doesn't fit a multi-club platform.** The default release is a branded single-club app (`com.clubspace.app`, "Грэпплинг Академия", club baked in). Bundle ID, name, icon and scheme can't be changed per club. The neutral build shares the bundle ID and would replace the branded app on the same listing. E-mails link a single global `PLAY_STORE_URL` for every club. | A yoga studio's invite sends people to a BJJ-branded app, whose sign-in files a request to the BJJ club. Only one club can ever be published. Apple guideline 4.2.6 rejects template "white-label" apps submitted from one developer account `[INFERENCE: App Store Review Guidelines]`. | Make the **neutral ClubSpace app the single canonical listing** on App Store, Google Play and RuStore (promote the `club-picker` profiles to `production`/`store`). Treat white-label as a paid tier: `app.config.js` reads bundle ID, name, icon, splash and scheme from env per tenant, published under the club's own developer account. Add `APP_STORE_URL` and an App Store button to `buildAppLinks`. Rename `app.json` to ClubSpace. | M |
| 3 | **High** | **Multi-club identity UX is thin.** The switcher is buried at the bottom of Profile; the Home header isn't tappable; there's no unified agenda; notification settings are global; no club colours or logo; members can't leave a club; pending requests are hidden once the person has at least one club. | A person in a BJJ club and a yoga studio has to dig through Profile to switch and can't see "what's on today" across both. Clubs feel like the same app. | (a) Make the club name in the Home and Schedule headers a club switcher (bottom sheet listing each club with role and access status, plus "+ Добавить клуб"). (b) Add `GET /me/agenda?from&to` that merges the schedule projection, events, drop-ins and personal trainings across ACTIVE memberships, with a filter chip per club. (c) Add `workspaceId` to `Notification` and per-club mute in preferences. (d) Add `Workspace.logoUrl` and `accentColor` and theme by the active club. (e) Add `DELETE /me/workspaces/:id` to leave a club. (f) Show pending requests in the Profile → Клубы section. | M–L |
| 4 | **High** | **No way to discover a club before joining.** No public club page, search or preview; a member types a code without seeing which club it is. | Low conversion and trust; nothing for SEO or word of mouth. | Add a `Workspace.slug`, `isListed`, city, description and logo. Add a public `GET /public/clubs/:slugOrCode` endpoint showing name, logo, type, gyms and schedule summary. Add a `/c/:slug` web page with a "Join" button that leads into the code flow. Add opt-in search by city and type later. | M |
| 5 | **High** | **No families or minors.** Email is unique; there are no guardian accounts or consent. | Kids' BJJ, a core segment, can't be modelled properly; parents can't manage two children; Russian data law 152-FZ requires parental consent for minors' data `[INFERENCE]`. | Add `UserGuardian(guardianId, dependentId)` and dependents without a login (e-mail optional). Let the member app switch to "act as child" (attendance, subscription). Record consent with a timestamp. | L |
| 6 | **High** | **No online payments and no SaaS billing.** Only manual `MANUAL` records; nothing ties a club's tariff to plans or limits; `isActive` isn't enforced. | Members can't pay in the app; the platform can't make money or run trials; investors see no revenue mechanics. | Members: a provider adapter (YooKassa or CloudPayments for Russia, Stripe for US/EU) whose webhook sets `source=GATEWAY` (fields already exist). Clubs: add `PlatformPlan`, `WorkspaceBilling(trialEndsAt, planId, status)`, limits (members, video GB, coaches) enforced in guards, and a suspended-club screen. Physical gym services are exempt from in-app purchase rules; selling digital courses inside the app is not `[INFERENCE: Apple 3.1.1/3.1.3]`. | L |
| 7 | **High** | **No i18n**, while the plan includes the US/EU. | The app can't ship outside Russian-speaking markets. | Add i18next or Lingui to mobile and admin, and e-mail templates per `User.language`. Send the device locale at sign-in instead of the hard-coded `"RU"`. Return error codes from the server so clients translate them. | L |
| 8 | **Medium** | **Push setup is incomplete for the stores.** No EAS `projectId` or `google-services.json` in config; no web push; Expo/FCM only reaches phones with Google services. | Android pushes may silently fail; PWA and iOS-web users get nothing; Russian users on Huawei phones without Google services get no push `[INFERENCE]`. | Run `eas init` (projectId), add `android.googleServicesFile`, list `expo-notifications` in `plugins`, upload the APNs key. Consider RuStore Push for RuStore builds and Web Push (VAPID) in the service worker. | S–M |
| 9 | **Medium** | **Content can't be restricted** by group, rank or tariff; `accessLevel`/`level`/`lockedProgression` do nothing. | Clubs can't run a "blue-belt curriculum" or premium courses. | Add `CourseAudience(courseId, groupId?, rankLevelId?, planId?)` enforced in the list/get/playback handlers; enforce `lockedProgression`; drop the dead fields or wire them up. | M |
| 10 | **Medium** | **No connections between clubs:** no affiliations or franchise networks, shared curriculum, guest instructors, cross-club open mats, or portable rank. | Can't sell to networks (e.g. Gracie Barra–style affiliations); a belt is lost when a student moves clubs. | Add an `Organization` above `Workspace` (HQ role, shared content library that branches subscribe to, events published to the network). Let `RankPromotion` be "verified by club X" and appear on the user's global profile. Allow event coaches who aren't members. | L |
| 11 | **Medium** | **Branded sign-in files a request on every login.** | A member of club B who signs into club A's branded app creates an unwanted pending request at club A. | Only file it the first time an account is created, or ask "Join Club A?" after sign-in. | S |
| 12 | **Medium** | **No self-serve club onboarding or trial.** Only the platform owner can create a club. | Doesn't scale as B2B SaaS; demos depend on the operator. | A public "Create club" wizard: owner signs up with an e-mail code → name, type, timezone → trial plan → onboarding checklist (gym, group, slot, invite). Keep the console for approvals. | M |
| 13 | **Low** | **Naming and data model leftovers:** `INVITED` means "applied"; the owner-membership comment contradicts the create handler; the PWA manifest isn't branded; `brand.colors` is unused. | Developer confusion and branding drift. | Rename `INVITED` to `PENDING` (via `db push` with a mapping); fix the comments; generate the manifest from `brand` in `build-pwa.mjs`. | S |
| 14 | **Low** | **Sign-in options:** e-mail only, while `phone` sits unused. | Russian users often expect a phone/SMS or Telegram login. | Optional phone OTP (an SMS provider). If any social login is added later, Sign in with Apple becomes mandatory on iOS (guideline 4.8). | M |

## Summary
- **Multi-club identity is solid on the server.** One `User` can hold many `WorkspaceMember` rows with a different role in each, and notifications span clubs and switch the club when opened.
- **The member experience is still one club at a time.** The switcher is only in Profile, there's no combined schedule, no per-club theming or muting, and no way to leave a club.
- **Discovery is broken in production.** `app.<domain>` serves the legacy `apps/client` Next.js app, which has no `/join/<code>` page, no App/Universal Link files, and no App Store link in e-mails. The PWA that does handle `/join` isn't deployed. There is no public club page or search.
- **The store strategy contradicts the product.**
  - The default release is a single-club branded app («Грэпплинг Академия», `com.clubspace.app`, club key built in).
  - The neutral ClubSpace build is opt-in, shares the same bundle ID, and can't sit alongside the branded app.
  - My recommendation is one neutral ClubSpace listing per store, with white-label as a paid tier published under each club's own developer account.
- **Missing for an investor-grade B2B SaaS:**
  - payments (manual only; the gateway fields are unused)
  - platform billing, trials and limits
  - self-serve club creation
  - i18n (Russian only)
  - parent and child accounts
  - restricting content by group, rank or tariff
  - any network or affiliation level between clubs
- **Store basics that are already in place:** in-app account deletion, a reviewer test account, minimal permissions, and the legal pages.
- **Push setup has config gaps:** no EAS project ID, no Firebase config file, no web push.
