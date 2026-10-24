import { isTransportError, MailHealthService } from './mail-health.service'

const transportError = () =>
    Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNECTION' })
const recipientError = () =>
    Object.assign(new Error('550 mailbox unavailable'), { code: 'EENVELOPE' })

const setup = (verify: jest.Mock = jest.fn().mockResolvedValue(true)) => {
    const mailer = { verifyAllTransporters: verify }
    return { svc: new MailHealthService(mailer as never), verify }
}

describe('isTransportError', () => {
    it('is true for connection-level nodemailer codes only', () => {
        expect(isTransportError(transportError())).toBe(true)
        expect(isTransportError({ code: 'EAUTH' })).toBe(true)
        expect(isTransportError(recipientError())).toBe(false)
        expect(isTransportError(new Error('boom'))).toBe(false)
        expect(isTransportError(undefined)).toBe(false)
    })
})

describe('MailHealthService', () => {
    it('lets codes go out without touching SMTP while mail works', async () => {
        const { svc, verify } = setup()
        await expect(svc.assertCanSend()).resolves.toBeUndefined()
        expect(verify).not.toHaveBeenCalled()
    })

    it('ignores a per-recipient rejection — one bad address must not block everyone', async () => {
        const { svc, verify } = setup()
        svc.recordFailure(recipientError())
        await expect(svc.assertCanSend()).resolves.toBeUndefined()
        expect(verify).not.toHaveBeenCalled()
    })

    it('after a transport failure, refuses while SMTP is still unreachable', async () => {
        const { svc, verify } = setup(jest.fn().mockResolvedValue(false))
        svc.recordFailure(transportError())
        await expect(svc.assertCanSend()).rejects.toMatchObject({
            code: 'MAIL_UNAVAILABLE',
            statusCode: 503,
        })
        expect(verify).toHaveBeenCalledTimes(1)
    })

    it('treats a throwing verify as still down', async () => {
        const { svc } = setup(jest.fn().mockRejectedValue(new Error('timeout')))
        svc.recordFailure(transportError())
        await expect(svc.assertCanSend()).rejects.toMatchObject({
            code: 'MAIL_UNAVAILABLE',
        })
    })

    it('clears itself once SMTP answers again, so nobody stays locked out', async () => {
        const verify = jest.fn().mockResolvedValue(true)
        const { svc } = setup(verify)
        svc.recordFailure(transportError())
        await expect(svc.assertCanSend()).resolves.toBeUndefined()
        await expect(svc.assertCanSend()).resolves.toBeUndefined()
        expect(verify).toHaveBeenCalledTimes(1)
    })

    it('a successful delivery clears the failure without a probe', async () => {
        const { svc, verify } = setup()
        svc.recordFailure(transportError())
        svc.recordDelivered()
        await expect(svc.assertCanSend()).resolves.toBeUndefined()
        expect(verify).not.toHaveBeenCalled()
    })
})
