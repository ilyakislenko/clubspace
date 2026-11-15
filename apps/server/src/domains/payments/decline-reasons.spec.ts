import { DECLINE_REASON_RU, declineReasonRu } from './decline-reasons'

describe('declineReasonRu', () => {
    it('explains decline reasons in Russian', () => {
        expect(declineReasonRu('card_expired')).toBe('истёк срок действия карты')
        expect(declineReasonRu('insufficient_funds')).toBe('на карте недостаточно средств')
        expect(declineReasonRu('permission_revoked')).toBe(DECLINE_REASON_RU.permission_revoked)
    })

    it('falls back to a generic text for an unknown or missing reason', () => {
        expect(declineReasonRu('something_new')).toBe('платёж отклонён')
        expect(declineReasonRu(null)).toBe('платёж отклонён')
        expect(declineReasonRu(undefined)).toBe('платёж отклонён')
    })
})
