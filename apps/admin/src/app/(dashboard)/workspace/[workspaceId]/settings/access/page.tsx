"use client"

import { useParams } from "next/navigation"

import { cap } from "@clubspace/ui-kit/brand"

import { BookingSettings } from "../../../../../../features/settings/BookingSettings"
import { SettingsSectionHeader } from "../../../../../../features/settings/SettingsNav"
import { SettingsLoadState } from "../../../../../../features/settings/SettingsLoadState"
import {
  SettingRow,
  SettingSwitch,
} from "../../../../../../features/settings/SettingSwitch"
import { useWorkspaceSettings } from "../../../../../../features/settings/use-workspace-settings"
import { useVocabulary } from "../../../../../../shared/lib/vocabulary"

// «Настройки → Права тренеров и запись»: what coaches see and may mark, and
// the club-wide booking rules.
export default function SettingsAccessPage() {
  const vocabulary = useVocabulary()
  const params = useParams<{ workspaceId: string }>()
  const { settings, loading, loadFailed, saving, error, save, reload } =
    useWorkspaceSettings(params?.workspaceId)

  return (
    <>
      <SettingsSectionHeader title={`Права ${vocabulary.coach.genPl} и запись`} />
      <SettingsLoadState
        loading={loading}
        loadFailed={loadFailed}
        error={error}
        onRetry={reload}
      />
      {settings && (
        <>
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="font-medium">Что видят и отмечают {vocabulary.coach.nomPl}</div>
            <ul className="mt-4 divide-y divide-border">
              <SettingRow
                title={`Видимость для ${vocabulary.coach.genPl}`}
                description={`Если выключено — ${vocabulary.coach.nomPl} видят только свои группы и учеников из них. Если включено — все ${vocabulary.coach.nomPl} видят всех учеников и все группы клуба, но редактировать могут только свои.`}
              >
                <SettingSwitch
                  checked={settings.coachSeesAllGroups}
                  disabled={saving}
                  label={`${cap(vocabulary.coach.nomPl)} видят всех учеников и все группы`}
                  onChange={(next) => void save({ coachSeesAllGroups: next })}
                />
              </SettingRow>
              <SettingRow
                title="Отметки в чужих группах"
                description={`Если выключено — ${vocabulary.coach.nom} отмечает посещаемость только в своих группах и на тех ${vocabulary.session.prepPl}, где ему одобрили замену. ${cap(vocabulary.headCoach.nom)} и администраторы отмечают в любой группе всегда.`}
              >
                <SettingSwitch
                  checked={settings.coachesMarkAnyClass}
                  disabled={saving}
                  label={`${cap(vocabulary.coach.nomPl)} могут отмечать в чужих группах без замены`}
                  onChange={(next) => void save({ coachesMarkAnyClass: next })}
                />
              </SettingRow>
            </ul>
          </div>

          <BookingSettings
            settings={settings}
            saving={saving}
            onSave={(patch) => save(patch, "Не удалось сохранить настройки записи")}
          />
        </>
      )}
    </>
  )
}
