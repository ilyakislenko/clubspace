import { FactoryProvider } from '@nestjs/common'
import {
    EventsListenerInterface,
    EventsPublisherInterface,
} from '@shelfjs/events'

export const TFA_PUBLISHER = 'TFA_PUBLISHER'
export const TFA_LISTENER = 'TFA_LISTENER'
export const TFA_CONTEXT = 'tfa'

export type TfaEventPublisherProvider = Omit<
    FactoryProvider<TfaEventsPublisher>,
    'provide'
>

export type TfaEventsPublisher = EventsPublisherInterface<
    TfaEventPattern,
    TfaEventPatternToData
>

export type TfaEventsListener = EventsListenerInterface<
    TfaEventPattern,
    TfaEventPatternToData
>

export enum TfaEventPattern {
    NEW_EVENT = 'NEW_EVENT',
}

type TfaEventPatternToData = {
    [TfaEventPattern.NEW_EVENT]: {
        userId: string
    }
}
