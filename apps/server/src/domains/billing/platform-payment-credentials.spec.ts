const SELLER = {
    name: 'ИП Тестов Тест Тестович',
    inn: '770000000000',
    ogrnip: '300000000000000',
    address: 'г. Москва',
    bankName: 'АО «Банк»',
    bik: '044525000',
    account: '40802810000000000000',
    corrAccount: '',
    email: '',
    phone: '',
}
const mockBilling: {
    enabled: boolean
    yookassa?: Record<string, unknown>
    legal: { seller: typeof SELLER }
} = { enabled: true, legal: { seller: SELLER } }
let mockProduction = false
jest.mock('../../environments/environment', () => ({
    environment: {
        get billing() {
            return mockBilling
        },
        get production() {
            return mockProduction
        },
    },
}))

import { platformGatewayCredentials } from './platform-payment-credentials'

describe('platformGatewayCredentials', () => {
    beforeEach(() => {
        mockBilling.enabled = true
        mockBilling.yookassa = { shopId: '123', secretKey: 'live_key' }
        mockBilling.legal = { seller: SELLER }
        mockProduction = false
    })

    it('is null in production while a required seller requisite is blank', () => {
        mockProduction = true
        mockBilling.legal = { seller: { ...SELLER, inn: ' ' } }
        expect(platformGatewayCredentials()).toBeNull()
    })

    it('works in production once the required requisites are set', () => {
        mockProduction = true
        expect(platformGatewayCredentials()?.shopId).toBe('123')
    })

    it('ignores blank requisites outside production', () => {
        mockBilling.legal = { seller: { ...SELLER, name: '', inn: '' } }
        expect(platformGatewayCredentials()?.shopId).toBe('123')
    })

    it('is null when billing is off', () => {
        mockBilling.enabled = false
        expect(platformGatewayCredentials()).toBeNull()
    })

    it('is null without a shop', () => {
        mockBilling.yookassa = undefined
        expect(platformGatewayCredentials()).toBeNull()
    })

    it('is null without a shop id', () => {
        mockBilling.yookassa = { secretKey: 'live_key' }
        expect(platformGatewayCredentials()).toBeNull()
    })

    it('is null without a secret key', () => {
        mockBilling.yookassa = { shopId: '123' }
        expect(platformGatewayCredentials()).toBeNull()
    })

    it('returns YooKassa credentials with receipt defaults', () => {
        expect(platformGatewayCredentials()).toEqual({
            provider: 'YOOKASSA',
            shopId: '123',
            secretKey: 'live_key',
            receipt: {
                enabled: true,
                vatCode: 1,
                paymentSubject: 'service',
                paymentMode: 'full_prepayment',
                taxSystemCode: null,
            },
        })
    })

    it('applies receipt overrides', () => {
        mockBilling.yookassa = {
            shopId: '123',
            secretKey: 'live_key',
            receiptEnabled: false,
            vatCode: 6,
            taxSystemCode: 2,
        }
        expect(platformGatewayCredentials()?.receipt).toEqual({
            enabled: false,
            vatCode: 6,
            paymentSubject: 'service',
            paymentMode: 'full_prepayment',
            taxSystemCode: 2,
        })
    })
})
