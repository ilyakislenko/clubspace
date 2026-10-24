import { Inject, Injectable } from '@nestjs/common'
import { ThrottlerGuard } from '@nestjs/throttler'
import type { IncomingMessage } from 'http'

import { TokensService } from '../../domains/tokens/services/tokens.service'
import { extractToken } from '../utils/extract-token.util'

// Rate limits per PERSON, not per address. A whole gym shares one public IP —
// the club Wi-Fi — so per-IP buckets meant twenty students checking in at the
// start of class throttled each other into 429s.
//
// A request whose bearer token VERIFIES is bucketed by its user id. Anything
// else — no token, or one that fails verification — falls back to the IP, so
// minting fake tokens can't buy an attacker a fresh bucket.
// For the sign-in routes: always the IP, even with a valid token. Otherwise
// someone holding N tokens of their own would get N buckets for enumerating
// emails or spamming codes. Use as `getTracker` in a route's @Throttle.
export const trackByClientIp = (req: Record<string, any>): string =>
    `ip:${req.ip}`

@Injectable()
export class ClubThrottlerGuard extends ThrottlerGuard {
    @Inject(TokensService)
    private readonly tokens!: TokensService

    protected override async getTracker(
        req: Record<string, any>,
    ): Promise<string> {
        const token = extractToken(req as IncomingMessage)
        if (token) {
            try {
                const { sub } = await this.tokens.verifyToken<{ sub: string }>(
                    token,
                )
                if (sub) return `user:${sub}`
            } catch {
                // invalid/expired → treated as anonymous
            }
        }
        return trackByClientIp(req)
    }
}
