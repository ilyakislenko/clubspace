"use client"

import { useParams } from "next/navigation"

import { AnalyticsDigestToggle } from "../../../../../../features/notifications/AnalyticsDigestToggle"
import { BirthdayGreetingsToggle } from "../../../../../../features/notifications/BirthdayGreetingsToggle"
import { MessagesEmailToggle } from "../../../../../../features/notifications/MessagesEmailToggle"
import { SettingsLoadState } from "../../../../../../features/settings/SettingsLoadState"
import { SettingsSectionHeader } from "../../../../../../features/settings/SettingsNav"
import { useWorkspaceSettings } from "../../../../../../features/settings/use-workspace-settings"

// «Настройки → Уведомления»: what the club's admins get from ClubSpace, and
// what the club sends its members.
export default function SettingsNotificationsPage() {
  const params = useParams<{ workspaceId: string }>()
  const { settings, loading, loadFailed, saving, error, stale, save, reload } =
    useWorkspaceSettings(params?.workspaceId)

  return (
    <>
      <SettingsSectionHeader title="Уведомления" />
      <div className="rounded-xl border border-border bg-card p-5">
        <AnalyticsDigestToggle />
      </div>
      <div className="space-y-3 rounded-xl border border-border bg-card p-5">
        <div className="font-medium">Ученикам</div>
        <SettingsLoadState
          loading={loading}
          loadFailed={loadFailed}
          error={error}
          stale={stale}
          onRetry={reload}
        />
        {settings && (
          <>
            <BirthdayGreetingsToggle
              settings={settings}
              saving={saving}
              onSave={(patch) => void save(patch)}
            />
            <MessagesEmailToggle
              settings={settings}
              saving={saving}
              onSave={(patch) => void save(patch)}
            />
          </>
        )}
      </div>
    </>
  )
}
