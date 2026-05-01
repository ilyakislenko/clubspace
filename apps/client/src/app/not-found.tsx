import Link from "next/link"

export default function NotFound() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold">Страница не найдена</h1>
      <p className="text-sm text-muted-foreground">
        Возможно, ссылка устарела или была удалена.
      </p>
      <Link
        href="/courses"
        className="text-sm text-primary underline-offset-4 hover:underline"
      >
        Вернуться к курсам
      </Link>
    </div>
  )
}
