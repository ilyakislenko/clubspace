import { z } from 'zod'

import { FeatureFlagColumnsSchema } from '../../domains/workspace/feature-flags'
import { FeatureLockSchema } from '../../domains/workspace/feature-locks'
import { WorkspaceBookingSettingsFields } from '../class-bookings/group-booking-fields'
import { WorkspaceTypeSchema } from '../platform/schemas'

export const GetWorkspaceSettingsFeatureOutputSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    // The club's kind: picks its words («тренировка» or «занятие»).
    type: WorkspaceTypeSchema,
    coachSeesAllGroups: z.boolean(),
    // «Тренеры могут отмечать в чужих группах без замены».
    coachesMarkAnyClass: z.boolean(),
    timezone: z.string(),
    joinAutoApprove: z.boolean(),
    // «Поздравлять с днём рождения» (the daily pass at club-local 10:00).
    birthdayGreetingsEnabled: z.boolean(),
    // «Сообщения ученикам на e-mail»: club messages may carry an e-mail copy.
    messagesEmailEnabled: z.boolean(),
    // leaderboardEnabled + the app-section flags all live here now.
    ...FeatureFlagColumnsSchema.shape,
    // «Запись на занятие»: window, free-cancel deadline, burn switches.
    ...WorkspaceBookingSettingsFields,
    // The platform VIDEO module: while false, videosEnabled cannot be turned
    // on and students see no videos whatever videosEnabled says.
    videoModuleEntitled: z.boolean(),
    // Switches the platform pinned («Установлено платформой»): the club
    // cannot change these until the lock ends or the platform lifts it.
    lockedFeatures: z.array(FeatureLockSchema),
    // The club row's version: settings edits (and the club profile's public
    // page and time zone) send it back as `expectedUpdatedAt`.
    updatedAt: z.iso.datetime(),
})

export class GetWorkspaceSettingsFeature {
    constructor(readonly workspaceId: string) {}
}

export type GetWorkspaceSettingsFeatureResponse = z.infer<
    typeof GetWorkspaceSettingsFeatureOutputSchema
>
