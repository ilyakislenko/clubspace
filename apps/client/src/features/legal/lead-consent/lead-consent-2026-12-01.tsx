import Link from "next/link"

import { telHref } from "../../public-club/club-format"
import type { LeadConsentProps } from "./props"

// NOTE FOR LAUNCH: draft, not reviewed by a lawyer (docs/legal/README.md,
// «Заявки на пробное»). What it states follows docs/design/2026-11-26-leads.md
// §5 and what the server actually does: the 90/180-day terms are the server's
// LEAD_CLOSED_RETENTION_DAYS / LEAD_IDLE_DAYS (apps/server/src/domains/leads/
// lead-rules.ts) and specs/legal-lead-consent.spec.tsx fails when they drift.
// A published edition is never edited — a change is a new file in
// ./registry.ts plus the server's LEAD_CONSENT_VERSION bump, in one deploy.
export function LeadConsent20261201({
  operatorName,
  operatorAddress,
  clubName,
  contacts,
}: LeadConsentProps) {
  return (
    <section className="space-y-3 text-sm leading-6">
      <p>
        Отмечая согласие в форме заявки на пробное занятие в клубе «{clubName}»,
        я свободно, своей волей и в своём интересе даю согласие на обработку
        моих персональных данных на условиях ниже, в соответствии с
        Федеральным законом от 27.07.2006 № 152-ФЗ «О персональных данных»
        (далее — «Закон»).
      </p>

      <h2 className="text-lg font-semibold">1. Оператор</h2>
      <p>
        Оператор персональных данных — {operatorName}, адрес: {operatorAddress}{" "}
        (далее — «Клуб»).
      </p>
      <p>
        По поручению Клуба (ч. 3 ст. 6 Закона) данные обрабатывает ClubSpace —
        сервис, в котором Клуб ведёт свою работу, на условиях{" "}
        <Link href="/legal/dpa" className="underline">
          поручения на обработку персональных данных
        </Link>
        . ClubSpace обрабатывает данные только для Клуба и не использует их в
        своих целях.
      </p>

      <h2 className="text-lg font-semibold">2. Цель</h2>
      <p>
        Связаться со мной по заявке и записать меня (или ребёнка, за которого
        я подаю заявку) на пробное занятие в Клубе.
      </p>

      <h2 className="text-lg font-semibold">3. Какие данные</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>имя, номер телефона, адрес электронной почты, если я его указал(а);</li>
        <li>
          если заявка подана за ребёнка, — имя и возраст ребёнка;
        </li>
        <li>выбранное направление и мой комментарий к заявке;</li>
        <li>
          дата и время согласия, редакция этого текста, IP-адрес и сведения о
          браузере, с которого отправлена заявка.
        </li>
      </ul>

      <h2 className="text-lg font-semibold">4. Что с ними делают</h2>
      <p>
        Сбор, запись, систематизация, накопление, хранение, уточнение
        (обновление, изменение), извлечение, использование, предоставление
        доступа сотрудникам Клуба, которые работают с заявками, обезличивание,
        блокирование, удаление и уничтожение. Обработка ведётся с
        использованием средств автоматизации.
      </p>

      <h2 className="text-lg font-semibold">5. Срок</h2>
      <p>
        Согласие действует до достижения цели обработки или до его отзыва.
        Данные хранятся, пока Клуб работает с заявкой, но не дольше:
      </p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          90 календарных дней после того, как я отказался(ась) от занятий или
          стал(а) учеником Клуба;
        </li>
        <li>
          180 календарных дней, если по заявке не было никакого движения.
        </li>
      </ul>
      <p>
        По истечении срока имя, телефон, адрес электронной почты и комментарии
        удаляются автоматически; в отчётах Клуба остаётся только обезличенная
        запись о заявке.
      </p>

      <h2 className="text-lg font-semibold">6. Как отозвать согласие</h2>
      <p>
        Отозвать согласие или потребовать удалить мои данные я могу в любой
        момент, сообщив об этом Клубу (ч. 2 ст. 9 Закона)
        {contacts.length > 0 ? ":" : ` по адресу: ${operatorAddress}.`}
      </p>
      {contacts.length > 0 && (
        <ul className="list-disc space-y-1 pl-5">
          {contacts.map((c, i) => (
            <li key={`${c.phone}-${i}`}>
              {c.label}:{" "}
              <a href={telHref(c.phone)} className="underline">
                {c.phone}
              </a>
            </li>
          ))}
          <li>письмом по адресу: {operatorAddress}.</li>
        </ul>
      )}
      <p>
        Клуб прекращает обработку и удаляет данные в течение 10 рабочих дней с
        получения такого обращения (ст. 21 Закона).
      </p>

      <h2 className="text-lg font-semibold">7. Если заявка подана за ребёнка</h2>
      <p>
        Подавая заявку за ребёнка, я подтверждаю, что являюсь его законным
        представителем (родителем, усыновителем или опекуном), и даю согласие
        на обработку указанных в заявке данных ребёнка на тех же условиях.
      </p>
    </section>
  )
}
