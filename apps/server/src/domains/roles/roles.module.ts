import { DynamicModule, Module, Provider, Type } from '@nestjs/common'

import {
    patchRolesConfig,
    ROLES_CONFIG,
    ROLES_OPTIONS_TYPE,
    ROLESConfigurableModuleClass,
} from './configs/roles-module.config'
import { RolesService } from './services/roles.service'

@Module({})
export class RolesModule extends ROLESConfigurableModuleClass {
    static forRoot(options: typeof ROLES_OPTIONS_TYPE): DynamicModule {
        const imports: any[] = []
        const controllers: Type<any>[] = []
        const providers: Provider[] = [
            {
                provide: ROLES_CONFIG,
                useValue: patchRolesConfig(options),
            },
            RolesService,
        ]

        return {
            module: RolesModule,
            imports,
            controllers,
            providers,
            exports: providers,
        }
    }
}
