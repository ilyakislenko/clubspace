import { DynamicModule, Module, Provider, Type } from '@nestjs/common'

import {
    EMAIL_TEMPLATES_CONFIG,
    EMAIL_TEMPLATES_OPTIONS_TYPE,
    EmailTemplatesConfigurableModuleClass,
    patchEmailTemplatesConfig,
} from './configs/email-templates-module.config'
import { EmailTemplatesService } from './services/email-templates.service'

@Module({})
export class EmailTemplatesModule extends EmailTemplatesConfigurableModuleClass {
    static forRoot(
        options: typeof EMAIL_TEMPLATES_OPTIONS_TYPE,
    ): DynamicModule {
        const imports: any[] = []
        const controllers: Type<any>[] = []
        const providers: Provider[] = [
            {
                provide: EMAIL_TEMPLATES_CONFIG,
                useValue: patchEmailTemplatesConfig(options),
            },
            EmailTemplatesService,
        ]

        return {
            module: EmailTemplatesModule,
            imports,
            controllers,
            providers,
            exports: providers,
        }
    }
}
