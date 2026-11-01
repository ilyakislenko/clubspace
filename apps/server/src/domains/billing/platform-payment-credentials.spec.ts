const mockBilling: { enabled: boolean; yookassa?: Record<string, unknown> } = { enabled: true }
jest.mock('../../environments/environment', () => ({
    environment: {
        get billing() {
            return mockBilling
        },
    },
}))

import { platformGatewayCredentials } from './platform-payment-credentials'

describe('platformGatewayCredentials', () => {
    beforeEach(() => {
        mockBilling.enabled = true
        mockBilling.yookassa = { shopId: '123', secretKey: 'live_key' }
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
