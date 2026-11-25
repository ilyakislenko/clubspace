import Link from "next/link"

// The API answers 404 for an unknown slug and for a club whose trial form is
// off or has no data operator named — the visitor can't tell them apart.
export default function TrialNotFound() {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold">Клуб не принимает заявки</h1>
      <p className="text-sm leading-6 text-muted-foreground">
        Сейчас записаться на пробное через сайт нельзя. Позвоните в клуб или
        напишите тренеру.
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
