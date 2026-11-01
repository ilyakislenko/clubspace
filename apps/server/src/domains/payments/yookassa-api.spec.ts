import {
    buildYookassaCreatePayment,
    buildYookassaGetPayment,
    buildYookassaMe,
    buildYookassaRefund,
    formatYookassaAmount,
    parseYookassaMe,
    parseYookassaPayment,
    yookassaErrorMessage,
} from './yookassa-api'

const creds = {
    shopId: '123456',
    secretKey: 'test_secret',
    receipt: {
        enabled: true,
        vatCode: 11,
        paymentSubject: 'service',
        paymentMode: 'full_prepayment',
    },
}
const input = {
    paymentId: 'pay-1',
    workspaceId: 'ws-1',
    idempotenceKey: 'idem-1',
    amount: 4500,
    currency: 'RUB',
    description: 'Абонемент «Безлимит» — Клуб',
    itemName: 'Абонемент «Безлимит»',
    returnUrl: 'https://app.example.com/payment/pay-1',
    customerEmail: 'member@example.com',
}
const basic = `Basic ${Buffer.from('123456:test_secret').toString('base64')}`

describe('YooKassa request building', () => {
    it('creates a one-stage redirect payment with an Idempotence-Key', () => {
        const req = buildYookassaCreatePayment(creds, input)
        expect(req.method).toBe('POST')
        expect(req.url).toBe('https://api.yookassa.ru/v3/payments')
        expect(req.headers).toEqual({
            Authorization: basic,
            'Content-Type': 'application/json',
            'Idempotence-Key': 'idem-1',
        })
        const body = JSON.parse(req.body!)
        expect(body).toMatchObject({
            amount: { value: '4500.00', currency: 'RUB' },
            capture: true,
            confirmation: {
                type: 'redirect',
                return_url: 'https://app.example.com/payment/pay-1',
            },
            description: 'Абонемент «Безлимит» — Клуб',
            metadata: { paymentId: 'pay-1', workspaceId: 'ws-1' },
        })
    })

    it('attaches the 54-ФЗ receipt: customer e-mail and the tariff line', () => {
        const body = JSON.parse(buildYookassaCreatePayment(creds, input).body!)
        expect(body.receipt).toEqual({
            customer: { email: 'member@example.com' },
            items: [
                {
                    description: 'Абонемент «Безлимит»',
                    quantity: '1.00',
                    amount: { value: '4500.00', currency: 'RUB' },
                    vat_code: 11,
                    payment_subject: 'service',
                    payment_mode: 'full_prepayment',
                },
            ],
        })
    })

    it('omits the receipt when the club turned it off', () => {
        const body = JSON.parse(
            buildYookassaCreatePayment(
                { ...creds, receipt: { ...creds.receipt, enabled: false } },
                input,
            ).body!,
        )
        expect(body.receipt).toBeUndefined()
    })

    it('asks YooKassa to save the card on a redirect payment when told to', () => {
        const plain = JSON.parse(buildYookassaCreatePayment(creds, input).body!)
        expect(plain.save_payment_method).toBeUndefined()
        const saving = JSON.parse(
            buildYookassaCreatePayment(creds, { ...input, savePaymentMethod: true })
                .body!,
        )
        expect(saving.save_payment_method).toBe(true)
        expect(saving.confirmation.type).toBe('redirect')
    })

    it('charges a saved card without a confirmation step', () => {
        const body = JSON.parse(
            buildYookassaCreatePayment(creds, {
                ...input,
                savePaymentMethod: true,
                paymentMethodId: 'pm-1',
            }).body!,
        )
        expect(body.payment_method_id).toBe('pm-1')
        expect(body.confirmation).toBeUndefined()
        expect(body.save_payment_method).toBeUndefined()
    })

    it('adds the tax system code to the receipt when configured', () => {
        const body = JSON.parse(
            buildYookassaCreatePayment(
                { ...creds, receipt: { ...creds.receipt, taxSystemCode: 2 } },
                input,
            ).body!,
        )
        expect(body.receipt.tax_system_code).toBe(2)
    })

    it('clips description and item text to 128 characters', () => {
        const long = 'я'.repeat(200)
        const body = JSON.parse(
            buildYookassaCreatePayment(creds, {
                ...input,
                description: long,
                itemName: long,
            }).body!,
        )
        expect(body.description).toHaveLength(128)
        expect(body.receipt.items[0].description).toHaveLength(128)
    })

    it('re-reads a payment, refunds with its own key, reads the shop', () => {
        expect(buildYookassaGetPayment(creds, 'abc/../x')).toEqual({
            method: 'GET',
            url: 'https://api.yookassa.ru/v3/payments/abc%2F..%2Fx',
            headers: { Authorization: basic },
        })
        const refund = buildYookassaRefund(creds, {
            providerPaymentId: 'yk-1',
            amount: 4500,
            currency: 'RUB',
            idempotenceKey: 'refund-pay-1',
        })
        expect(refund.url).toBe('https://api.yookassa.ru/v3/refunds')
        expect(refund.headers['Idempotence-Key']).toBe('refund-pay-1')
        expect(JSON.parse(refund.body!)).toEqual({
            payment_id: 'yk-1',
            amount: { value: '4500.00', currency: 'RUB' },
        })
        expect(buildYookassaMe(creds).url).toBe('https://api.yookassa.ru/v3/me')
    })

    it('formats whole units with two decimals', () => {
        expect(formatYookassaAmount(1)).toBe('1.00')
        expect(formatYookassaAmount(12500)).toBe('12500.00')
    })
})

