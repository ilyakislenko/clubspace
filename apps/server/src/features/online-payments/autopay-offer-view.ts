import {
    AUTOPAY_CONSENT_VERSION,
    autopayConsentLines,
} from '../../domains/autopay/autopay-consent'
import { environment } from '../../environments/environment'
import type { AutopayOfferOutput } from './schemas'

// The offer next to a tariff (purchase options, checkout quote): the renewal
// amount and the consent at the current version, «сейчас» = what the checkout
// charges now (a promo code included).
export const autopayOfferView = (p: {
    clubName: string
    plan: { name: string; currency: string; classCount: number | null }
    amountNow: number
    renewalAmount: number
}): AutopayOfferOutput => ({
    renewalAmount: p.renewalAmount,
    consentVersion: AUTOPAY_CONSENT_VERSION,
    consentLines: autopayConsentLines({
        clubName: p.clubName,
        planName: p.plan.name,
        amountNow: p.amountNow,
        renewalAmount: p.renewalAmount,
        currency: p.plan.currency,
        classCount: p.plan.classCount,
    }),
})

// The public «Условия автоплатежа» page (apps/client /legal/autopay).
export const autopayTermsUrl = (): string | null =>
    environment.appUrl ? `${environment.appUrl.replace(/\/+$/, '')}/legal/autopay` : null
