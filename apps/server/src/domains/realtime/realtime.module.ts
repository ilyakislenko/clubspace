import { Module } from '@nestjs/common'

import { RealtimeEmitter } from './realtime-emitter.service'

// RealtimeEmitter is a stateful singleton — the gateway calls setServer() on it,
// so every consumer must share the ONE instance. Exporting it from a module
// (instead of listing it ad-hoc in AppModule's providers) lets encapsulated
// sub-modules like VideoModule inject the same instance.
@Module({
    providers: [RealtimeEmitter],
    exports: [RealtimeEmitter],
})
export class RealtimeModule {}
