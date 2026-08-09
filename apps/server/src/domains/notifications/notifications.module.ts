import { DynamicModule, Module, Provider, Type } from '@nestjs/common'

import { NOTIFICATIONS_PUBLISHER } from './configs/notifications-events.config'
import {
    NOTIFICATIONS_OPTIONS_TYPE,
    NotificationsConfigurableModuleClass,
} from './configs/notifications-module.config'
import { NotificationsService } from './services/notifications.service'
import { NotificationsPreferencesService } from './services/preferences.service'

@Module({})
export class NotificationsModule extends NotificationsConfigurableModuleClass {
    static forRoot(options: typeof NOTIFICATIONS_OPTIONS_TYPE): DynamicModule {
        const imports: any[] = []
        const controllers: Type<any>[] = []
        const providers: Provider[] = [
            NotificationsService,
            NotificationsPreferencesService,
            {
                provide: NOTIFICATIONS_PUBLISHER,
                ...options.eventsProvider,
            },
        ]

        return {
            module: NotificationsModule,
            imports,
            controllers,
            providers,
            exports: providers,
        }
    }
}
