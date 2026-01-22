import { DynamicModule, Module, Provider, Type } from '@nestjs/common'

import { TFA_PUBLISHER } from './configs/tfa-events.config'
import {
    TFA_CONFIG,
    TFA_OPTIONS_TYPE,
    TfaConfigurableModuleClass,
    patchTfaConfig,
} from './configs/tfa-module.config'
import { TfaAuthenticatorService } from './services/tfa-authenticator.service'
import { TfaService } from './services/tfa.service'

@Module({})
export class TfaModule extends TfaConfigurableModuleClass {
    static forRoot(options: typeof TFA_OPTIONS_TYPE): DynamicModule {
        const imports: any[] = []
        const controllers: Type<any>[] = []
        const providers: Provider[] = [
            {
                provide: TFA_CONFIG,
                useValue: patchTfaConfig(options),
            },
            {
                provide: TFA_PUBLISHER,
                ...options.eventsProvider,
            },

            TfaService,
            TfaAuthenticatorService,
        ]

        return {
            module: TfaModule,
            imports,
            controllers,
            providers,
            exports: providers,
        }
    }
}
