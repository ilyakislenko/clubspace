import { z } from 'zod'

// How a sale (an abonement or an event ticket) was paid — Prisma PaymentMethod.
// CASH / TRANSFER / CARD (the club's terminal) are picked by staff when they
// record the payment; ONLINE is the club's checkout, set by the payment
// webhook only.
export const PaymentMethodSchema = z.enum(['CASH', 'TRANSFER', 'CARD', 'ONLINE'])
export type PaymentMethodValue = z.infer<typeof PaymentMethodSchema>

// What staff may pick when they record a payment at the club.
export const ClubPaymentMethodSchema = z.enum(['CASH', 'TRANSFER', 'CARD'])
export type ClubPaymentMethodValue = z.infer<typeof ClubPaymentMethodSchema>

export const PAYMENT_METHOD_LABELS: Record<PaymentMethodValue, string> = {
    CASH: 'Наличные',
    TRANSFER: 'Перевод',
    CARD: 'Карта в клубе',
    ONLINE: 'Онлайн',
}
