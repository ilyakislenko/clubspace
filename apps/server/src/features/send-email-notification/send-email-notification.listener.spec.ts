import {
    EMAIL_RETRY_DELAYS_MS,
    SendEmailNotificationListener,
} from './send-email-notification.listener'

const transportError = () =>
    Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' })
const recipientError = () =>
    Object.assign(new Error('550 no such user'), { code: 'EENVELOPE' })

const setup = (sendMail: jest.Mock) => {
    const mailHealth = { recordDelivered: jest.fn(), recordFailure: jest.fn() }
    const listener = new SendEmailNotificationListener(
        {} as never,
        { sendMail } as never,
        {} as never,
        mailHealth as never,
    )
    const sleep = jest
        .spyOn(listener as unknown as { sleep: (ms: number) => Promise<void> }, 'sleep')
        .mockResolvedValue(undefined)
    return { listener, mailHealth, sleep }
}

const MAIL = { to: 'a@b.com', subject: 's', html: '<p>x</p>' }

describe('SendEmailNotificationListener.sendWithRetry', () => {
    it('sends once and records a healthy delivery', async () => {
        const sendMail = jest.fn().mockResolvedValue({ messageId: 'm1' })
        const { listener, mailHealth, sleep } = setup(sendMail)
        await expect(listener.sendWithRetry(MAIL)).resolves.toEqual({ messageId: 'm1' })
        expect(sendMail).toHaveBeenCalledTimes(1)
        expect(sleep).not.toHaveBeenCalled()
        expect(mailHealth.recordDelivered).toHaveBeenCalledTimes(1)
    })

    it('rides out a transport blip with backoff', async () => {
        const sendMail = jest
            .fn()
            .mockRejectedValueOnce(transportError())
            .mockResolvedValueOnce({ messageId: 'm2' })
        const { listener, mailHealth, sleep } = setup(sendMail)
        await expect(listener.sendWithRetry(MAIL)).resolves.toEqual({ messageId: 'm2' })
        expect(sleep).toHaveBeenCalledWith(EMAIL_RETRY_DELAYS_MS[0])
        expect(mailHealth.recordFailure).not.toHaveBeenCalled()
        expect(mailHealth.recordDelivered).toHaveBeenCalledTimes(1)
    })

    it('gives up after the last retry and reports the outage', async () => {
        const sendMail = jest.fn().mockRejectedValue(transportError())
        const { listener, mailHealth, sleep } = setup(sendMail)
        await expect(listener.sendWithRetry(MAIL)).rejects.toThrow('ETIMEDOUT')
        expect(sendMail).toHaveBeenCalledTimes(EMAIL_RETRY_DELAYS_MS.length + 1)
        expect(sleep).toHaveBeenCalledTimes(EMAIL_RETRY_DELAYS_MS.length)
        expect(mailHealth.recordFailure).toHaveBeenCalledTimes(1)
    })

    it('does not retry a rejected recipient', async () => {
        const sendMail = jest.fn().mockRejectedValue(recipientError())
        const { listener, sleep } = setup(sendMail)
        await expect(listener.sendWithRetry(MAIL)).rejects.toThrow('550')
        expect(sendMail).toHaveBeenCalledTimes(1)
        expect(sleep).not.toHaveBeenCalled()
    })
})
