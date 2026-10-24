import { MailerService } from '@nestjs-modules/mailer'
import { Injectable, Logger } from '@nestjs/common'

import { MailUnavailableError } from '../../../shared/errors/shared.errors'
import { withTimeout } from '../../../shared/utils/with-timeout'

const SMTP_VERIFY_TIMEOUT_MS = 5000

// nodemailer codes for "couldn't talk to the mail server at all". Anything else
// — a rejected recipient, a malformed address — is about ONE message and must
// not make the server refuse sign-in codes for everybody.
const TRANSPORT_ERROR_CODES = new Set([
    'ECONNECTION',
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
    'ESOCKET',
    'EDNS',
    'EAUTH',
    'ETLS',
])

export const isTransportError = (error: unknown): boolean =>
    TRANSPORT_ERROR_CODES.has(String((error as { code?: unknown })?.code ?? ''))

// Sign-in is a code sent by email, and the send happens on an event listener
// after the request has already answered 200 — so a dead mail server used to
// lock everyone out with no error anywhere a person would see it.
//
// This tracks whether the last delivery attempt hit a transport failure. While
// mail works it costs nothing. Once it has failed, the next code request
// re-checks the SMTP connection live: still down → a clear 503 the app shows to
// the person; back up → the flag clears and the code goes out as normal. It
// never blocks on a stale verdict, because every refusal is a fresh check.
@Injectable()
export class MailHealthService {
    private readonly logger = new Logger(MailHealthService.name)
    private failingSince: Date | null = null
    // One live check at a time: during an outage every sign-in attempt would
    // otherwise open its own SMTP login against the dead relay.
    private probe: Promise<boolean> | null = null

    constructor(private readonly mailer: MailerService) {}

    recordDelivered(): void {
        if (this.failingSince) {
            this.logger.log(`mail delivery recovered (failing since ${this.failingSince.toISOString()})`)
        }
        this.failingSince = null
    }

    recordFailure(error: unknown): void {
        if (!isTransportError(error)) return
        if (!this.failingSince) {
            this.failingSince = new Date()
            this.logger.error(`mail transport failing: ${(error as Error)?.message ?? String(error)}`)
        }
    }

    async assertCanSend(): Promise<void> {
        if (!this.failingSince) return
        this.probe ??= this.verify().finally(() => {
            this.probe = null
        })
        const ok = await this.probe
        if (ok) {
            this.recordDelivered()
            return
        }
        throw new MailUnavailableError()
    }

    private async verify(): Promise<boolean> {
        try {
            return await withTimeout(
                this.mailer.verifyAllTransporters(),
                SMTP_VERIFY_TIMEOUT_MS,
            )
        } catch {
            return false
        }
    }
}
