import { FactoryProvider } from '@nestjs/common'
import {
    EventsListenerInterface,
    EventsPublisherInterface,
} from '@shelfjs/events'

export const USERS_PUBLISHER = 'USERS_PUBLISHER'
export const USERS_LISTENER = 'USERS_LISTENER'
export const USERS_CONTEXT = 'users'

export type UsersEventPublisherProvider = Omit<
    FactoryProvider<UsersEventsPublisher>,
    'provide'
>

export type UsersEventsPublisher = EventsPublisherInterface<
    UsersEventPattern,
    UsersEventPatternToData
>

export type UsersEventsListener = EventsListenerInterface<
    UsersEventPattern,
    UsersEventPatternToData
>

export enum UsersEventPattern {
    USER_COMPLETE_CODE_CREATED = 'USER_COMPLETE_CODE_CREATED',
    USER_BIRTHDAY_APPROACHING = 'USER_BIRTHDAY_APPROACHING',
    USER_INVITE_TO_PLACE = 'USER_INVITE_TO_PLACE',
}

type UsersEventPatternToData = {
    [UsersEventPattern.USER_COMPLETE_CODE_CREATED]: {
        userId: string
        email: string
        completeCode: string
    }
    [UsersEventPattern.USER_BIRTHDAY_APPROACHING]: {
        userId: string
        birthdayUserId: string
        birthdayUserFirstname: string
    }
    [UsersEventPattern.USER_INVITE_TO_PLACE]: {
        userId: string
        userFirstName: string
        invitedUserId: string
        partnerId: string
        partnerName: string
        chatId: string
    }
}
