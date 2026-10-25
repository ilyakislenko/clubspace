import { MailerModule } from '@nestjs-modules/mailer'
import { Module, ModuleMetadata } from '@nestjs/common'
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core'

import { DefaultErrorFilter } from '../shared/filters/default-error.filter'
import { JwtModule } from '@nestjs/jwt'
import { ThrottlerModule } from '@nestjs/throttler'
import { BullModule } from '@nestjs/bullmq'
import {
    createEventEmitterListener,
    createEventEmitterPublisher,
} from '@shelfjs/events/src/lib/services/event-emitter-events.service'
import { FeaturesModule } from '@shelfjs/features'

import { EventEmitterModule } from '@nestjs/event-emitter'
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod'
import { z } from 'zod'
import { AuditModule } from '../domains/audit/audit.module'
import { EmailTemplatesModule } from '../domains/email-templates/email-templates.module'
import { NOTIFICATIONS_LISTENER } from '../domains/notifications/configs/notifications-events.config'
import { NotificationsModule } from '../domains/notifications/notifications.module'
import { PlaylistModule } from '../domains/playlist/playlist.module'
import { RolesModule } from '../domains/roles/roles.module'
import type { TfaEventsPublisher } from '../domains/tfa/configs/tfa-events.config'
import { TfaModule } from '../domains/tfa/tfa.module'
import { TokensModule } from '../domains/tokens/tokens.module'
import { USERS_LISTENER } from '../domains/users/configs/users-events.config'
import { UsersModule } from '../domains/users/users.module'
import { VideoReadyProcessor } from '../domains/video/services/video-ready.processor'
import { SchedulerModule } from '../domains/scheduler/scheduler.module'
import { VideoModule } from '../domains/video/video.module'
import { WorkspaceModule } from '../domains/workspace/workspace.module'
import { environment } from '../environments/environment'
import { BootstrapSeedService } from './bootstrap-seed.service'
import { CreatePlaylistController } from '../features/create-playlist/create-playlist.controller'
import { CreatePlaylistHandler } from '../features/create-playlist/create-playlist.handler'
import { CreatePlaylistThumbnailUploadController } from '../features/create-playlist-thumbnail-upload/create-playlist-thumbnail-upload.controller'
import { CreatePlaylistThumbnailUploadHandler } from '../features/create-playlist-thumbnail-upload/create-playlist-thumbnail-upload.handler'
import { DeletePlaylistController } from '../features/delete-playlist/delete-playlist.controller'
import { DeletePlaylistHandler } from '../features/delete-playlist/delete-playlist.handler'
import { CancelDropInHandler } from '../features/drop-ins/cancel-drop-in.handler'
import { CreateDropInHandler } from '../features/drop-ins/create-drop-in.handler'
import { DropInsController } from '../features/drop-ins/drop-ins.controller'
import { GetMyDropInsHandler } from '../features/drop-ins/get-my-drop-ins.handler'
import { GetAttendanceSessionHandler } from '../features/attendance/get-session.handler'
import { AcceptPersonalTrainingHandler } from '../features/personal-trainings/accept-personal-training.handler'
import { CancelPersonalTrainingHandler } from '../features/personal-trainings/cancel-personal-training.handler'
import { DeclinePersonalTrainingHandler } from '../features/personal-trainings/decline-personal-training.handler'
import { GetPersonalTrainingHandler } from '../features/personal-trainings/get-personal-training.handler'
import { GetPersonalTrainingFormHandler } from '../features/personal-trainings/get-personal-training-form.handler'
import { ListPersonalTrainingsHandler } from '../features/personal-trainings/list-personal-trainings.handler'
import { ProposePersonalTrainingTimeHandler } from '../features/personal-trainings/propose-personal-training-time.handler'
import { RequestPersonalTrainingHandler } from '../features/personal-trainings/request-personal-training.handler'
import { SetPersonalTrainingOfferHandler } from '../features/personal-trainings/set-personal-training-offer.handler'
import { PersonalTrainingsController } from '../features/personal-trainings/personal-trainings.controller'
import { FileContentReportController } from '../features/file-content-report/file-content-report.controller'
import { FileContentReportHandler } from '../features/file-content-report/file-content-report.handler'
import { GetMeController } from '../features/get-me/get-me.controller'
import { GetMeHandler } from '../features/get-me/get-me.handler'
import { UpdateMeController } from '../features/update-me/update-me.controller'
import { UpdateMeHandler } from '../features/update-me/update-me.handler'
import { GetMyWorkspacesController } from '../features/get-my-workspaces/get-my-workspaces.controller'
import { GetMyWorkspacesHandler } from '../features/get-my-workspaces/get-my-workspaces.handler'
import { PlatformController } from '../features/platform/platform.controller'
import { CreatePlatformWorkspaceHandler } from '../features/platform/create-platform-workspace.handler'
import { GetPlatformOverviewHandler } from '../features/platform/get-platform-overview.handler'
import { ListPlatformWorkspacesHandler } from '../features/platform/list-platform-workspaces.handler'
import { UpdatePlatformWorkspaceHandler } from '../features/platform/update-platform-workspace.handler'
import { ListPlatformAuditHandler } from '../features/platform/list-platform-audit.handler'
import { AddGroupMemberController } from '../features/add-group-member/add-group-member.controller'
import { AddGroupMemberHandler } from '../features/add-group-member/add-group-member.handler'
import { CreateGroupController } from '../features/create-group/create-group.controller'
import { CreateGroupHandler } from '../features/create-group/create-group.handler'
import { CreateGymController } from '../features/create-gym/create-gym.controller'
import { CreateGymHandler } from '../features/create-gym/create-gym.handler'
import { DeleteGroupController } from '../features/delete-group/delete-group.controller'
import { DeleteGroupHandler } from '../features/delete-group/delete-group.handler'
import { DeleteGymController } from '../features/delete-gym/delete-gym.controller'
import { DeleteGymHandler } from '../features/delete-gym/delete-gym.handler'
import { UpdateGymController } from '../features/update-gym/update-gym.controller'
import { UpdateGymHandler } from '../features/update-gym/update-gym.handler'
import { GetMemberProgressController } from '../features/get-member-progress/get-member-progress.controller'
import { GetMemberProgressHandler } from '../features/get-member-progress/get-member-progress.handler'
import { GetMyGroupsController } from '../features/get-my-groups/get-my-groups.controller'
import { GetMyGroupsHandler } from '../features/get-my-groups/get-my-groups.handler'
import { GetWorkspaceSettingsController } from '../features/get-workspace-settings/get-workspace-settings.controller'
import { GetWorkspaceSettingsHandler } from '../features/get-workspace-settings/get-workspace-settings.handler'
import { UpdateWorkspaceSettingsController } from '../features/update-workspace-settings/update-workspace-settings.controller'
import { UpdateWorkspaceSettingsHandler } from '../features/update-workspace-settings/update-workspace-settings.handler'
import { ListGroupsController } from '../features/list-groups/list-groups.controller'
import { ListGroupsHandler } from '../features/list-groups/list-groups.handler'
import { ListGymsController } from '../features/list-gyms/list-gyms.controller'
import { ListGymsHandler } from '../features/list-gyms/list-gyms.handler'
import { ListRolesController } from '../features/list-roles/list-roles.controller'
import { ListRolesHandler } from '../features/list-roles/list-roles.handler'
import { RemoveGroupMemberController } from '../features/remove-group-member/remove-group-member.controller'
import { RemoveGroupMemberHandler } from '../features/remove-group-member/remove-group-member.handler'
import { SyncGroupMembersController } from '../features/sync-group-members/sync-group-members.controller'
import { SyncGroupMembersHandler } from '../features/sync-group-members/sync-group-members.handler'
import { UpdateGroupController } from '../features/update-group/update-group.controller'
import { UpdateGroupHandler } from '../features/update-group/update-group.handler'
import { UpdateMemberProfileController } from '../features/update-member-profile/update-member-profile.controller'
import { UpdateMemberProfileHandler } from '../features/update-member-profile/update-member-profile.handler'
import { UpdateMemberRoleController } from '../features/update-member-role/update-member-role.controller'
import { UpdateMemberRoleHandler } from '../features/update-member-role/update-member-role.handler'
import { GetWorkspaceStatsController } from '../features/get-workspace-stats/get-workspace-stats.controller'
import { GetWorkspaceStatsHandler } from '../features/get-workspace-stats/get-workspace-stats.handler'
import { ClassPackNotifierService } from '../domains/subscriptions/services/class-pack-notifier.service'
import { SubscriptionFreezeService } from '../domains/subscriptions/services/subscription-freeze.service'
import { SubscriptionService } from '../domains/subscriptions/services/subscription.service'
import { PlansController } from '../features/manage-plans/plans.controller'
import { CreatePlanHandler } from '../features/manage-plans/create-plan.handler'
import { ListPlansHandler } from '../features/manage-plans/list-plans.handler'
import { ListRenewalCandidatesController } from '../features/list-renewal-candidates/list-renewal-candidates.controller'
import { ListRenewalCandidatesHandler } from '../features/list-renewal-candidates/list-renewal-candidates.handler'
import { AwaitingPaymentController } from '../features/list-awaiting-payment/list-awaiting-payment.controller'
import { ListAwaitingPaymentHandler } from '../features/list-awaiting-payment/list-awaiting-payment.handler'
import { ExportController } from '../features/data-export/export.controller'
import { ExportService } from '../features/data-export/export.service'
import { UpdatePlanHandler } from '../features/manage-plans/update-plan.handler'
import { DeletePlanHandler } from '../features/manage-plans/delete-plan.handler'
import { MemberSubscriptionsController } from '../features/member-subscriptions/member-subscriptions.controller'
import { AssignSubscriptionHandler } from '../features/member-subscriptions/assign-subscription.handler'
import { ListMemberSubscriptionsHandler } from '../features/member-subscriptions/list-member-subscriptions.handler'
import { CancelSubscriptionHandler } from '../features/member-subscriptions/cancel-subscription.handler'
import { EndSubscriptionFreezeHandler } from '../features/member-subscriptions/end-subscription-freeze.handler'
import { FreezeSubscriptionHandler } from '../features/member-subscriptions/freeze-subscription.handler'
import { MarkSubscriptionPaidHandler } from '../features/member-subscriptions/mark-subscription-paid.handler'
import { UnmarkSubscriptionPaidHandler } from '../features/member-subscriptions/unmark-subscription-paid.handler'
import { GetMySubscriptionController } from '../features/get-my-subscription/get-my-subscription.controller'
import { GetMySubscriptionHandler } from '../features/get-my-subscription/get-my-subscription.handler'
import { GetMyRanksController } from '../features/get-my-ranks/get-my-ranks.controller'
import { GetMyRanksHandler } from '../features/get-my-ranks/get-my-ranks.handler'
import { GetMyAchievementsController } from '../features/get-my-achievements/get-my-achievements.controller'
import { GetMyAchievementsHandler } from '../features/get-my-achievements/get-my-achievements.handler'
import { GetMemberAchievementsController } from '../features/get-my-achievements/get-member-achievements.controller'
import { GetMemberAchievementsHandler } from '../features/get-my-achievements/get-member-achievements.handler'
import { AchievementsController } from '../features/manage-achievements/achievements.controller'
import { ListAchievementsHandler } from '../features/manage-achievements/list-achievements.handler'
import { CreateAchievementHandler } from '../features/manage-achievements/create-achievement.handler'
import { UpdateAchievementHandler } from '../features/manage-achievements/update-achievement.handler'
import { DeleteAchievementHandler } from '../features/manage-achievements/delete-achievement.handler'
import { SeedDefaultAchievementsHandler } from '../features/manage-achievements/seed-default-achievements.handler'
import { ReorderAchievementsHandler } from '../features/manage-achievements/reorder-achievements.handler'
import { AchievementNotifierService } from '../features/get-my-achievements/achievement-notifier.service'
import { TrainingJournalController } from '../features/training-journal/training-journal.controller'
import { ListJournalHandler } from '../features/training-journal/list-journal.handler'
import { CreateJournalEntryHandler } from '../features/training-journal/create-journal-entry.handler'
import { DeleteJournalEntryHandler } from '../features/training-journal/delete-journal-entry.handler'
import { LeaderboardController } from '../features/attendance-leaderboard/leaderboard.controller'
import { GetAttendanceLeaderboardHandler } from '../features/attendance-leaderboard/get-attendance-leaderboard.handler'
import { SetLeaderboardVisibilityHandler } from '../features/attendance-leaderboard/set-leaderboard-visibility.handler'
import { RankService } from '../domains/ranks/services/rank.service'
import { NotificationProducerModule } from '../domains/notifications/notification-producer.module'
import { RealtimeModule } from '../domains/realtime/realtime.module'
import { RealtimeGateway } from '../domains/realtime/realtime.gateway'
import { RanksController } from '../features/manage-ranks/ranks.controller'
import { CreateLadderHandler } from '../features/manage-ranks/create-ladder.handler'
import { ListLaddersHandler } from '../features/manage-ranks/list-ladders.handler'
import { UpdateLadderHandler } from '../features/manage-ranks/update-ladder.handler'
import { DeleteLadderHandler } from '../features/manage-ranks/delete-ladder.handler'
import { CreateLevelHandler } from '../features/manage-ranks/create-level.handler'
import { UpdateLevelHandler } from '../features/manage-ranks/update-level.handler'
import { DeleteLevelHandler } from '../features/manage-ranks/delete-level.handler'
import { MemberRanksController } from '../features/member-ranks/member-ranks.controller'
import { PromoteMemberHandler } from '../features/member-ranks/promote-member.handler'
import { GetMemberRanksHandler } from '../features/member-ranks/get-member-ranks.handler'
import { LadderRosterController } from '../features/member-ranks/ladder-roster.controller'
import { GetLadderRosterHandler } from '../features/member-ranks/get-ladder-roster.handler'
import { PromoteMembersHandler } from '../features/member-ranks/promote-members.handler'
import { AnnouncementsController } from '../features/manage-announcements/announcements.controller'
import { CreateAnnouncementHandler } from '../features/manage-announcements/create-announcement.handler'
import { ListAnnouncementsHandler } from '../features/manage-announcements/list-announcements.handler'
import { UpdateAnnouncementHandler } from '../features/manage-announcements/update-announcement.handler'
import { DeleteAnnouncementHandler } from '../features/manage-announcements/delete-announcement.handler'
import { GetAnnouncementFeedHandler } from '../features/manage-announcements/get-feed.handler'
import { HealthController } from '../features/health/health.controller'
import { ListAuditEventsController } from '../features/list-audit-events/list-audit-events.controller'
import { ListAuditEventsHandler } from '../features/list-audit-events/list-audit-events.handler'
import { AddWorkspaceMemberController } from '../features/add-workspace-member/add-workspace-member.controller'
import { AddWorkspaceMemberHandler } from '../features/add-workspace-member/add-workspace-member.handler'
import { ImportMembersController } from '../features/import-members/import-members.controller'
import { ImportMembersHandler } from '../features/import-members/import-members.handler'
import { AttachVideosToPlaylistController } from '../features/attach-videos-to-playlist/attach-videos-to-playlist.controller'
import { AttachVideosToPlaylistHandler } from '../features/attach-videos-to-playlist/attach-videos-to-playlist.handler'
import { DetachVideoFromPlaylistController } from '../features/detach-video-from-playlist/detach-video-from-playlist.controller'
import { DetachVideoFromPlaylistHandler } from '../features/detach-video-from-playlist/detach-video-from-playlist.handler'
import { MovePlaylistVideoController } from '../features/move-playlist-video/move-playlist-video.controller'
import { MovePlaylistVideoHandler } from '../features/move-playlist-video/move-playlist-video.handler'
import { UpdatePlaylistVideoController } from '../features/update-playlist-video/update-playlist-video.controller'
import { UpdatePlaylistVideoHandler } from '../features/update-playlist-video/update-playlist-video.handler'
import { CreatePlaylistChapterController } from '../features/create-playlist-chapter/create-playlist-chapter.controller'
import { CreatePlaylistChapterHandler } from '../features/create-playlist-chapter/create-playlist-chapter.handler'
import { UpdatePlaylistChapterController } from '../features/update-playlist-chapter/update-playlist-chapter.controller'
import { UpdatePlaylistChapterHandler } from '../features/update-playlist-chapter/update-playlist-chapter.handler'
import { MovePlaylistChapterController } from '../features/move-playlist-chapter/move-playlist-chapter.controller'
import { MovePlaylistChapterHandler } from '../features/move-playlist-chapter/move-playlist-chapter.handler'
import { DeletePlaylistChapterController } from '../features/delete-playlist-chapter/delete-playlist-chapter.controller'
import { DeletePlaylistChapterHandler } from '../features/delete-playlist-chapter/delete-playlist-chapter.handler'
import { ListWorkspaceMembersController } from '../features/list-workspace-members/list-workspace-members.controller'
import { ListWorkspaceMembersHandler } from '../features/list-workspace-members/list-workspace-members.handler'
import { ListPendingUsersController } from '../features/list-pending-users/list-pending-users.controller'
import { ListPendingUsersHandler } from '../features/list-pending-users/list-pending-users.handler'
import { GetMyWorkspaceMembershipController } from '../features/get-my-workspace-membership/get-my-workspace-membership.controller'
import { GetMyWorkspaceMembershipHandler } from '../features/get-my-workspace-membership/get-my-workspace-membership.handler'
import { FirebaseDevicesController } from '../features/register-firebase-device/firebase-devices.controller'
import { RegisterFirebaseDeviceHandler } from '../features/register-firebase-device/register-firebase-device.handler'
import { UnregisterFirebaseDeviceHandler } from '../features/register-firebase-device/unregister-firebase-device.handler'
import { NotificationsInboxController } from '../features/notifications-inbox/notifications-inbox.controller'
import { GetMyNotificationsHandler } from '../features/notifications-inbox/get-my-notifications.handler'
import { MarkNotificationsSeenHandler } from '../features/notifications-inbox/mark-notifications-seen.handler'
import { NotificationPreferencesController } from '../features/notification-preferences/notification-preferences.controller'
import { GetNotificationPreferencesHandler } from '../features/notification-preferences/get-notification-preferences.handler'
import { UpdateNotificationPreferencesHandler } from '../features/notification-preferences/update-notification-preferences.handler'
import { DeleteAccountController } from '../features/delete-account/delete-account.controller'
import { DeleteAccountHandler } from '../features/delete-account/delete-account.handler'
import { SaveVideoProgressController } from '../features/save-video-progress/save-video-progress.controller'
import { SaveVideoProgressHandler } from '../features/save-video-progress/save-video-progress.handler'
import { SetVideoFavoriteController } from '../features/set-video-favorite/set-video-favorite.controller'
import { SetVideoFavoriteHandler } from '../features/set-video-favorite/set-video-favorite.handler'
import { ListMyFavoritesController } from '../features/list-my-favorites/list-my-favorites.controller'
import { ListMyFavoritesHandler } from '../features/list-my-favorites/list-my-favorites.handler'
import { GroupScheduleController } from '../features/manage-group-schedule/group-schedule.controller'
import { CreateGroupSlotHandler } from '../features/manage-group-schedule/create-group-slot.handler'
import { UpdateGroupSlotHandler } from '../features/manage-group-schedule/update-group-slot.handler'
import { DeleteGroupSlotHandler } from '../features/manage-group-schedule/delete-group-slot.handler'
import { CreateGroupExceptionHandler } from '../features/manage-group-schedule/create-group-exception.handler'
import { UpdateGroupExceptionHandler } from '../features/manage-group-schedule/update-group-exception.handler'
import { DeleteGroupExceptionHandler } from '../features/manage-group-schedule/delete-group-exception.handler'
import { WorkspaceEventsController } from '../features/manage-workspace-events/workspace-events.controller'
import { CreateWorkspaceEventHandler } from '../features/manage-workspace-events/create-workspace-event.handler'
import { UpdateWorkspaceEventHandler } from '../features/manage-workspace-events/update-workspace-event.handler'
import { DeleteWorkspaceEventHandler } from '../features/manage-workspace-events/delete-workspace-event.handler'
import { ListWorkspaceEventsHandler } from '../features/manage-workspace-events/list-workspace-events.handler'
import { AttendanceController } from '../features/attendance/attendance.controller'
import { SelfCheckInController } from '../features/self-check-in/self-check-in.controller'
import { SelfCheckInHandler } from '../features/self-check-in/self-check-in.handler'
import { CreateAttendanceSessionHandler } from '../features/attendance/create-session.handler'
import { MarkRecordsHandler } from '../features/attendance/mark-records.handler'
import { UnmarkRecordHandler } from '../features/attendance/unmark-record.handler'
import { GetSessionRosterHandler } from '../features/attendance/get-roster.handler'
import { ListSessionsHandler } from '../features/attendance/list-sessions.handler'
import { DeleteSessionHandler } from '../features/attendance/delete-session.handler'
import { UpdateSessionHandler } from '../features/attendance/update-session.handler'
import { GetMyAttendanceHandler } from '../features/attendance/get-my-attendance.handler'
import { GetMemberAttendanceController } from '../features/attendance/get-member-attendance.controller'
import { GetMemberAttendanceHandler } from '../features/attendance/get-member-attendance.handler'
import { GetAttendanceOverviewHandler } from '../features/attendance/get-overview.handler'
import { GetWorkspaceScheduleController } from '../features/get-workspace-schedule/get-workspace-schedule.controller'
import { GetWorkspaceScheduleHandler } from '../features/get-workspace-schedule/get-workspace-schedule.handler'
import { GroupCoachesController } from '../features/manage-group-coaches/group-coaches.controller'
import { AddGroupCoachHandler } from '../features/manage-group-coaches/add-group-coach.handler'
import { RemoveGroupCoachHandler } from '../features/manage-group-coaches/remove-group-coach.handler'
import { VideoTimestampsController } from '../features/manage-video-timestamps/video-timestamps.controller'
import { CreateVideoTimestampHandler } from '../features/manage-video-timestamps/create-video-timestamp.handler'
import { UpdateVideoTimestampHandler } from '../features/manage-video-timestamps/update-video-timestamp.handler'
import { DeleteVideoTimestampHandler } from '../features/manage-video-timestamps/delete-video-timestamp.handler'
import { VideoSubtitlesController } from '../features/manage-video-subtitles/video-subtitles.controller'
import { CreateVideoSubtitleUploadHandler } from '../features/manage-video-subtitles/create-video-subtitle-upload.handler'
import { CreateVideoSubtitleHandler } from '../features/manage-video-subtitles/create-video-subtitle.handler'
import { DeleteVideoSubtitleHandler } from '../features/manage-video-subtitles/delete-video-subtitle.handler'
import { RejectPendingMemberController } from '../features/reject-pending-member/reject-pending-member.controller'
import { RejectPendingMemberHandler } from '../features/reject-pending-member/reject-pending-member.handler'
import { RemoveWorkspaceMemberController } from '../features/remove-workspace-member/remove-workspace-member.controller'
import { RemoveWorkspaceMemberHandler } from '../features/remove-workspace-member/remove-workspace-member.handler'
import { UpdateWorkspaceMemberAccessController } from '../features/update-workspace-member-access/update-workspace-member-access.controller'
import { UpdateWorkspaceMemberAccessHandler } from '../features/update-workspace-member-access/update-workspace-member-access.handler'
import { UpdateMemberNotesController } from '../features/update-member-notes/update-member-notes.controller'
import { UpdateMemberNotesHandler } from '../features/update-member-notes/update-member-notes.handler'
import { GetPlaylistController } from '../features/get-playlist/get-playlist.controller'
import { GetPlaylistHandler } from '../features/get-playlist/get-playlist.handler'
import { ListPlaylistsController } from '../features/get-playlists/list-playlists.controller'
import { ListPlaylistsHandler } from '../features/get-playlists/list-playlists.handler'
import { RefreshTokenController } from '../features/refresh-token/refresh-token.controller'
import { RefreshTokenHandler } from '../features/refresh-token/refresh-token.handler'
import { SignOutController } from '../features/sign-out/sign-out.controller'
import { SignOutHandler } from '../features/sign-out/sign-out.handler'
import { ResendCodeController } from '../features/resend-code/resend-code.controller'
import { ResendCodeHandler } from '../features/resend-code/resend-code.handler'
import { SendAuthCodeController } from '../features/send-auth-code/send-auth-code.controller'
import { SendAuthCodeHandler } from '../features/send-auth-code/send-auth-code.handler'
import { SendEmailNotificationListener } from '../features/send-email-notification/send-email-notification.listener'
import { MailHealthService } from '../domains/notifications/services/mail-health.service'
import { ClubThrottlerGuard } from '../shared/guards/club-throttler.guard'
import { SendNotificationHandler } from '../features/send-notification/send-notification.handler'
import { SendNotificationListener } from '../features/send-notification/send-notification.listener'
import { SignInController } from '../features/sign-in/sign-in.controller'
import { SignInHandler } from '../features/sign-in/sign-in.handler'
import { UpdatePlaylistController } from '../features/update-playlist/update-playlist.controller'
import { UpdatePlaylistHandler } from '../features/update-playlist/update-playlist.handler'
import { CompleteVideoUploadController } from '../features/complete-video-upload/complete-video-upload.controller'
import { CompleteVideoUploadHandler } from '../features/complete-video-upload/complete-video-upload.handler'
import { CreateVideoUploadController } from '../features/create-video-upload/create-video-upload.controller'
import { CreateVideoUploadHandler } from '../features/create-video-upload/create-video-upload.handler'
import { CreateVideoThumbnailUploadController } from '../features/create-video-thumbnail-upload/create-video-thumbnail-upload.controller'
import { CreateVideoThumbnailUploadHandler } from '../features/create-video-thumbnail-upload/create-video-thumbnail-upload.handler'
import { CreateCategoryController } from '../features/create-category/create-category.controller'
import { CreateCategoryHandler } from '../features/create-category/create-category.handler'
import { CreateTagController } from '../features/create-tag/create-tag.controller'
import { CreateTagHandler } from '../features/create-tag/create-tag.handler'
import { DeleteVideoController } from '../features/delete-video/delete-video.controller'
import { DeleteVideoHandler } from '../features/delete-video/delete-video.handler'
import { DeleteCategoryController } from '../features/delete-category/delete-category.controller'
import { DeleteCategoryHandler } from '../features/delete-category/delete-category.handler'
import { DeleteTagController } from '../features/delete-tag/delete-tag.controller'
import { DeleteTagHandler } from '../features/delete-tag/delete-tag.handler'
import { GetVideoManifestController } from '../features/get-video-manifest/get-video-manifest.controller'
import { GetVideoPlaybackController } from '../features/get-video-playback/get-video-playback.controller'
import { GetVideoPlaybackHandler } from '../features/get-video-playback/get-video-playback.handler'
import { GetOfflineManifestController } from '../features/get-offline-manifest/get-offline-manifest.controller'
import { GetOfflineManifestHandler } from '../features/get-offline-manifest/get-offline-manifest.handler'
import { GetOfflineDownloadController } from '../features/get-offline-download/get-offline-download.controller'
import { GetOfflineDownloadHandler } from '../features/get-offline-download/get-offline-download.handler'
import { GetVideoController } from '../features/get-video/get-video.controller'
import { GetVideoHandler } from '../features/get-video/get-video.handler'
import { GetWorkspaceVideoController } from '../features/get-video/get-workspace-video.controller'
import { ListCategoriesController } from '../features/list-categories/list-categories.controller'
import { ListCategoriesHandler } from '../features/list-categories/list-categories.handler'
import { ListTagsController } from '../features/list-tags/list-tags.controller'
import { ListTagsHandler } from '../features/list-tags/list-tags.handler'
import { ListVideosController } from '../features/list-videos/list-videos.controller'
import { ListVideosHandler } from '../features/list-videos/list-videos.handler'
import { UpdateCategoryController } from '../features/update-category/update-category.controller'
import { UpdateCategoryHandler } from '../features/update-category/update-category.handler'
import { UpdateTagController } from '../features/update-tag/update-tag.controller'
import { UpdateTagHandler } from '../features/update-tag/update-tag.handler'
import { UpdateVideoController } from '../features/update-video/update-video.controller'
import { UpdateVideoHandler } from '../features/update-video/update-video.handler'
import { BulkUpdateVideosController } from '../features/bulk-update-videos/bulk-update-videos.controller'
import { BulkUpdateVideosHandler } from '../features/bulk-update-videos/bulk-update-videos.handler'
import { FilesModule } from '../infrastructure/files/files.module'
import { PrismaModule } from '../infrastructure/prisma'
import { GeocodingService } from '../shared/services/geocoding.service'
import { RbacService } from '../shared/services/rbac.service'
import { QueueModule } from '../infrastructure/queue/queue.module'
import { LoggingInterceptor } from '../shared/interceptors/logging.interceptor'
const coreModules: ModuleMetadata['imports'] = [
    FeaturesModule.forRoot({}),
    EventEmitterModule.forRoot(),
    PrismaModule.forRoot({
        url: environment.databaseUrl,
    }),
    FilesModule.forRoot({
        ...environment.s3Storage,
    }),
    QueueModule.forRoot({
        host: environment.redis.host,
        port: environment.redis.port,
        password: environment.redis.password,
        db: environment.redis.db,
    }),
    JwtModule.register({ global: true }),
    MailerModule.forRoot({
        defaults: {
            from: environment.notifications.defaults.from,
        },
        transport: environment.notifications.transport,
    }),
    EmailTemplatesModule.forRoot({}),
    NotificationsModule.forRoot({
        eventsProvider: createEventEmitterPublisher(),
    }),
    ThrottlerModule.forRoot(
        environment.production
            ? [
                  // Per person once signed in, per IP before (ClubThrottlerGuard).
                  // The IP bucket still has to fit a whole gym on one Wi-Fi —
                  // twenty phones refreshing tokens at the start of class.
                  { name: 'short', ttl: 1_000, limit: 20 },
                  { name: 'default', ttl: 60_000, limit: 600 },
              ]
            : [
                  // Dev: React StrictMode + Turbopack HMR fan out a lot
                  // of concurrent requests on every page mount, which
                  // trips a 5/sec limit constantly. Keep a generous
                  // ceiling here so it still catches runaway loops.
                  { name: 'short', ttl: 1_000, limit: 200 },
                  { name: 'default', ttl: 60_000, limit: 5_000 },
              ],
    ),
    BullModule.registerQueue({ name: 'video-transcode' }),
    SchedulerModule,
]

