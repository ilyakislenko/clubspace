// YooKassa cancellation_details.reason → what a payer is told («Не удалось
// списать…: {reason}»). Shared by the platform's own billing (the club owner)
// and member autopay (the member and the club's staff).
export const DECLINE_REASON_RU: Record<string, string> = {
    insufficient_funds: 'на карте недостаточно средств',
    card_expired: 'истёк срок действия карты',
    permission_revoked: 'карта отвязана — автосписание по ней больше невозможно',
    payment_method_restricted: 'операции по карте ограничены банком',
    payment_method_limit_exceeded: 'превышен лимит операций по карте',
    issuer_unavailable: 'банк карты не ответил',
    fraud_suspected: 'банк заподозрил мошенничество',
    general_decline: 'банк отклонил платёж',
    country_forbidden: 'карты этой страны не принимаются',
}

export const declineReasonRu = (reason: string | null | undefined): string =>
    (reason && DECLINE_REASON_RU[reason]) || 'платёж отклонён'
