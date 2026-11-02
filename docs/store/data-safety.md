# Данные пользователя: Data safety, App Privacy, RuStore

Ответы для форм магазинов по фактическому коду приложения (ноябрь 2026).
Формы должны совпадать с [политикой конфиденциальности](../../apps/client/src/app/legal/privacy/page.tsx)
(`https://app.<домен>/legal/privacy`) — при изменении одного правьте другое.
`[ВЫВОД]` — наша интерпретация правил, не цитата.

## Что приложение делает с данными (основа для всех форм)

| Данные | Откуда | Зачем | Где хранится |
|---|---|---|---|
| E-mail | вводит пользователь при входе | вход по одноразовому коду, служебные письма | сервер ClubSpace |
| Имя и фамилия | пользователь (по желанию) или клуб | показывать тренеру и в списках клуба | сервер |
| Телефон | вносит клуб в админке (в приложении не вводится) | тренер может позвонить ученику | сервер |
| ID аккаунта | создаёт сервер | работа аккаунта | сервер |
| Профили детей: имя, фамилия, дата рождения | вводит родитель | расписание, абонемент и прогресс ребёнка | сервер |
| Посещаемость, ранги/пояса, аттестации, дневник тренировок | тренер (отметки, ранги) и пользователь (дневник, «Отметиться») | учёт клуба, прогресс | сервер |
| Абонементы и оплаты: тариф, сумма, статус, даты | клуб; онлайн-оплата — платёжный сервис клуба | доступ к занятиям, история | сервер |
| Записи на занятия, лист ожидания, заявки на заморозку и персональные тренировки | пользователь | функции записи | сервер |
| Просмотр видео: прогресс, избранное, «просмотрено» | приложение | «Продолжить», прогресс курса | сервер |
| Заметки и закладки к видео, загруженные видео | пользователь | личные пометки, офлайн | **только устройство** |
| Push-токен (Expo → FCM/APNs) и часовой пояс устройства | приложение, после разрешения | уведомления | сервер |
| Согласие на обработку ПДн: версия, дата, IP, user-agent | сервер при принятии | доказательство согласия (152-ФЗ) | сервер |
| Жалобы на контент | пользователь | модерация | сервер |

Чего **нет**: рекламы и рекламных SDK, аналитики/трекинга (Firebase Analytics,
AppMetrica и т. п.), геолокации, контактов, микрофона, выбора фото, данных
карты (карту вводят на странице платёжного сервиса в браузере), входа через
соцсети, чата между пользователями. Камера — только для сканирования QR клуба,
кадры не сохраняются и не отправляются.

Кто получает данные (все — по поручению, как обработчики):

| Получатель | Что | Основание |
|---|---|---|
| Хостинг (VPS), S3-хранилище, SMTP-провайдер | всё хранимое / видео / письма | обработчики ClubSpace |
| Expo Push Service → Google FCM / Apple APNs | push-токен, текст уведомления | обработчики |
| Sentry (если задан `SENTRY_DSN` сервера) | технические данные ошибок сервера, PII вычищается (`sendDefaultPii: false`, `sentry-scrub.ts`) | обработчик |
| ЮKassa / Stripe **клуба** | сумма, тариф, e-mail для чека 54-ФЗ | действие пользователя («Оплатить онлайн») |
| Клуб (его тренеры и администраторы) | данные участника этого клуба | пользователь сам вступил в клуб; клуб — оператор ПДн, ClubSpace — обработчик по [поручению](../legal/README.md) |

ИИ-чат админки (OpenRouter) в приложении **не используется**: он есть только в
веб-админке у сотрудников клуба, получает псевдонимы `m_…` вместо имён и в
формы приложения не входит. Если чат появится в приложении — это
передача данных стороннему ИИ (App Store 5.1.2(i)): нужно явное согласие и
обновление всех форм.

## Google Play — Data safety

Play Console → **Policy and programs → App content → Data safety**.

**Сбор и безопасность**

| Вопрос | Ответ |
|---|---|
| Does your app collect or share any of the required user data types? | **Yes** |
| Is all of the user data collected by your app encrypted in transit? | **Yes** — только HTTPS (боевой API за Caddy с TLS) |
| Which account creation methods does your app support? | **Username and other authentication** (одноразовый код на e-mail). **OAuth** — нет |
| Delete account URL | `https://app.<домен>/legal/delete-account` |
| Do you provide a way for users to request that some or all of their data is deleted, without deleting their account? | **No** (отдельные записи — дневник, профиль ребёнка — удаляются в приложении, но отдельной процедуры запроса нет) `[ВЫВОД]` |

**Типы данных** — во всех строках: *Shared* — **No**, *Processed ephemerally* —
**No**.

| Категория → тип | Collected | Обязательно? | Цели |
|---|---|---|---|
| Personal info → **Name** | Yes | Optional | App functionality, Account management |
| Personal info → **Email address** | Yes | Required | App functionality, Account management, Developer communications |
| Personal info → **User IDs** | Yes | Required | App functionality, Account management |
| Personal info → **Phone number** | Yes | Optional | App functionality |
| Personal info → **Other info** (дата рождения ребёнка) | Yes | Optional | App functionality |
| Financial info → **Purchase history** | Yes | Optional | App functionality |
| Health and fitness → **Fitness info** (посещаемость, дневник, ранги) | Yes | Required | App functionality |
| App activity → **App interactions** (просмотры видео, записи, отметки) | Yes | Required | App functionality |
| App activity → **Other user-generated content** (дневник, заявки, жалобы) | Yes | Optional | App functionality |
| App info and performance → **Diagnostics** | Yes — только если на сервере включён Sentry | Required | App functionality |
| Device or other IDs → **Device or other IDs** (push-токен) | Yes | Optional | App functionality |

