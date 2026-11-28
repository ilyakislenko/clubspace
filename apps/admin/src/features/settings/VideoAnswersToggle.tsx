"use client"

import type {
  WorkspaceSettings,
  WorkspaceSettingsPatch,
} from "../../shared/api/workspaces"
import { SettingRow, SettingSwitch } from "./SettingSwitch"

const TITLE = "ИИ-ответы по видео клуба"

// «Спросить ИИ по видео клуба» in the members' app (Видео → Поиск). Off by
// default; shown only while it can work — the platform has an AI model and
// the club's videos are on.
export function VideoAnswersToggle({
  settings,
  saving,
  onSave,
}: {
  settings: WorkspaceSettings
  saving: boolean
  onSave: (patch: WorkspaceSettingsPatch) => void
}) {
  if (!settings.aiConfigured || !settings.videosEnabled) return null
  return (
    <div className="mt-4 rounded-xl border border-border bg-card p-5">
      <ul>
        <SettingRow
          title={TITLE}
          description="Ученики и тренеры смогут спросить ИИ своими словами и получить ответ со ссылками на моменты видео клуба; ИИ-сервису (третьему лицу, обычно за пределами России) уходят только вопрос и отрывки расшифровок видео — без имён и контактов."
        >
          <SettingSwitch
            checked={settings.videoAnswersEnabled}
            disabled={saving}
            label={TITLE}
            onChange={(next) => onSave({ videoAnswersEnabled: next })}
          />
        </SettingRow>
      </ul>
    </div>
  )
}