const controllers: ModuleMetadata['controllers'] = [
    SignInController,
    SendAuthCodeController,
    ResendCodeController,
    RefreshTokenController,
    SignOutController,
    GetMyWorkspacesController,
    PlatformController,
    CreateVideoUploadController,
    CreateVideoThumbnailUploadController,
    CreateTagController,
    CreateCategoryController,
    CompleteVideoUploadController,
    GetVideoController,
    GetWorkspaceVideoController,
    GetVideoPlaybackController,
    GetOfflineManifestController,
    GetOfflineDownloadController,
    GetVideoManifestController,
    ListVideosController,
    DeleteVideoController,
    UpdateVideoController,
    BulkUpdateVideosController,
    ListTagsController,
    ListCategoriesController,
    UpdateTagController,
    UpdateCategoryController,
    DeleteTagController,
    DeleteCategoryController,
    CreatePlaylistController,
    CreatePlaylistThumbnailUploadController,
    ListPlaylistsController,
    GetPlaylistController,
    UpdatePlaylistController,
    DeletePlaylistController,
    AttachVideosToPlaylistController,
    DetachVideoFromPlaylistController,
    MovePlaylistVideoController,
    UpdatePlaylistVideoController,
    CreatePlaylistChapterController,
    UpdatePlaylistChapterController,
    MovePlaylistChapterController,
    DeletePlaylistChapterController,
    AddWorkspaceMemberController,
    ImportMembersController,
    ListWorkspaceMembersController,
    ListPendingUsersController,
    GetMyWorkspaceMembershipController,
    GetMemberProgressController,
    GetMemberAttendanceController,
    GetMyGroupsController,
    ListGymsController,
    CreateGymController,
    UpdateGymController,
    DeleteGymController,
    ListGroupsController,
    CreateGroupController,
    UpdateGroupController,
    DeleteGroupController,
    AddGroupMemberController,
    RemoveGroupMemberController,
    SyncGroupMembersController,
    ListRolesController,
    UpdateMemberRoleController,
    UpdateMemberProfileController,
    GetWorkspaceSettingsController,
    UpdateWorkspaceSettingsController,
    RemoveWorkspaceMemberController,
    RejectPendingMemberController,
    UpdateWorkspaceMemberAccessController,
    UpdateMemberNotesController,
    FirebaseDevicesController,
    NotificationsInboxController,
    NotificationPreferencesController,
    DeleteAccountController,
    SaveVideoProgressController,
    SetVideoFavoriteController,
    ListMyFavoritesController,
    VideoTimestampsController,
    VideoSubtitlesController,
    GroupScheduleController,
    WorkspaceEventsController,
    AttendanceController,
    SelfCheckInController,
    DropInsController,
    PersonalTrainingsController,
    GetWorkspaceScheduleController,
    GroupCoachesController,
    HealthController,
    ListAuditEventsController,
    GetWorkspaceStatsController,
    PlansController,
    ListRenewalCandidatesController,
    AwaitingPaymentController,
    ExportController,
    MemberSubscriptionsController,
    GetMySubscriptionController,
    GetMyRanksController,
    GetMyAchievementsController,
    GetMemberAchievementsController,
    TrainingJournalController,
    AchievementsController,
    LeaderboardController,
    RanksController,
    MemberRanksController,
    LadderRosterController,
    AnnouncementsController,
    GetMeController,
    UpdateMeController,
    FileContentReportController,
]

