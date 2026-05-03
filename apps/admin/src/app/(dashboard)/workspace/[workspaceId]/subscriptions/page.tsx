"use client"

import { CreditCard, Receipt, Tag, Users } from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"

import { Button } from "@bjj-academy/ui-kit/ui"

export default function WorkspaceSubscriptionsPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Подписки</h1>
        <p className="text-sm text-muted-foreground">
          Платные подписки участников. Раздел готовится.
        </p>
      </div>

      <div className="rounded-xl border border-dashed border-border bg-card/40 p-6">
        <h2 className="text-sm font-semibold">
          Сейчас доступ выдаётся вручную
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Откройте раздел{" "}
          <Link
            href={`/workspace/${workspaceId}/users`}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            «Участники»
          </Link>{" "}
          — для каждого ученика можно выставить дату «Доступ до». До неё
          ученик видит весь контент, после — попадает на экран «Доступ
          закончился».
        </p>
        {workspaceId && (
          <Button className="mt-4" asChild>
            <Link href={`/workspace/${workspaceId}/users`}>
              Открыть участников
            </Link>
          </Button>
        )}
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold">Что появится дальше</h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {[
            {
              icon: Tag,
              title: "Тарифные планы",
              text: "Несколько тарифов с разной длительностью и доступом к разным курсам.",
            },
            {
              icon: CreditCard,
              title: "Онлайн-оплата",
              text: "Подключение эквайринга (ЮKassa/Stripe), автопродление, рекуррентные платежи.",
            },
            {
              icon: Receipt,
              title: "История счетов",
              text: "Чеки, возвраты, экспорт для бухгалтерии, ретроспектива по каждому участнику.",
            },
            {
              icon: Users,
              title: "Групповые подписки",
              text: "Семьи, школьные группы, корпоративные пакеты — несколько учеников на одной оплате.",
            },
          ].map(({ icon: Icon, title, text }) => (
            <li
              key={title}
              className="flex gap-3 rounded-lg border border-border bg-card p-4"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Icon className="size-4" />
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-medium">{title}</h3>
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-700 ring-1 ring-inset ring-zinc-600/20">
                    В планах
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {text}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
