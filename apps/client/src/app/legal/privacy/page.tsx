import Link from "next/link"

export const metadata = {
  title: "Политика конфиденциальности",
}

export default function PrivacyPolicyPage() {
  return (
    <article className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <Link
        href="/courses"
        className="text-xs text-muted-foreground hover:underline"
      >
        ← Назад
      </Link>
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">Политика конфиденциальности</h1>
        <p className="text-sm text-muted-foreground">
          Это страница-заглушка. Замените её содержимое на согласованный
          с юристом текст до публичного запуска. Для App Store и Google Play
          политика обязательна.
        </p>
      </header>

      <section className="space-y-3 text-sm leading-6">
        <h2 className="text-lg font-semibold">Какие данные мы собираем</h2>
        <p>
          Email, дату регистрации, имя (по желанию), идентификатор
          устройства и факты просмотра видео. Платёжные данные не храним.
        </p>

        <h2 className="text-lg font-semibold">Зачем</h2>
        <p>
          Чтобы аутентифицировать вас, выдавать доступ к курсам клуба и
          поддерживать работу сервиса. Email используется для отправки
          одноразовых кодов входа и важных служебных уведомлений.
        </p>

        <h2 className="text-lg font-semibold">С кем делимся</h2>
        <p>
          Данные не продаём и не передаём третьим лицам кроме инфраструктурных
          провайдеров (хостинг, email, хранилище видео), необходимых для работы
          приложения.
        </p>

        <h2 className="text-lg font-semibold">Связаться</h2>
        <p>
          По вопросам конфиденциальности: <a href="mailto:privacy@example.com">privacy@example.com</a>.
        </p>
      </section>

      <footer className="border-t border-border pt-4 text-xs text-muted-foreground">
        Последнее обновление: {new Date().toLocaleDateString("ru-RU")}
      </footer>
    </article>
  )
}
