"use client"

import { useEffect, useState } from "react"

import {
  getNotificationPreferences,
  updateNotificationPreferences,
} from "../../shared/api/notification-preferences"
import { errorMessage } from "../../shared/lib/error-message"
import { SettingRow, SettingSwitch } from "../settings/SettingSwitch"

// The Monday «Аналитика за неделю» push + e-mail (it has money: club admins
// only, see analytics-digest.service). A personal preference, so it follows
// the user across every club they run.
export function AnalyticsDigestToggle() {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void getNotificationPreferences()
      .then((p) => setEnabled(p.analyticsDigestEnabled))
      .catch((err) =>
        setError(errorMessage(err, "Не удалось загрузить настройку сводки.")),
      )
  }, [])

  const toggle = async (next: boolean) => {
    setSaving(true)
    setError(null)
    setEnabled(next)
    try {
      const p = await updateNotificationPreferences({
        analyticsDigestEnabled: next,
      })
      setEnabled(p.analyticsDigestEnabled)
    } catch (err) {
      setEnabled(!next)
      setError(errorMessage(err, "Не удалось сохранить настройку."))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ul>
      <SettingRow
        title="Еженедельная сводка на почту и в push"
        description="По понедельникам в 9:00: три факта и три действия по клубу. Настройка ваша личная — действует во всех клубах, которыми вы управляете."
        note={error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      >
        <SettingSwitch
          checked={enabled ?? false}
          disabled={enabled === null || saving}
          label="Еженедельная сводка на почту и в push"
          onChange={(next) => void toggle(next)}
        />
      </SettingRow>
    </ul>
  )
}
