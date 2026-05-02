import Link from "next/link"

export const metadata = {
  title: "Условия использования",
}

export default function TermsOfServicePage() {
  return (
    <article className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <Link
        href="/courses"
        className="text-xs text-muted-foreground hover:underline"
      >
        ← Назад
      </Link>
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">Условия использования</h1>
        <p className="text-sm text-muted-foreground">
          Это страница-заглушка. Замените её содержимое на согласованный
          с юристом текст до публичного запуска.
        </p>
      </header>

      <section className="space-y-3 text-sm leading-6">
        <h2 className="text-lg font-semibold">Использование сервиса</h2>
        <p>
          Доступ к контенту предоставляется только участникам клуба, добавленным
          администратором. Не передавайте свой email и коды входа третьим лицам.
          Не записывайте, не копируйте и не распространяйте видео без разрешения.
        </p>

        <h2 className="text-lg font-semibold">Ответственность</h2>
        <p>
          Сервис предоставляется «как есть», без гарантий бесперебойной работы.
          Мы стараемся, чтобы всё работало, но платформа в активной разработке.
        </p>

        <h2 className="text-lg font-semibold">Прекращение доступа</h2>
        <p>
          Администратор клуба может удалить вас из клуба в любой момент.
          В таком случае ваш доступ к видео прекращается.
        </p>

        <h2 className="text-lg font-semibold">Связаться</h2>
        <p>
          По вопросам использования сервиса: <a href="mailto:hello@example.com">hello@example.com</a>.
        </p>
      </section>

      <footer className="border-t border-border pt-4 text-xs text-muted-foreground">
        Последнее обновление: {new Date().toLocaleDateString("ru-RU")}
      </footer>
    </article>
  )
}