Не отмечать: Location (IP хранится только в записи согласия, местоположение
по нему не определяется `[ВЫВОД]`), Financial info → Payment info (карту
вводят у платёжного сервиса), Messages, Photos and videos, Audio, Files and
docs, Calendar, Contacts, Web browsing, Crash logs (в приложении нет SDK
сбора сбоев), Installed apps, In-app search history (поиск по курсам —
локальный фильтр).

Почему *Shared — No*: передача обработчикам (service providers), по действию
пользователя (оплата) и по юридическим основаниям «sharing» не считается —
[Play Console Help, Data safety](https://support.google.com/googleplay/android-developer/answer/10787469).

## App Store — App Privacy

App Store Connect → приложение → **App Privacy → Get Started**.

- Do you or your third-party partners collect data from this app? — **Yes**.
- Для каждого типа: **Linked to the user — Yes**, **Used for tracking — No**,
  цель — **App Functionality** (у e-mail ещё **Developer’s Advertising or
  Marketing — нет**; служебные письма — это App Functionality).
- App Tracking Transparency не нужен: трекинга нет.

| Категория | Тип | Примечание |
|---|---|---|
| Contact Info | **Name** | имя/фамилия |
| Contact Info | **Email Address** | вход |
| Contact Info | **Phone Number** | вносит клуб |
| Health & Fitness | **Fitness** | посещаемость, дневник, ранги |
| Purchases | **Purchase History** | абонементы и оплаты |
| User Content | **Other User Content** | дневник, заявки, жалобы |
| Identifiers | **User ID** | ID аккаунта |
| Identifiers | **Device ID** | push-токен — консервативно `[ВЫВОД]` |
| Usage Data | **Product Interaction** | просмотры видео, записи, отметки |
| Diagnostics | **Other Diagnostic Data** | только если на сервере включён Sentry |
| Other Data | **Other Data Types** | дата рождения ребёнка |

Не отмечать: Location, Sensitive Info, Contacts, Financial Info (карта не
проходит через приложение), Browsing/Search History, Crash Data (нет SDK),
Audio/Photos/Videos/Gameplay, Customer Support (поддержка — по почте вне
приложения).

`PrivacyInfo.xcprivacy` генерирует Expo (причины доступа к UserDefaults, file
timestamp, boot time); `NSPrivacyTracking = false`. Отдельно его править не
нужно.

## RuStore — «Безопасность данных пользователя»

Блок в форме загрузки версии. Консоль предзаполняет типы по разрешениям из
манифеста — проверьте и дополните
([категории и типы](https://www.rustore.ru/help/developers/publishing-and-verifying-apps/app-publication/new-version-app/declare-app-permissions/data-categories)).

**Чувствительные разрешения** (поле «Обоснование»):

| Разрешение | Обоснование |
|---|---|
| `CAMERA` | Сканирование QR-кода клуба, чтобы вступить в клуб. Камера включается только на экране «Сканировать QR», изображение не сохраняется и не передаётся. Без разрешения клуб можно добавить по ссылке или коду. |
| `POST_NOTIFICATIONS` | Уведомления о переносе и отмене тренировок, объявлениях клуба и окончании абонемента. Запрашивается после вступления в клуб, можно отключить в настройках. |

Остальные разрешения сборки — безопасные или служебные: `INTERNET`,
`ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE`, `VIBRATE`, `WAKE_LOCK`,
`RECEIVE_BOOT_COMPLETED` (доставка уведомлений после перезагрузки),
`MODIFY_AUDIO_SETTINGS` (звуковые сигналы режима «Дрилл»),
`com.google.android.c2dm.permission.RECEIVE` (FCM), разрешения значков на
иконке (`*.badge.*`, лаунчеры). Микрофон, хранилище, геолокация, контакты,
биометрия, foreground service и окна поверх других приложений заблокированы
(`blockedPermissions` в `apps/mobile/src/app-variant.js`).

**Категории и типы данных** — те же, что в Google Play выше, в терминах
RuStore: Личная информация → Имя, Адрес электронной почты, ID пользователей,
Номер телефона, Другие данные (дата рождения ребёнка); Финансовые данные →
История покупок; Здоровье и фитнес → Данные о физической активности;
Действия в приложении → Взаимодействие с приложением, Другой пользовательский
контент; Данные о работе приложения → Диагностика (если включён Sentry);
Идентификаторы → ID устройства или другие идентификаторы (push-токен).
Передача третьим лицам — нет (см. таблицу получателей).

**Платёжные решения** (§9.1 правил RuStore — декларируются все, включая
внешние): если хотя бы один клуб принимает онлайн-оплату абонементов —
задекларировать **«сторонние платёжные сервисы и эквайринг»: ЮKassa, Stripe —
оплата абонементов клуба (услуги в зале) на странице платёжного сервиса в
браузере**. Встроенных покупок и подписок RuStore нет.

## Проверка перед отправкой

- Политика `/legal/privacy` открывается без входа, на русском, называет
  оператора, категории данных, цели, сроки, порядок удаления и контакт
  (RuStore §5.1, App Store 5.1.1(i)).
- В приложении ссылка на политику: Профиль → Настройки → «Политика
  конфиденциальности» и экран согласия при первом входе.
- Удаление аккаунта: Профиль → Настройки → «Удалить аккаунт» и
  `/legal/delete-account` (Google Play, App Store 5.1.1(v), RuStore §5.4).