describe('YooKassa response parsing', () => {
    it('maps a paid succeeded payment', () => {
        expect(
            parseYookassaPayment({
                id: 'yk-1',
                status: 'succeeded',
                paid: true,
                amount: { value: '4500.00', currency: 'RUB' },
            }),
        ).toEqual({
            providerPaymentId: 'yk-1',
            status: 'SUCCEEDED',
            confirmationUrl: null,
            amountMinor: 450000,
            currency: 'RUB',
            paymentMethod: null,
            cancellationReason: null,
        })
    })

    it('reads the saved card and the reason of a refusal', () => {
        const paid = parseYookassaPayment({
            id: 'yk-1',
            status: 'succeeded',
            paid: true,
            payment_method: {
                type: 'bank_card',
                id: 'pm-1',
                saved: true,
                title: 'Bank card *4444',
                card: { last4: '4444', card_type: 'MasterCard' },
            },
        })
        expect(paid.paymentMethod).toEqual({
            id: 'pm-1',
            saved: true,
            title: 'Bank card *4444',
            cardLast4: '4444',
        })
        const refused = parseYookassaPayment({
            id: 'yk-2',
            status: 'canceled',
            cancellation_details: { party: 'payment_network', reason: 'insufficient_funds' },
        })
        expect(refused.cancellationReason).toBe('insufficient_funds')
    })

    it('treats succeeded-but-unpaid and waiting_for_capture as pending', () => {
        expect(
            parseYookassaPayment({ id: 'a', status: 'succeeded', paid: false })
                .status,
        ).toBe('PENDING')
        expect(
            parseYookassaPayment({ id: 'a', status: 'waiting_for_capture' })
                .status,
        ).toBe('PENDING')
        expect(
            parseYookassaPayment({ id: 'a', status: 'canceled' }).status,
        ).toBe('CANCELED')
    })

    it('reads the confirmation URL of a new payment', () => {
        expect(
            parseYookassaPayment({
                id: 'yk-1',
                status: 'pending',
                confirmation: {
                    type: 'redirect',
                    confirmation_url: 'https://yoomoney.ru/checkout/x',
                },
            }).confirmationUrl,
        ).toBe('https://yoomoney.ru/checkout/x')
    })

    it('refuses a payment without an id', () => {
        expect(() => parseYookassaPayment({ status: 'succeeded' })).toThrow()
    })

    it('reads the shop info and error descriptions', () => {
        expect(parseYookassaMe({ account_id: 123456, test: true })).toEqual({
            accountId: '123456',
            testMode: true,
        })
        expect(
            yookassaErrorMessage({ type: 'error', description: 'Bad key' }),
        ).toBe('Bad key')
        expect(yookassaErrorMessage('oops')).toBeNull()
    })
})
