import Link from "next/link"

import {
  LEGAL_ADDRESS,
  LEGAL_OPERATOR,
  SUPPORT_EMAIL,
} from "../../../shared/lib/legal"

export const metadata = {
  title: "Удаление аккаунта",
}

// Fixed date — update whenever the page changes (not dynamic on purpose).
const EFFECTIVE_DATE = "24 октября 2026 г."

export default function DeleteAccountPage() {
  return (
    <article className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <Link
        href="/courses"
        className="text-xs text-muted-foreground hover:underline"
      >
        ← Назад
      </Link>

      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">Удаление аккаунта</h1>
        <p className="text-sm text-muted-foreground">
          Действует с {EFFECTIVE_DATE}
        </p>
        <p className="text-sm leading-6">
          Здесь описано, как удалить аккаунт в приложении ClubSpace (мобильное
          приложение и веб-версия) и что при этом происходит с вашими данными.
          Оператор — {LEGAL_OPERATOR}
          {LEGAL_ADDRESS ? `, ${LEGAL_ADDRESS}` : ""}.
        </p>
      </header>

      <section className="space-y-3 text-sm leading-6">
        <h2 className="text-lg font-semibold">1. Удалить аккаунт самостоятельно</h2>
        <p>В мобильном приложении ClubSpace:</p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            Откройте раздел <b>Настройки</b>.
          </li>
          <li>
            Нажмите <b>Удалить аккаунт</b>.
          </li>
          <li>
            Подтвердите действие в окне «Удалить аккаунт?», нажав{" "}
            <b>Удалить</b>.
          </li>
        </ol>
        <p>
          В веб-версии (<b>Профиль → Удалить аккаунт</b>) всё работает так же.
          Удаление выполняется сразу, отменить его нельзя.
        </p>

        <h2 className="text-lg font-semibold">2. Удалить аккаунт через почту</h2>
        <p>
          Если у вас нет доступа к приложению, напишите на{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> с адреса,
          который указан в вашем аккаунте, и попросите удалить аккаунт ClubSpace.
          Мы удалим его вручную — тем же способом, что и при удалении в
          приложении.
        </p>

        <h2 className="text-lg font-semibold">3. Владельцам и тренерам</h2>
        <p>
          Если вы владелец клуба или тренер хотя бы одной группы, удалить
          аккаунт сразу не получится: приложение сообщит, что аккаунт управляет
          клубом. Владельцу сначала нужно передать клуб другому человеку —
          напишите об этом на{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>, передача
          выполняется через поддержку. Тренеру нужно попросить администратора
          клуба сменить вам роль в группе. После этого аккаунт можно удалить.
        </p>

        <h2 className="text-lg font-semibold">4. Что будет удалено</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            профиль: email (заменяется на обезличенный), имя, телефон, дата
            рождения, описание и фото, данные для входа;
          </li>
          <li>членства в клубах и группах, подписки и доступы;</li>
          <li>push-токены устройств и настройки уведомлений;</li>
          <li>уведомления, избранное и история просмотра видео;</li>
          <li>сессии (вы будете разлогинены на всех устройствах);</li>
          <li>записи вашего дневника тренировок.</li>
        </ul>

        <h2 className="text-lg font-semibold">
          5. Что сохраняется в обезличенном виде
        </h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            отметки посещаемости тренировок — без имени и email, чтобы учёт
            клуба остался корректным;
          </li>
          <li>
            история повышений рангов — без привязки к вам лично;
          </li>
          <li>
            записи журнала действий в клубе — без вашего имени и email.
          </li>
        </ul>
        <p>
          Эти обезличенные записи хранятся, пока существует клуб. По ним вас нельзя идентифицировать, и войти в удалённый
          аккаунт больше нельзя. Позже вы можете зарегистрироваться заново с тем
          же email — это будет новый, пустой аккаунт.
        </p>

        <h2 className="text-lg font-semibold">6. Сроки</h2>
        <p>
          Удаление происходит сразу после подтверждения. Запрос по почте мы
          выполняем в течение 30 дней. Резервные копии базы данных хранятся до
          14 дней (срок по умолчанию, оператор может изменить его) и затем
          удаляются, поэтому в них ваши данные могут оставаться до истечения
          этого срока.
        </p>

        <p>
          Подробнее о данных — в{" "}
          <Link href="/legal/privacy" className="underline">
            Политике конфиденциальности
          </Link>
          .
        </p>
      </section>

      <footer className="border-t border-border pt-4 text-xs text-muted-foreground">
        Последнее обновление: {EFFECTIVE_DATE}
      </footer>
    </article>
  )
}
