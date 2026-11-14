"use client"

import { useParams } from "next/navigation"

import { AchievementsSettings } from "../../../../../../features/achievements/AchievementsSettings"
import { AppSectionsCard } from "../../../../../../features/settings/AppSectionsCard"
import { SettingsSectionHeader } from "../../../../../../features/settings/SettingsNav"
import { SettingsLoadState } from "../../../../../../features/settings/SettingsLoadState"
import { useWorkspaceSettings } from "../../../../../../features/settings/use-workspace-settings"

// «Настройки → Приложение учеников»: which sections the members' app shows,
// and the achievements it awards while that section is on.
export default function SettingsAppPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId
  const { settings, loading, loadFailed, saving, error, save, reload } =
    useWorkspaceSettings(workspaceId)

  return (
    <>
      <SettingsSectionHeader
        title="Приложение учеников"
        description="Что ученики видят в мобильном приложении клуба."
      />
      <SettingsLoadState
        loading={loading}
        loadFailed={loadFailed}
        error={error}
        onRetry={reload}
      />
      {settings && (
        <AppSectionsCard
          settings={settings}
          saving={saving}
          onSave={(patch) => void save(patch)}
        />
      )}
      {workspaceId && settings?.achievementsEnabled && (
        <AchievementsSettings workspaceId={workspaceId} />
      )}
    </>
  )
}