const handlers: ModuleMetadata['providers'] = [
    SignInHandler,
    SendAuthCodeHandler,
    ResendCodeHandler,
    SendNotificationHandler,
    RefreshTokenHandler,
    SignOutHandler,
    GetMyWorkspacesHandler,
    ListPlatformWorkspacesHandler,
    CreatePlatformWorkspaceHandler,
    GetPlatformOverviewHandler,
    UpdatePlatformWorkspaceHandler,
    ListPlatformAuditHandler,
    CreateVideoUploadHandler,
    CreateVideoThumbnailUploadHandler,
    CreateTagHandler,
    CreateCategoryHandler,
    CompleteVideoUploadHandler,
    GetVideoHandler,
    GetVideoPlaybackHandler,
    GetOfflineManifestHandler,
    GetOfflineDownloadHandler,
    ListVideosHandler,
    DeleteVideoHandler,
    UpdateVideoHandler,
    BulkUpdateVideosHandler,
    ListTagsHandler,
    ListCategoriesHandler,
    UpdateTagHandler,
    UpdateCategoryHandler,
    DeleteTagHandler,
    DeleteCategoryHandler,
    CreatePlaylistHandler,
    CreatePlaylistThumbnailUploadHandler,
    UpdatePlaylistHandler,
    DeletePlaylistHandler,
    AttachVideosToPlaylistHandler,
    DetachVideoFromPlaylistHandler,
    MovePlaylistVideoHandler,
    UpdatePlaylistVideoHandler,
    CreatePlaylistChapterHandler,
    UpdatePlaylistChapterHandler,
    MovePlaylistChapterHandler,
    DeletePlaylistChapterHandler,
    ListPlaylistsHandler,
    GetPlaylistHandler,
    AddWorkspaceMemberHandler,
    ImportMembersHandler,
    ListWorkspaceMembersHandler,
    ListPendingUsersHandler,
    GetMyWorkspaceMembershipHandler,
    GetMemberProgressHandler,
    GetMyGroupsHandler,
    ListGymsHandler,
    CreateGymHandler,
    UpdateGymHandler,
    DeleteGymHandler,
    ListGroupsHandler,
    CreateGroupHandler,
    UpdateGroupHandler,
    DeleteGroupHandler,
    AddGroupMemberHandler,
    RemoveGroupMemberHandler,
    SyncGroupMembersHandler,
    ListRolesHandler,
    UpdateMemberRoleHandler,
    UpdateMemberProfileHandler,
    GetWorkspaceSettingsHandler,
    UpdateWorkspaceSettingsHandler,
    RegisterFirebaseDeviceHandler,
    UnregisterFirebaseDeviceHandler,
    GetMyNotificationsHandler,
    MarkNotificationsSeenHandler,
    GetNotificationPreferencesHandler,
    UpdateNotificationPreferencesHandler,
    DeleteAccountHandler,
    SaveVideoProgressHandler,
    SetVideoFavoriteHandler,
    ListMyFavoritesHandler,
    CreateVideoTimestampHandler,
    UpdateVideoTimestampHandler,
    DeleteVideoTimestampHandler,
    CreateVideoSubtitleUploadHandler,
    CreateVideoSubtitleHandler,
    DeleteVideoSubtitleHandler,
    CreateGroupSlotHandler,
    UpdateGroupSlotHandler,
    DeleteGroupSlotHandler,
    CreateGroupExceptionHandler,
    UpdateGroupExceptionHandler,
    DeleteGroupExceptionHandler,
    CreateWorkspaceEventHandler,
    UpdateWorkspaceEventHandler,
    DeleteWorkspaceEventHandler,
    ListWorkspaceEventsHandler,
    CreateAttendanceSessionHandler,
    MarkRecordsHandler,
    SelfCheckInHandler,
    CreateDropInHandler,
    CancelDropInHandler,
    GetMyDropInsHandler,
    AcceptPersonalTrainingHandler,
    CancelPersonalTrainingHandler,
    DeclinePersonalTrainingHandler,
    GetPersonalTrainingHandler,
    GetPersonalTrainingFormHandler,
    ListPersonalTrainingsHandler,
    ProposePersonalTrainingTimeHandler,
    RequestPersonalTrainingHandler,
    SetPersonalTrainingOfferHandler,
    GetAttendanceSessionHandler,
    UnmarkRecordHandler,
    GetSessionRosterHandler,
    ListSessionsHandler,
    DeleteSessionHandler,
    GetMyAttendanceHandler,
    GetMemberAttendanceHandler,
    UpdateSessionHandler,
    GetAttendanceOverviewHandler,
    GetWorkspaceScheduleHandler,
    AddGroupCoachHandler,
    RemoveGroupCoachHandler,
    RemoveWorkspaceMemberHandler,
    RejectPendingMemberHandler,
    UpdateWorkspaceMemberAccessHandler,
    UpdateMemberNotesHandler,
    ListAuditEventsHandler,
    GetWorkspaceStatsHandler,
    CreatePlanHandler,
    ListPlansHandler,
    ListRenewalCandidatesHandler,
    UpdatePlanHandler,
    DeletePlanHandler,
    AssignSubscriptionHandler,
    ListMemberSubscriptionsHandler,
    CancelSubscriptionHandler,
    FreezeSubscriptionHandler,
    MarkSubscriptionPaidHandler,
    UnmarkSubscriptionPaidHandler,
    ListAwaitingPaymentHandler,
    EndSubscriptionFreezeHandler,
    GetMySubscriptionHandler,
    GetMyRanksHandler,
    GetMyAchievementsHandler,
    GetMemberAchievementsHandler,
    ListJournalHandler,
    CreateJournalEntryHandler,
    DeleteJournalEntryHandler,
    ListAchievementsHandler,
    CreateAchievementHandler,
    UpdateAchievementHandler,
    DeleteAchievementHandler,
    SeedDefaultAchievementsHandler,
    ReorderAchievementsHandler,
    AchievementNotifierService,
    ClassPackNotifierService,
    GetAttendanceLeaderboardHandler,
    SetLeaderboardVisibilityHandler,
    CreateLadderHandler,
    ListLaddersHandler,
    UpdateLadderHandler,
    DeleteLadderHandler,
    CreateLevelHandler,
    UpdateLevelHandler,
    DeleteLevelHandler,
    PromoteMemberHandler,
    GetMemberRanksHandler,
    GetLadderRosterHandler,
    PromoteMembersHandler,
    CreateAnnouncementHandler,
    ListAnnouncementsHandler,
    UpdateAnnouncementHandler,
    DeleteAnnouncementHandler,
    GetAnnouncementFeedHandler,
    GetMeHandler,
    UpdateMeHandler,
    FileContentReportHandler,
    VideoReadyProcessor,
]



