"use client"

import { Circle, X } from "lucide-react"
import Link from "next/link"
import { useEffect, useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"
import type { ClubVocabulary } from "@clubspace/ui-kit/brand"

import {
  getWorkspaceOnboarding,
  type WorkspaceOnboarding,
} from "../../shared/api/billing"
import { fetchMe } from "../../shared/api/me"
import { useVocabulary } from "../../shared/lib/vocabulary"
import { checklistState } from "./onboarding-steps"

type StepKey = WorkspaceOnboarding["steps"][number]["key"]

const steps = (
  v: ClubVocabulary,
): Record<StepKey, { label: string; hint: string; path: string }> => ({
  gym: {
    label: "Добавьте зал",
    hint: `Адрес, где проходят ${v.session.nomPl}`,
    path: "groups?tab=gyms",
  },
  group: {
    label: "Создайте группу",
    hint: "Например, «Взрослые, начинающие»",
    path: "groups",
  },
  schedule: {
    label: "Заполните расписание",
    hint: `Дни и время ${v.session.genPl} группы`,
    path: "schedule",
  },
  plans: {
    label: "Создайте абонемент",
    hint: `Цена и сколько ${v.session.genPl} он даёт`,
    path: "subscriptions?new=1",
  },
  members: {
    label: "Пригласите участников",
    hint: "По почте, QR-кодом клуба или импортом из Excel",
    path: "users?invite=1",
  },
  payments: {
    label: "Подключите оплату",
    hint: "ЮKassa или Stripe — ученики платят в приложении",
    path: "settings/payments",
  },
  video: {
    label: "Загрузите первое видео",
    hint: "Приветствие, разбор техники или связки",
    path: "content",
  },
})

// «Скрыть» is remembered per club and per account in this browser.
const hiddenKey = (workspaceId: string, userId: string) =>
  `clubspace:onboarding-hidden:${workspaceId}:${userId}`

/**
 * The launch checklist on «Сегодня». Every tick comes from the server's view
 * of real data, so it updates itself. Only the steps still to do are listed;
 * the optional ones (online payment, video) say so and never hold the list
 * open — it disappears once the required steps are done, or on «Скрыть».
 */
export function OnboardingChecklist({ workspaceId }: { workspaceId: string }) {
  const vocabulary = useVocabulary()
  const [data, setData] = useState<WorkspaceOnboarding | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [hidden, setHidden] = useState(true)

  useEffect(() => {
    let alive = true
    Promise.all([getWorkspaceOnboarding({ workspaceId }), fetchMe()])
      .then(([d, me]) => {
        if (!alive) return
        setData(d)
        setUserId(me.id)
        setHidden(window.localStorage.getItem(hiddenKey(workspaceId, me.id)) === "1")
      })
      .catch(() => {
        // Optional block: the dashboard works without it.
      })
    return () => {
      alive = false
    }
  }, [workspaceId])

  if (!data || !userId || hidden) return null
  const state = checklistState(data.steps)
  if (state.complete) return null

  const hide = () => {
    window.localStorage.setItem(hiddenKey(workspaceId, userId), "1")
    setHidden(true)
  }

  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">
          Запуск клуба
          <span className="ml-1.5 font-normal text-muted-foreground">
            {state.requiredDone} из {state.requiredTotal}
          </span>
        </h2>
        <Button variant="ghost" size="sm" onClick={hide}>
          <X aria-hidden className="size-4" />
          Скрыть
        </Button>
      </div>
      <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
        {state.todo.map((step) => {
          const meta = steps(vocabulary)[step.key]
          return (
            <li key={step.key}>
              <Link
                href={`/workspace/${workspaceId}/${meta.path}`}
                className="flex items-start gap-2 rounded-md p-2 text-sm hover:bg-muted"
              >
                <Circle aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span>
                  <span className="font-medium">{meta.label}</span>
                  {step.optional && <span className="text-muted-foreground"> · по желанию</span>}
                  <span className="block text-xs text-muted-foreground">{meta.hint}</span>
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
