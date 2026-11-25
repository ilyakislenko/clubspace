"use client"

import type {
  WorkspaceSettings,
  WorkspaceSettingsPatch,
} from "../../shared/api/workspaces"
import { SettingRow, SettingSwitch } from "../settings/SettingSwitch"

const TITLE = "Сообщения ученикам на e-mail"

// Lets «Ученики → Сообщения» also send a copy by e-mail (the sender ticks it
// per message). Off by default; push and «Сообщения клуба» in the app work
// without it.
export function MessagesEmailToggle({
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
        description="В сообщении появится галочка «Также отправить на e-mail». Ученик может отписаться от писем клуба по ссылке в письме. На пробном периоде письма расходуют его лимит, как и приглашения."
      >
        <SettingSwitch
          checked={settings.messagesEmailEnabled}
          disabled={saving}
          label={TITLE}
          onChange={(next) => onSave({ messagesEmailEnabled: next })}
        />
      </SettingRow>
    </ul>
  )
}
