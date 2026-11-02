# Заметки для проверки (App Review, Play «App access», RuStore)

Перед подачей на боевом сервере заданы `STORE_REVIEW_EMAIL`,
`STORE_REVIEW_CODE` (6 случайных цифр), `STORE_REVIEW_WORKSPACE_KEY` (ключ
демо-клуба) — `docs/store-distribution.md`, раздел 5. Аккаунт создаётся при
первом входе и заново после «Удалить аккаунт», письма на адрес не уходят.
Демо-клуб с расписанием на ближайшие недели, курсом с видео, объявлениями и
поясами (`SEED_DEMO_WORKSPACE`, `npm run demo:videos`). Онлайн-оплату в
демо-клубе **не** подключать — блок «Оплатить онлайн» тогда скрыт.

## App Store Connect → App Review Information

- Sign-in required: **Yes**. User name: `review@<домен>`, Password: `<STORE_REVIEW_CODE>`.
- Contact: имя, телефон и e-mail владельца.
- Notes (EN):

```
ClubSpace is the member app of sports clubs and studios (martial arts, dance, fitness). Members join their club by a link, QR code or club code; the club manages schedule, memberships and videos in its web admin.

Sign-in has no password: enter the e-mail review@<domain>, tap «Получить код» (Get code), then enter the code <STORE_REVIEW_CODE>. No e-mail is sent to this address. The account is already a member of the demo club «ACADEMY» with schedule, a membership, belts and a video course.

What to check:
• Главная (Home): next class, membership, club announcements.
• Расписание (Schedule): tap a class to book it or join the waitlist.
• Видео (Video): course «БЖЖ: база белого пояса», lessons 6 and 7 play; «Скачать» saves a lesson for offline viewing.
• Прогресс (Progress): attendance, belts, achievements, training journal.
• Account deletion: Профиль → Настройки → «Удалить аккаунт». The same code signs in again afterwards (a new empty account is added to the demo club).

Payments: the app sells no digital content. Clubs may let members renew a club membership (in-person classes at the gym, App Review Guideline 3.1.3(e)) on the club's payment provider page in the browser; this is off in the demo club. Video courses are club teaching materials included with the membership, not sold separately in the app.

The camera is used only to scan a club's QR code on the «join a club» screen («Сканировать QR»). Notifications are optional.
```

## Google Play → App content → App access

«All or some functionality is restricted» → **Add instructions**:

- Name: `Review account`
- Username: `review@<домен>`, Password: `<STORE_REVIEW_CODE>`
- Any other instructions: `One-time password login: enter the e-mail, tap «Получить код», enter the code above (fixed for this account, no e-mail is sent). The account is in the demo club ACADEMY.`

## RuStore → комментарий модератору

```
Вход по коду: e-mail review@<домен>, нажмите «Получить код», введите <STORE_REVIEW_CODE> (код постоянный, письмо не приходит). Аккаунт состоит в демо-клубе «ACADEMY»: расписание, абонемент, пояса, видеокурс «БЖЖ: база белого пояса». Удаление аккаунта: Профиль → Настройки → «Удалить аккаунт». Оплаты внутри приложения нет; онлайн-оплата абонемента клуба (ЮKassa/Stripe клуба, страница в браузере) задекларирована и в демо-клубе выключена.
```
