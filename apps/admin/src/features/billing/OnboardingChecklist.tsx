"use client"

import { CheckCircle2, Circle } from "lucide-react"
import Link from "next/link"
import { useEffect, useState } from "react"

import {
  getWorkspaceOnboarding,
  type WorkspaceOnboarding,
} from "../../shared/api/billing"

type StepKey = WorkspaceOnboarding["steps"][number]["key"]

const STEPS: Record<StepKey, { label: string; hint: string; path: string }> = {
  gym: {
    label: "Добавьте зал",
    hint: "Адрес, где проходят тренировки",
    path: "gyms",
  },
  group: {
    label: "Создайте группу",
    hint: "Например, «Взрослые, начинающие»",
    path: "groups",
  },
  schedule: {
    label: "Заполните расписание",
    hint: "Дни и время тренировок группы",
    path: "groups",
  },
  members: {
    label: "Пригласите участников",
    hint: "По почте или распечатайте QR-код клуба",
    path: "users",
  },
  video: {
    label: "Загрузите первое видео",
    hint: "Разбор техники или приветствие",
    path: "content",
  },
}

// The launch checklist on the dashboard. Every tick comes from the server's
// view of real data, so it updates itself; it disappears once all is done.
export function OnboardingChecklist({ workspaceId }: { workspaceId: string }) {
  const [data, setData] = useState<WorkspaceOnboarding | null>(null)

  useEffect(() => {
    let alive = true
    getWorkspaceOnboarding({ workspaceId })
      .then((d) => alive && setData(d))
      .catch(() => {
        // Optional block: the dashboard works without it.
      })
    return () => {
      alive = false
    }
  }, [workspaceId])

  if (!data || data.doneCount === data.total) return null

  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium">Запуск клуба</h2>
        <span className="text-xs text-muted-foreground">
          {data.doneCount} из {data.total}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${Math.round((data.doneCount / data.total) * 100)}%` }}
        />
      </div>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {data.steps.map((step) => {
          const meta = STEPS[step.key]
          return (
            <li key={step.key}>
              <Link
                href={`/workspace/${workspaceId}/${meta.path}`}
                className="flex items-start gap-2 rounded-md border p-3 text-sm hover:bg-muted"
              >
                {step.done ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                ) : (
                  <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                )}
                <span>
                  <span className={step.done ? "text-muted-foreground line-through" : "font-medium"}>
                    {meta.label}
                  </span>
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
