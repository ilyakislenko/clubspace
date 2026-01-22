import { Inject, Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { SignOptions, TokenExpiredError } from 'jsonwebtoken'
import { randomUUID } from 'crypto'

import { PrismaService } from '../../../infrastructure/prisma'
import { TOKENS_CONFIG, TokensConfig } from '../configs/tokens-module.config'
import {
    TokenExpiredError as TokenExpiredErrorAlias,
    TokenMalformedError,
    TokenNotFoundError,
    TokenRevokedError,
} from '../errors/tokens.errors'

@Injectable()
export class TokensService {
    constructor(
        @Inject(TOKENS_CONFIG)
        private readonly config: TokensConfig,
        private readonly jwt: JwtService,
        private readonly prisma: PrismaService,
    ) {}

    async generateToken<T extends { userId: string; [key: string]: string }>(
        payload: T,
    ): Promise<string> {
        const { userId, ...rest } = payload

        const signOptions: SignOptions = {
            issuer: this.config.jwt.issuerUrl,
            audience: this.config.jwt.issuerUrl,
            expiresIn: this.config.jwt.accessTokenTTL,
            subject: userId,
        }

        return await this.jwt.signAsync(rest, {
            ...signOptions,
            secret: this.config.jwt.secret,
        })
    }

    async generateStoredToken<
        T extends { userId: string; [key: string]: string },
    >(payload: T): Promise<string> {
        const { userId, ...rest } = payload

        const signOptions: SignOptions = {
            jwtid: randomUUID(),
            issuer: this.config.jwt.issuerUrl,
            audience: this.config.jwt.issuerUrl,
            expiresIn: this.config.jwt.refreshTokenTTL,
            subject: userId,
        }

        const refreshToken = await this.jwt.signAsync(rest, {
            ...signOptions,
            secret: this.config.jwt.secret,
        })

        await this.prisma.refreshToken.create({
            data: {
                id: signOptions.jwtid,
                isRevoked: false,
                userId,
                expiresAt: new Date(
                    Date.now() + this.config.jwt.refreshTokenTTL,
                ),
            },
        })

        return refreshToken
    }

    async revokeStoredToken(payload: { jti: string }) {
        await this.prisma.refreshToken.update({
            where: { id: payload.jti },
            data: { isRevoked: true },
        })

        return true
    }

    async verifyToken<T extends object>(token: string): Promise<T> {
        return await this.jwt.verifyAsync<T>(token, {
            secret: this.config.jwt.secret,
            issuer: this.config.jwt.issuerUrl,
            audience: this.config.jwt.issuerUrl,
        })
    }

    async verifyStoredToken(payload: { token: string }) {
        const decodedToken = await this.jwt.verifyAsync<{
            jti: string
            sub: string
        }>(payload.token, {
            secret: this.config.jwt.secret,
            issuer: this.config.jwt.issuerUrl,
            audience: this.config.jwt.issuerUrl,
        })

        const token = await this.prisma.refreshToken.findUnique({
            where: { id: decodedToken.jti },
        })

        if (!token) {
            throw new TokenNotFoundError({ id: decodedToken.jti })
        }

        if (token.isRevoked) {
            throw new TokenRevokedError()
        }

        return decodedToken
    }

    async decodeToken<T extends object>(token: string): Promise<T> {
        try {
            return await this.jwt.verifyAsync<T>(token, {
                secret: this.config.jwt.secret,
                issuer: this.config.jwt.issuerUrl,
                audience: this.config.jwt.issuerUrl,
            })
        } catch (error) {
            if (error instanceof TokenExpiredError) {
                throw new TokenExpiredErrorAlias()
            }

            throw new TokenMalformedError({})
        }
    }

    get accessTokenTTL(): number {
        return this.config.jwt.accessTokenTTL
    }

    get refreshTokenTTL(): number {
        return this.config.jwt.refreshTokenTTL
    }
}
