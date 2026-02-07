import { FactoryProvider } from '@nestjs/common'
import {
    EventsListenerInterface,
    EventsPublisherInterface,
} from '@shelfjs/events'

export const WORKSPACE_PUBLISHER = 'WORKSPACE_PUBLISHER'
export const WORKSPACE_LISTENER = 'WORKSPACE_LISTENER'
export const WORKSPACE_CONTEXT = 'workspace'

export type WorkspaceEventPublisherProvider = Omit<
    FactoryProvider<WorkspaceEventsPublisher>,
    'provide'
>

export type WorkspaceEventsPublisher = EventsPublisherInterface<
    WorkspaceEventPattern,
    WorkspaceEventPatternToData
>

export type WorkspaceEventsListener = EventsListenerInterface<
    WorkspaceEventPattern,
    WorkspaceEventPatternToData
>

export enum WorkspaceEventPattern {
    NEW_EVENT = 'NEW_EVENT',
}

type WorkspaceEventPatternToData = {
    [WorkspaceEventPattern.NEW_EVENT]: {
        userId: string
    }
}
