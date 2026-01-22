import { ConfigurableModuleBuilder } from '@nestjs/common'

export interface TokensConfig {
    test?: boolean
    jwt: {
        secret: string
        issuerUrl: string
        audienceUrl: string
        accessTokenTTL: number
        refreshTokenTTL: number
    }
}

export const DEFAULT_TOKENS_CONFIG: Pick<TokensConfig, 'test'> = {
    test: false,
}

export function patchTokensConfig(
    config: Pick<
        typeof TOKENS_OPTIONS_TYPE,
        keyof typeof DEFAULT_TOKENS_CONFIG
    >,
) {
    return {
        ...DEFAULT_TOKENS_CONFIG,
        ...config,
    }
}

export const {
    ConfigurableModuleClass: TokensConfigurableModuleClass,
    MODULE_OPTIONS_TOKEN: TOKENS_CONFIG,
    ASYNC_OPTIONS_TYPE: TOKENS_ASYNC_OPTIONS_TYPE,
    OPTIONS_TYPE: TOKENS_OPTIONS_TYPE,
} = new ConfigurableModuleBuilder<TokensConfig, 'forRoot'>({
    optionsInjectionToken: `TOKENS_CONFIG`,
}).build()
