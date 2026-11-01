import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'

// Static guard: @SkipConsentCheck lets an account that has not accepted the
// personal-data consent through AuthGuard. Only what the consent screen needs
// may carry it — reading the profile and the consent, accepting it, exporting
// one's own data, deleting the account (= withdrawing consent) and dropping a
// device's push token or a browser's Web Push subscription on sign-out. Anything else on this list means data is
// processed without consent.
const EXPECTED_CONSENT_EXEMPT = [
    'delete-account/delete-account.controller.ts',
    'export-my-data/export-my-data.controller.ts',
    'get-me/get-me.controller.ts',
    'personal-data-consent/my-consent.controller.ts',
    'register-firebase-device/firebase-devices.controller.ts',
    'web-push-subscriptions/web-push-subscriptions.controller.ts',
]

const SRC_DIR = join(__dirname, '..', '..')
const FEATURES_DIR = join(SRC_DIR, 'features')

const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
        const full = join(dir, name)
        return statSync(full).isDirectory() ? walk(full) : [full]
    })

const users = walk(SRC_DIR)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
    .filter((f) => readFileSync(f, 'utf8').includes('@SkipConsentCheck('))

describe('consent-exempt routes', () => {
    it('only the consent screen routes skip the consent gate', () => {
        expect(users.map((f) => relative(FEATURES_DIR, f)).sort()).toEqual(
            EXPECTED_CONSENT_EXEMPT,
        )
    })

    it('every exempt controller is a /me route', () => {
        for (const file of users) {
            expect(readFileSync(file, 'utf8')).toMatch(
                /@Controller\('me(\/[a-z-]+)?'\)/,
            )
        }
    })
})
