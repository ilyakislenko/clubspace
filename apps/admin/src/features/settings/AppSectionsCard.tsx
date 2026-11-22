"use client"

import { ChevronDown } from "lucide-react"
import { useState } from "react"

import type {
  WorkspaceSettings,
  WorkspaceSettingsPatch,
} from "../../shared/api/workspaces"
import { useVocabulary } from "../../shared/lib/vocabulary"
import { formatDay } from "../billing/billing-view"
import { appSections, type AppSectionFeature } from "./app-sections"
import { SettingRow, SettingSwitch } from "./SettingSwitch"

type AppSectionKey = `${AppSectionFeature}Enabled`

// The app-section switches of «Приложение учеников». Optional modules are
// listed; the core sections (abonement, schedule, attendance) sit in a
// collapsed «Дополнительно» group that opens by itself while one is off.
export function AppSectionsCard({
  settings,
  saving,
  onSave,
}: {
  settings: WorkspaceSettings
  saving: boolean
  onSave: (patch: WorkspaceSettingsPatch) => void
}) {
  const vocabulary = useVocabulary()
  const sections = appSections(vocabulary)
  const [moreOpen, setMoreOpen] = useState(false)

  const rows = (core: boolean) =>
    sections
      .filter((s) => Boolean(s.core) === core)
      .map((section) => {
        const key: AppSectionKey = `${section.feature}Enabled`
        const on = settings[key]
        // Without the VIDEO module the section can only be switched off.
        const locked = section.feature === "videos" && !settings.videoModuleEntitled
        // Pinned from the platform console: the club cannot change it.
        const pinned = settings.lockedFeatures.find((l) => l.feature === section.feature)
        return (
          <SettingRow
            key={key}
            title={section.label}
            description={section.description}
            note={
              pinned ? (
                <p className="mt-1 text-xs text-sky-700">
                  Установлено платформой
                  {pinned.until ? ` до ${formatDay(pinned.until)}` : ""}
                </p>
              ) : (
                locked && (
                  <p className="mt-1 text-xs text-amber-700">
                    Нужен модуль «Видео» — раздел «Подписка ClubSpace»
                  </p>
                )
              )
            }
          >
            <SettingSwitch
              checked={on}
              disabled={saving || Boolean(pinned) || (locked && !on)}
              label={`Показывать раздел «${section.label}» в приложении${
                pinned ? " — установлено платформой" : ""
              }`}
              onChange={(next) => {
                const patch: WorkspaceSettingsPatch = {}
                patch[key] = next
                // Switching a core section back on must not fold the group
                // away under the cursor.
                if (core) setMoreOpen(true)
                onSave(patch)
              }}
            />
          </SettingRow>
        )
      })

  const coreOff = sections.some((s) => {
    const key: AppSectionKey = `${s.feature}Enabled`
    return s.core && !settings[key]
  })

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="font-medium">Разделы приложения</div>
      <p className="mt-1 text-xs text-muted-foreground">
        Скрывайте разделы, которые пока усложняют приложение. Выключенный раздел
        пропадает из мобильного приложения у всех участников (изменения
        применяются при следующем запуске приложения).
      </p>
      <ul className="mt-4 divide-y divide-border">{rows(false)}</ul>

      <div className="mt-4 border-t border-border pt-4">
        <button
          type="button"
          aria-expanded={moreOpen || coreOff}
          disabled={coreOff}
          onClick={() => setMoreOpen((open) => !open)}
          className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground disabled:cursor-default disabled:hover:text-muted-foreground"
        >
          Дополнительно
          {!coreOff && (
            <ChevronDown
              aria-hidden
              className={`size-4 transition-transform ${moreOpen ? "rotate-180" : ""}`}
            />
          )}
        </button>
        {(moreOpen || coreOff) && (
          <>
            <p className="mt-2 text-xs text-muted-foreground">
              Основные разделы — без них клуб работает иначе. Без абонемента запись и
              гостевые визиты не требуют абонемента, а из запуска клуба пропадают
              тарифы и оплата; без расписания нет гостевых визитов.
            </p>
            <ul className="mt-3 divide-y divide-border">{rows(true)}</ul>
          </>
        )}
      </div>
    </div>
  )
}
