"use client"

import type {
  WorkspaceSettings,
  WorkspaceSettingsPatch,
} from "../../shared/api/workspaces"
import { SettingRow, SettingSwitch } from "../settings/SettingSwitch"

const TITLE = "Поздравлять с днём рождения"

// The club's greeting on a member's birthday (the daily pass, 10:00 club
// time; a child's goes to the parents). A club setting, saved at once like
// the other settings switches.
export function BirthdayGreetingsToggle({
  settings,
  saving,
  onSave,
}: {
  settings: WorkspaceSettings
  saving: boolean
  onSave: (patch: WorkspaceSettingsPatch) => void
}) {
  return (
    <ul>
      <SettingRow
        title={TITLE}
        description="В 10:00 по времени клуба, ребёнку — через родителей. Дату рождения ученик указывает в приложении, сотрудник — в карточке ученика."
      >
        <SettingSwitch
          checked={settings.birthdayGreetingsEnabled}
          disabled={saving}
          label={TITLE}
          onChange={(next) => onSave({ birthdayGreetingsEnabled: next })}
        />
      </SettingRow>
    </ul>
  )
}
