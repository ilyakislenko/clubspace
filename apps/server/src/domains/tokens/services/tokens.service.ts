import { Inject, Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { SignOptions, TokenExpiredError } from 'jsonwebtoken'
import { createHash, randomUUID } from 'crypto'

import { PrismaService } from '../../../infrastructure/prisma'
import { TOKENS_CONFIG } from '../configs/tokens-module.config'
import type { TokensConfig } from '../configs/tokens-module.config'
import {
    TokenExpiredError as TokenExpiredErrorAlias,
    TokenMalformedError,
    TokenNotFoundError,
    TokenRevokedError,
} from '../errors/tokens.errors'

// Both token kinds share the secret, issuer and audience, so the `typ` claim is
// the only thing that tells them apart. Every verification path pins the kind
// it expects; a token without `typ` (minted before the claim existed) is
// refused by both, which sends old clients through a clean re-login.
export type AccessTokenClaims = {
    sub: string
    typ: 'access'
    // User.sessionVersion at issue time; AuthGuard refuses a stale one.
    sv: number
}

export type RefreshTokenClaims = {
    sub: string
    jti: string
    typ: 'refresh'
}

@Injectable()
export class TokensService {
    constructor(
        @Inject(TOKENS_CONFIG)
        private readonly config: TokensConfig,
        private readonly jwt: JwtService,
        private readonly prisma: PrismaService,
    ) {}

    async generateToken(payload: {
        userId: string
        sessionVersion: number
    }): Promise<string> {
        const signOptions: SignOptions = {
            issuer: this.config.jwt.issuerUrl,
            audience: this.config.jwt.audienceUrl,
            expiresIn: this.config.jwt.accessTokenTTL,
            subject: payload.userId,
        }

        return await this.jwt.signAsync(
            { typ: 'access', sv: payload.sessionVersion },
            { ...signOptions, secret: this.config.jwt.secret },
        )
    }

    // Mints a refresh token and its row. `familyId` carries a rotation chain
    // forward; omitted, the token starts a new family (a fresh sign-in).
    async generateStoredToken(payload: {
        userId: string
        familyId?: string
    }): Promise<string> {
        const signOptions: SignOptions = {
            jwtid: randomUUID(),
            issuer: this.config.jwt.issuerUrl,
            audience: this.config.jwt.audienceUrl,
            expiresIn: this.config.jwt.refreshTokenTTL,
            subject: payload.userId,
        }

        const refreshToken = await this.jwt.signAsync(
            { typ: 'refresh' },
            { ...signOptions, secret: this.config.jwt.secret },
        )

        const tokenHash = createHash('sha256')
            .update(refreshToken)
            .digest('hex')

        await this.prisma.refreshToken.create({
            data: {
                id: signOptions.jwtid,
                tokenHash,
                isRevoked: false,
                userId: payload.userId,
                familyId: payload.familyId ?? randomUUID(),
                // refreshTokenTTL is in SECONDS (same unit as the JWT
                // `expiresIn` above); convert to ms for the absolute Date so
                // the stored expiry reflects the real lifetime (e.g. 30 days)
                // instead of ~TTL milliseconds.
                expiresAt: new Date(
                    Date.now() + this.config.jwt.refreshTokenTTL * 1000,
                ),
            },
        })

        return refreshToken
    }

    // Access tokens only. Callers that also read other claims (AuthGuard)
    // widen the type with T.
    async verifyToken<T extends object = object>(
        token: string,
    ): Promise<AccessTokenClaims & T> {
        const claims = await this.verifySigned<AccessTokenClaims & T>(token)
        if (claims.typ !== 'access' || typeof claims.sv !== 'number') {
            throw new TokenMalformedError()
        }
        return claims
    }

    // Refresh tokens only. Presenting a token that was already rotated or
    // revoked is treated as theft: the whole family dies, so whichever side
    // holds the newer token is signed out too.
    async verifyStoredToken(payload: {
        token: string
    }): Promise<RefreshTokenClaims & { familyId: string }> {
        const claims = await this.verifySigned<RefreshTokenClaims>(
            payload.token,
        )
        if (claims.typ !== 'refresh' || !claims.jti) {
            throw new TokenMalformedError()
        }

        const row = await this.prisma.refreshToken.findUnique({
            where: { id: claims.jti },
            select: { isRevoked: true, familyId: true },
        })

        if (!row) {
            throw new TokenNotFoundError()
        }
        if (!row.familyId) {
            throw new TokenMalformedError()
        }
        if (row.isRevoked) {
            await this.revokeStoredTokenFamily({ familyId: row.familyId })
            throw new TokenRevokedError()
        }

        return { ...claims, familyId: row.familyId }
    }

    // Consumes a refresh token exactly once. Two concurrent refreshes with the
    // same token both pass verifyStoredToken; only one wins this conditional
    // update, and the loser is handled as reuse.
    async rotateStoredToken(payload: {
        jti: string
        familyId: string
    }): Promise<void> {
        const { count } = await this.prisma.refreshToken.updateMany({
            where: { id: payload.jti, isRevoked: false },
            data: { isRevoked: true, lastUsedAt: new Date() },
        })
        if (count !== 1) {
            await this.revokeStoredTokenFamily({ familyId: payload.familyId })
            throw new TokenRevokedError()
        }
    }

    async revokeStoredTokenFamily(payload: { familyId: string }) {
        await this.prisma.refreshToken.updateMany({
            where: { familyId: payload.familyId, isRevoked: false },
            data: { isRevoked: true },
        })
    }

    private async verifySigned<T extends object>(token: string): Promise<T> {
        try {
            return await this.jwt.verifyAsync<T>(token, {
                secret: this.config.jwt.secret,
                issuer: this.config.jwt.issuerUrl,
                audience: this.config.jwt.audienceUrl,
            })
        } catch (error) {
            if (error instanceof TokenExpiredError) {
                throw new TokenExpiredErrorAlias()
            }
            throw new TokenMalformedError()
        }
    }

    get accessTokenTTL(): number {
        return this.config.jwt.accessTokenTTL
    }

    get refreshTokenTTL(): number {
        return this.config.jwt.refreshTokenTTL
    }
}
