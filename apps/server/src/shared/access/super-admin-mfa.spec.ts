jest.mock('../../environments/environment', () => ({
    environment: { platformAdminMfaRequired: true },
}))

import { environment } from '../../environments/environment'
import { superAdminSessionAllowed } from './super-admin-mfa'

describe('superAdminSessionAllowed', () => {
    afterEach(() => {
        environment.platformAdminMfaRequired = true
    })

    it('needs the mfa claim when required', () => {
        expect(superAdminSessionAllowed({})).toBe(false)
        expect(superAdminSessionAllowed({ mfa: 'true' })).toBe(false)
        expect(superAdminSessionAllowed({ mfa: true })).toBe(true)
    })

    it('allows any session when not required', () => {
        environment.platformAdminMfaRequired = false
        expect(superAdminSessionAllowed({})).toBe(true)
    })
})