const domainModules: ModuleMetadata['imports'] = [
    TokensModule.forRoot({
        jwt: {
            secret: environment.jwt.secret,
            issuerUrl: environment.jwt.issuerUrl,
            audienceUrl: environment.jwt.audienceUrl,
            accessTokenTTL: environment.jwt.accessTokenTTL,
            refreshTokenTTL: environment.jwt.refreshTokenTTL,
        },
    }),
    RolesModule.forRoot({}),
    UsersModule.forRoot({
        eventsProvider: createEventEmitterPublisher(),
        completeCodeTimeout: environment.completeCodeTimeout
    }),
    TfaModule.forRoot({
        eventsProvider: {
            useFactory: (): TfaEventsPublisher => ({
                send: async () => undefined,
            }),
        },
        encryptionKey: environment.encryptionKey,
    }),
    WorkspaceModule.forRoot({
        eventsProvider: createEventEmitterPublisher(),
        encryptionKey: environment.encryptionKey,
    }),
    VideoModule,
    PlaylistModule,
    AuditModule,
    // Shared singletons (the gateway wires the emitter; feature handlers +
    // VideoService emit through the producer).
    RealtimeModule,
    NotificationProducerModule,
]

const listeners: ModuleMetadata['providers'] = [
    createEventEmitterListener({
        injectionToken: USERS_LISTENER,
    }),
    createEventEmitterListener({
        injectionToken: NOTIFICATIONS_LISTENER,
    }),
    SendNotificationListener,
    SendEmailNotificationListener
]

// Validation errors reach the (Russian-speaking) admin UI verbatim, so zod's
// built-in messages must be Russian. Set once, before any schema parses.
z.config(z.locales.ru())

@Module({
  imports: [...coreModules, ...domainModules],
  controllers: [...controllers],
  providers: [
      {
          provide: APP_PIPE,
          useClass: ZodValidationPipe,
      },
      {
          provide: APP_INTERCEPTOR,
          useClass: ZodSerializerInterceptor,
      },
      {
          provide: APP_INTERCEPTOR,
          useClass: LoggingInterceptor,
      },
      {
          provide: APP_GUARD,
          useClass: ClubThrottlerGuard,
      },
      {
          provide: APP_FILTER,
          useClass: DefaultErrorFilter,
      },
      RbacService,
      ExportService,
      SubscriptionService,
      SubscriptionFreezeService,
      RankService,
      MailHealthService,
      GeocodingService,
      BootstrapSeedService,
      RealtimeGateway,
      ...handlers,
      ...listeners,
  ],
})
export class AppModule {}
