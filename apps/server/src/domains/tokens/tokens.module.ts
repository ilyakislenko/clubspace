import { DynamicModule, Module, Provider, Type } from '@nestjs/common'

import {
    TOKENS_CONFIG,
    TOKENS_OPTIONS_TYPE,
    TokensConfigurableModuleClass,
    patchTokensConfig,
} from './configs/tokens-module.config'
import { TokensService } from './services/tokens.service'

@Module({})
export class TokensModule extends TokensConfigurableModuleClass {
    static forRoot(options: typeof TOKENS_OPTIONS_TYPE): DynamicModule {
        const imports: any[] = []
        const controllers: Type<any>[] = []
        const providers: Provider[] = [
            {
                provide: TOKENS_CONFIG,
                useValue: patchTokensConfig(options),
            },
            TokensService,
        ]

        return {
            module: TokensModule,
            imports,
            controllers,
            providers,
            exports: providers,
        }
    }
}
