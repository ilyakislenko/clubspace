"use client"

import {
  Bell,
  Building2,
  Globe,
  Palette,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react"

type RoadmapItem = {
  icon: LucideIcon
  title: string
  description: string
  status: "soon" | "planned"
}

const ROADMAP: RoadmapItem[] = [
  {
    icon: Building2,
    title: "Профиль клуба",
    description:
      "Название, логотип, обложка, контакты. Сейчас задаётся при создании воркспейса.",
    status: "soon",
  },
  {
    icon: Palette,
    title: "Брендирование",
    description:
      "Палитра, шрифты и обложка приложения для своего клуба. Под мульти-клуб сценарий.",
    status: "planned",
  },
  {
    icon: ShieldCheck,
    title: "Безопасность",
    description:
      "Двухфакторная авторизация владельца, политика паролей, лог входов.",
    status: "planned",
  },
  {
    icon: Bell,
    title: "Уведомления",
    description:
      "Email-шаблоны, расписание напоминаний, push-каналы для мобильного приложения.",
    status: "planned",
  },
  {
    icon: Globe,
    title: "Языки",
    description:
      "Локализация интерфейса и контента. Сейчас ru/en встроены, остальное по запросу.",
    status: "planned",
  },
]

const STATUS_LABEL: Record<RoadmapItem["status"], string> = {
  soon: "Скоро",
  planned: "В планах",
}

const STATUS_CLASS: Record<RoadmapItem["status"], string> = {
  soon: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  planned: "bg-zinc-100 text-zinc-700 ring-zinc-600/20",
}

export default function WorkspaceSettingsPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Настройки</h1>
        <p className="text-sm text-muted-foreground">
          Настройки воркспейса.
        </p>
      </div>

      <div className="rounded-xl border border-dashed border-border bg-card/40 p-6">
        <p className="text-sm">
          Раздел готовится. Ниже — список того, что появится в ближайших
          релизах. Если что-то нужно срочно — напишите в поддержку.
        </p>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2">
        {ROADMAP.map((item) => {
          const Icon = item.icon
          return (
            <li
              key={item.title}
              className="flex gap-3 rounded-lg border border-border bg-card p-4"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Icon className="size-4" />
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-medium">{item.title}</h2>
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${STATUS_CLASS[item.status]}`}
                  >
                    {STATUS_LABEL[item.status]}
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {item.description}
                </p>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
