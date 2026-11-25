// The notification kinds of club messages: a direct one and a «служебное»
// pass the club mute and the «Сообщения клуба» switch; a broadcast doesn't.
export const CLUB_MESSAGE_KINDS = ['message.broadcast', 'message.service', 'message.direct'] as const
export type ClubMessageKind = (typeof CLUB_MESSAGE_KINDS)[number]

// Why a recipient got no push (null = a push row was written).
export const PUSH_SKIPS = ['muted', 'opted_out', 'no_device', 'cap'] as const
export type PushSkip = (typeof PUSH_SKIPS)[number]

export const clubMessageKind = (m: { isDirect: boolean; isService: boolean }): ClubMessageKind =>
    m.isDirect ? 'message.direct' : m.isService ? 'message.service' : 'message.broadcast'
