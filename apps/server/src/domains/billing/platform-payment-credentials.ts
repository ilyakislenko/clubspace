import { environment } from '../../environments/environment'
import type { GatewayCredentials } from '../payments/payment-gateway.types'
import { missingSellerRequisites } from './club-legal'

// The platform's own YooKassa shop, as PaymentGatewayClient credentials, or
// null when billing is off or the shop is not configured — card payments and
// autopay are then off and only the console's manual «отметить оплату» works.
// Production also needs the seller's requisites (PLATFORM_SELLER_*, warned
// about at boot): the offer a club pays under must name who it pays.
// The provider seam: a Stripe shop would return { provider: 'STRIPE', … }
// here once saved cards are supported for it in PaymentGatewayClient.
export const platformGatewayCredentials = (): GatewayCredentials | null => {
    const cfg = environment.billing.yookassa
    if (!environment.billing.enabled || !cfg?.shopId || !cfg.secretKey) {
        return null
    }
    if (
        environment.production &&
        missingSellerRequisites(environment.billing.legal.seller).length > 0
    ) {
        return null
    }
    return {
        provider: 'YOOKASSA',
        shopId: cfg.shopId,
        secretKey: cfg.secretKey,
        receipt: {
            enabled: cfg.receiptEnabled ?? true,
            vatCode: cfg.vatCode ?? 1,
            paymentSubject: 'service',
            paymentMode: 'full_prepayment',
            taxSystemCode: cfg.taxSystemCode ?? null,
        },
    }
}
