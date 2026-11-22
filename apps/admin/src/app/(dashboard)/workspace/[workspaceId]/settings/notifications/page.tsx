"use client"

import { AnalyticsDigestToggle } from "../../../../../../features/notifications/AnalyticsDigestToggle"
import { SettingsSectionHeader } from "../../../../../../features/settings/SettingsNav"

// «Настройки → Уведомления»: what the club's admins get from ClubSpace.
export default function SettingsNotificationsPage() {
  return (
    <>
      <SettingsSectionHeader title="Уведомления" />
      <div className="rounded-xl border border-border bg-card p-5">
        <AnalyticsDigestToggle />
      </div>
    </>
  )
}
