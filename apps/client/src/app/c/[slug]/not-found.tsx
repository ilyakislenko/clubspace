import Link from "next/link"

// Unknown slug, or a club that is not (or no longer) in the catalog.
export default function ClubNotFound() {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold">Клуб не найден</h1>
      <p className="text-sm leading-6 text-muted-foreground">
        Возможно, адрес изменился или клуб больше не показывает свою страницу.
        Если у вас есть приглашение или код от тренера — откройте его.
      </p>
      <Link
        href="/clubs"
        className="text-sm text-primary underline-offset-4 hover:underline"
      >
        Найти клуб в каталоге
      </Link>
    </main>
  )
}
