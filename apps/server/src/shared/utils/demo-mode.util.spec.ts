jest.mock('../../environments/environment', () => ({
    environment: { demo: { enabled: false } },
}))

import { environment } from '../../environments/environment'
import {
    demoCodeMatches,
    isDemoAccountEmail,
    isDemoModeOn,
    resolveDemoMode,
} from './demo-mode.util'

const ON = { enabled: true, workspaceKey: 'arsenal-demo', code: '730592' }

describe('resolveDemoMode', () => {
    it('is null when off, whatever else is set', () => {
        expect(resolveDemoMode({ enabled: false, workspaceKey: 'x', code: '1' })).toBeNull()
    })

    it('refuses any key but the demo club', () => {
        expect(() => resolveDemoMode({ ...ON, workspaceKey: undefined })).toThrow(/DEMO_WORKSPACE_KEY=arsenal-demo/)
        expect(() => resolveDemoMode({ ...ON, workspaceKey: 'my-real-club' })).toThrow(/never acts on another club/)
    })

    it.each([undefined, '', '12345', 'abcdef', '1234567'])('refuses the code %p', (code) => {
        expect(() => resolveDemoMode({ ...ON, code })).toThrow(/6 digits/)
    })

    it.each(['111111', '123456', '121212', '112233'])('refuses the guessable code %s', (code) => {
        expect(() => resolveDemoMode({ ...ON, code })).toThrow(/easy to guess/)
    })

    it('accepts the demo key with a strong code', () => {
        expect(resolveDemoMode({ ...ON, workspaceKey: ' arsenal-demo ' })).toEqual({
            workspaceKey: 'arsenal-demo',
            code: '730592',
        })
    })
})

describe('demo mode at runtime', () => {
    afterEach(() => {
        environment.demo = { enabled: false }
    })

    it('is off, and matches nothing, by default', () => {
        expect(isDemoModeOn()).toBe(false)
        expect(isDemoAccountEmail('owner@arsenal.demo')).toBe(false)
        expect(demoCodeMatches('730592')).toBe(false)
    })

    it('fails closed on a config that would not boot', () => {
        environment.demo = { ...ON, workspaceKey: 'other' }
        expect(isDemoModeOn()).toBe(false)
        expect(isDemoAccountEmail('owner@arsenal.demo')).toBe(false)
    })

    it('recognises only the demo accounts and the configured code', () => {
        environment.demo = ON
        expect(isDemoModeOn()).toBe(true)
        expect(isDemoAccountEmail(' Owner@Arsenal.demo ')).toBe(true)
        expect(isDemoAccountEmail('someone@arsenal.demo')).toBe(false)
        expect(isDemoAccountEmail(null)).toBe(false)
        expect(demoCodeMatches('730592')).toBe(true)
        expect(demoCodeMatches('730593')).toBe(false)
        expect(demoCodeMatches('7305920')).toBe(false)
    })
})
