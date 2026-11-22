// «Отменить отметку оплаты» (abonement or ticket) is for a payment marked by
// mistake. It is refused once the sale has a refund — the refund would point at
// an unpaid sale — and on an online sale, whose Payment would lose its sale
// (docs/design/2026-11-15-payments-journal.md §3.3). Both are undone in
// «Платежи»: delete the refund record, or refund the online payment.
export const UNMARK_REFUNDED_MESSAGE =
    'По этой оплате есть возврат — сначала удалите запись о возврате'
export const UNMARK_ONLINE_MESSAGE = 'Онлайн-оплату отменяют возвратом в «Платежах»'
