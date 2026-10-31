# ClubSpace mobile

Expo app (iOS, Android, PWA). One codebase, two ways to ship it. In both a member
can join a club by code, by link, or by QR code. Why it is split this way, and
what the stores allow: [docs/store-distribution.md](../../docs/store-distribution.md).

There is no `app.json`: `app.config.js` builds the whole Expo config from the
env through `src/app-variant.js` (unit-tested in `app-variant.spec.ts`). The
same module gives the PWA its manifest and icons (`scripts/sync-web-assets.mjs`).

## Build modes

### 1. Neutral «ClubSpace» app (default)

`EXPO_PUBLIC_CLUB_PICKER=true`, brand preset `clubspace`. No club is baked in:
the member signs in, then enters the club code (or opens the club's link or QR
code). Profiles: `preview`, `production` (APK), `store` (AAB, App Store build).
`scripts/set-mobile-target.sh` fills in `EXPO_PUBLIC_API_URL`,
`EXPO_PUBLIC_WEB_URL` and `EXPO_PUBLIC_SUPPORT_EMAIL`.

- Identity: «ClubSpace», `com.clubspace.app` (iOS and Android), scheme
  `clubspace`, icons from `assets/images/`. The EAS slug stays
  `grappling-academy-mobile`: the keystore and version counter live under it.
- Identity env is ignored in this mode, so a stray `EXPO_PUBLIC_BUNDLE_ID`
  cannot re-brand the canonical listing.

### 2. A club's branded app (on request)

`EXPO_PUBLIC_CLUB_PICKER=false`, the club baked in with
`EXPO_PUBLIC_WORKSPACE_KEY`: sign-in files a request to that club. Published
from the **club's own** developer accounts (Apple 4.2.6). Profiles: `branded`
(APK) and `branded-store` (AAB). They read everything else from the EAS
project's environment variables (`"environment": "production"`), not from
eas.json, because eas.json values would override them:

| Variable | Required | Meaning |
|---|---|---|
| `EXPO_PUBLIC_APP_NAME` | yes | Launcher/store name, also the sign-in title |
| `EXPO_PUBLIC_BUNDLE_ID` | yes | iOS bundle id and Android package, not `com.clubspace.*` |
| `APP_ASSETS_DIR` | yes | Folder with `icon.png`, `adaptive-icon.png`, `splash-icon.png`, `favicon.png` |
| `EXPO_PUBLIC_WORKSPACE_KEY` | yes | The club's key |
| `EXPO_PUBLIC_BRAND` | yes | Preset for tagline/colour: `grappling`, `fitness`, `yoga`, `clubspace`, `custom` |
| `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_WEB_URL`, `EXPO_PUBLIC_SUPPORT_EMAIL` | yes | As for the neutral app |
| `EXPO_PUBLIC_APP_COLOR` | no | `#rrggbb`, notification and PWA theme colour |
| `EXPO_PUBLIC_APP_SCHEME` | no | URL scheme; default: the bundle id in lowercase |
| `EXPO_PUBLIC_APP_SLUG` | no | EAS project slug; default: the bundle id with dashes |

Unset identity values fall back to the canonical ones, so `expo start` works
with no env at all; the release check refuses that for a real build.

### Both modes

- Links: the app claims `https://<EXPO_PUBLIC_WEB_URL host>/join/*` (universal
  links / App Links). The host must serve `apple-app-site-association` and
  `assetlinks.json` naming the app; until verified, links open the PWA, which
  also joins.
- Push: `expo-notifications` is a config plugin; `EAS_PROJECT_ID` becomes
  `extra.eas.projectId` (push tokens) and `GOOGLE_SERVICES_FILE` (an EAS file
  variable) becomes `android.googleServicesFile` (FCM).
- Release check (`scripts/check-release-env.mjs`, rules in `src/release-env.js`):
  refuses placeholder URLs/contacts, a canonical build that is not the picker, a
  branded build without its own name, id, club key or artwork, or under a
  `com.clubspace.*` id; warns when push config is missing.

## Joining a club

- Code: 8 characters, shown `XXXX-XXXX`, without 0, O, 1, I, L. Typing ignores
  case, spaces and dashes.
- Link: `https://<web host>/join/<code>` or `clubspace://join/<code>`. A link
  opened while signed out is remembered and used after sign-in.
- QR code: scan it with the phone's camera app, which opens the link. There is
  no scanner in the app.
- Result: the club accepts at once (opens in the app), or the request waits for
  an administrator (an e-mail and a notification arrive on approval), or the club
  rejected it.

## Commands

- Typecheck: `npx tsc -p apps/mobile/tsconfig.app.json --noEmit` (the plain
  `tsconfig.json` reports clean when it is not).
- Tests: `NX_DAEMON=false npx nx test @clubspace/mobile`
- PWA: `npm run build:pwa`
