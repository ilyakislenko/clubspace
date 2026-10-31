import Link from "next/link"

// An unknown, mistyped or replaced code. The club may have changed its code,
// so the useful next step is asking the club, or finding it in the catalog.
export default function JoinCodeNotFound() {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold">Приглашение не найдено</h1>
      <p className="text-sm leading-6 text-muted-foreground">
        Код клуба неверный или клуб его сменил. Проверьте ссылку или попросите
        у тренера актуальный код — его можно ввести в приложении ClubSpace на
        экране «Ввести код клуба».
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
