# Подача ClubSpace в Google Play, App Store и RuStore

Всё, чтобы после заведения аккаунтов осталось вставить. Схема
распространения, сборки EAS и аккаунт проверки — в
[`../store-distribution.md`](../store-distribution.md). Сверено с
первоисточниками 3 ноября 2026; `[ВЫВОД]` — наша интерпретация.

| Файл | Что внутри |
|---|---|
| [listing.md](listing.md) | Названия, описания, подзаголовок, ключевые слова, promo text (RU + EN для App Store), подписи скриншотов |
| [data-safety.md](data-safety.md) | Google Play Data safety, App Store App Privacy, RuStore «Безопасность данных» и платёжные решения |
| [age-rating.md](age-rating.md) | Целевая аудитория, IARC, анкета Apple, RuStore |
| [review-notes.md](review-notes.md) | Вход для проверки и что показать (RU/EN) |
| [screenshots/](screenshots/) | Шаблоны подписи и feature graphic; съёмка — `scripts/store-screenshots.mjs` |

Готовые картинки (в репозиторий не кладутся):
`~/Desktop/ClubSpace-презентация/магазины/<магазин>/<устройство>/без-подписи|с-подписью/`
и `google-play/feature-graphic-1024x500.jpg`.

## Размеры и лимиты

### Скриншоты

| Магазин / устройство | Требование | Наш набор |
|---|---|---|
| Google Play, телефон | 2–8 шт., JPEG или 24-bit PNG без альфы, стороны 320–3840, длинная ≤ 2× короткой; для рекомендаций — ≥ 4 шт. 9:16 от 1080×1920 | `google-play/телефон` 1080×1920, 8 шт. |
| Google Play, планшет 7" и 10" | до 8, для больших экранов ≥ 4 шт., 1080–7680 px, 9:16 или 16:9, без лишнего текста | `планшет-7` 1224×2176, `планшет-10` 2560×1440 — заливать **без подписи** |
| Google Play, feature graphic | обязательно, 1024×500, JPEG или PNG без альфы | `feature-graphic-1024x500.jpg` (черновик без логотипа) |
| Google Play, иконка | 512×512, 32-bit PNG, ≤ 1 МБ | нет логотипа — **владелец** |
| RuStore, телефон | ≥ 3, 1–10 за раз, PNG/JPG ≤ 3 МБ, до 2160×3840, рекомендовано 16:9 | `rustore/телефон` 1080×1920 |
| RuStore, планшет (необязательно) | ≥ 3, ≤ 5 МБ | `rustore/планшет` 1920×1080 |
| RuStore, иконка | 512×512, PNG/JPG ≤ 3 МБ, фон по всей площади, такая же, как на устройстве | **владелец** |
| App Store, iPhone | 1–10 на размер, JPEG/PNG без альфы; обязателен «iPhone with Dynamic Island (medium)» 1206×2622 / 1179×2556, иначе масштабируются большие | `iphone-6.9` 1320×2868, `iphone-6.5` 1284×2778, `iphone-6.3` 1206×2622 |
| App Store, iPad 13" | обязателен, т. к. `supportsTablet: true`; 2064×2752 или 2048×2732 | `ipad-13` 2064×2752 |
| App Store, иконка | 1024×1024 без прозрачности — из `apps/mobile/assets/images/icon.png` | сейчас заглушка Expo — **владелец** |

Скриншоты сняты с PWA демо-стенда (вымышленный клуб ACADEMY), светлая тема,
пояс Asia/Tomsk; интерфейс тот же, что у нативной сборки. Переснять (новый
логотип, второй демо-клуб):

```
node scripts/store-screenshots.mjs --out ~/Desktop/ClubSpace-презентация/магазины \
  --attendance <slotId>/<YYYY-MM-DD>   # существующая сессия посещаемости тренера
```

Скрипт работает только на чтение: все записи в API, кроме входа, глушатся в
браузере. После iOS 27.1 SDK (с апреля 2027) Apple потребует ещё скриншоты
iPhone Duo.

### Лимиты текстов

| Поле | Google Play | RuStore | App Store |
|---|---|---|---|
| Название | 30 | 30 | 30 (Name) |
| Краткое описание / Subtitle | 80 | 80 | 30 (Subtitle) |
| Полное описание | 4000 | 4000 (свёрнуто 2000) | 4000 |
| Promo text | — | — | 170 |
| Keywords | — | до 5 тегов из списка | 100 байт (в справке) / 100 символов (в гайде) |
| Что нового | 500 | — | 4000 |

## Несоответствия продукта требованиям

| # | Что | Статус |
|---|---|---|
| 1 | iOS: `NSFaceIDUsageDescription` по-английски от `expo-secure-store`, хотя биометрии нет | **Исправлено**: `faceIDPermission: false` |
| 2 | iOS: `UIBackgroundModes: audio` и Android-сервис фонового звука от `expo-audio`, хотя фоновой игры нет (риск App Review 2.5.4) | **Исправлено**: `enableBackgroundPlayback: false` |
| 3 | Если ревьюер удалил аккаунт проверки, следующий вход фиксированным кодом не работал (аккаунт не создавался заново) — отказ 2.1 на следующем обновлении | **Исправлено**: send-auth-code отмечает запрос, вход кодом создаёт аккаунт и добавляет в демо-клуб; unit- и e2e-тесты |
| 4 | Политика конфиденциальности упоминала вход через Google/Apple (его нет) и не упоминала детей, записи, оплаты, Web Push, согласие с IP | **Исправлено** в `/legal/privacy` (редакция 3 ноября 2026) |
| 5 | `store-distribution.md`: «платежей в приложении нет» для RuStore §9.1 и «в PWA push нет» устарели | **Исправлено** |
| 6 | Видеокурсы с замком «Доступно по абонементу «X»» рядом с «Оплатить онлайн»: если клуб продаёт тариф «только видео», это цифровой контент за внешнюю оплату (App Store 3.1.1/3.1.3, Google Play Payments) | **Не исправлено, риск средний** `[ВЫВОД]`. Пока тарифы — абонементы в зал (3.1.3(e), Play прямо относит gym memberships к физическим услугам), это допустимо. Не продавать клубам тарифы «только видео» в нативном приложении; при отказе — скрыть в iOS-сборке причину PLAN-замка или кнопку оплаты для тарифов без занятий (задача на 0,5–1 день) |
| 7 | Иконка и сплэш — заглушки Expo (значок стадиона), RuStore требует одинаковую иконку в магазине и на устройстве | **Владелец**: логотип |
| 8 | Push на Android без Google (Huawei, часть RuStore-аудитории) не придут | Не исправлено: RuStore Push SDK — отдельная задача |
| 9 | Почта поддержки по умолчанию — личная (`dude_talks@icloud.com`), на лендинге нет адреса и телефона для App Store Support URL | **Владелец**: ящик поддержки, контакты на сайте |
| 10 | Политика: плейсхолдеры `[в скобках]` (хостинг, S3, SMTP) | **Владелец**: вписать провайдеров после покупки сервера |
| 11 | «Оплатить онлайн» у записи на событие (билет на очный мастер-класс) через кассу клуба | **В порядке** `[ВЫВОД]`: очное участие — физическая услуга вне приложения (App Store 3.1.3(e), Google Play Payments: physical goods/services), внешняя оплата допустима; онлайн-трансляций/записей за билет не продаём |

Проверено и в порядке: удаление аккаунта в приложении (Профиль → Настройки)
и `/legal/delete-account`; ссылки на политику, согласие, условия в
настройках и на экране согласия; Android-разрешения сборки (камера,
уведомления, служебные) без микрофона, хранилища, геолокации; iOS — только
камера с русским текстом; targetSdk 36 (требование Google Play с 31.08.2026);
вход ревьюера `STORE_REVIEW_*`; в демо-клубе нет онлайн-оплаты.

## Чек-лист: Google Play (делает владелец)

1. Аккаунт Play Console. Личный аккаунт (физлицо, гражданин КЗ) — $25, проверка
   личности; новый личный аккаунт **не выпустит прод без закрытого теста: ≥ 12
   тестеров 14 дней подряд** ([правило](https://support.google.com/googleplay/android-developer/answer/14151465)).
   Аккаунт организации (ИП с D-U-N-S) от теста освобождён.
2. Firebase-проект → `google-services.json` → EAS file-переменная
   `GOOGLE_SERVICES_FILE`; FCM V1 ключ — в `npx eas credentials`.
3. `eas init` → `EAS_PROJECT_ID`; `scripts/set-mobile-target.sh --domain … --support-email …`.
4. Сервер: `STORE_REVIEW_*` (раздел 5 store-distribution), демо-клуб с контентом.
5. Create app → «ClubSpace: расписание и клуб», язык ru-RU, App, Free.
6. App content: Privacy policy (`/legal/privacy`), App access
   ([review-notes](review-notes.md)), Ads: No, Content rating, Target
   audience 13+ ([age-rating](age-rating.md)), Data safety
   ([data-safety](data-safety.md)), Financial/Health/Government — No.
7. Store listing: тексты из [listing.md](listing.md), иконка 512, feature
   graphic, скриншоты телефон + планшеты, категория «Здоровье и фитнес»,
   e-mail поддержки.
8. `npx eas build --profile store --platform android` → первую AAB загрузить
   **вручную** в Internal testing; Play App Signing — ключ EAS как upload key.
9. Closed testing: 12+ тестеров (Google-аккаунты), 14 дней, собрать отзывы.
10. Apply for production → ответы о тесте → Production, страны.
11. После релиза: `PLAY_STORE_URL`, `ANDROID_CERT_SHA256` (ключ из Play
    Console) в env клиента — App Links `/join/*`.

Источники: [preview assets](https://support.google.com/googleplay/android-developer/answer/9866151),
[Data safety](https://support.google.com/googleplay/android-developer/answer/10787469),
[удаление аккаунта](https://support.google.com/googleplay/android-developer/answer/13327111),
[Payments](https://support.google.com/googleplay/android-developer/answer/9858738),
[target audience](https://support.google.com/googleplay/android-developer/answer/9867159),
[Families](https://support.google.com/googleplay/android-developer/answer/9893335),
[App access](https://support.google.com/googleplay/android-developer/answer/9859455),
[target API](https://support.google.com/googleplay/android-developer/answer/11926878).
С 2027 Google распространяет проверку разработчика на APK вне магазинов
([developer verification](https://developer.android.com/developer-verification)) —
раздавать APK клубам можно будет только зарегистрированного пакета.

## Чек-лист: App Store (делает владелец)

1. Apple Developer Program как физлицо (гражданин КЗ), $99/год; имя продавца
   в магазине — ФИО. Магазин РФ: платежи App Store там остановлены, бесплатное
   приложение распространяется; приложения могут удалить по требованию
   регулятора — PWA остаётся запасным путём.
2. App Store Connect → Agreements: Free Apps достаточно (платных и IAP нет).
3. New App: iOS, «ClubSpace», ru, Bundle ID `com.clubspace.app`, SKU
   `clubspace-ios`.
4. APNs-ключ: `npx eas credentials` (iOS → Push Notifications); `APPLE_TEAM_ID` и
   `IOS_BUNDLE_ID` в env клиента (Universal Links); `ascAppId` в `eas.json`.
5. App Information: категория Health & Fitness / Sports, Age Rating
   ([age-rating](age-rating.md), 9+), Privacy Policy URL, Digital Goods and
   Services: «Can customers consume digital goods…?» — **Yes**, «Apple IAP
   only» не выбирать, способ оплаты цифрового нет: видео входят в абонемент
   клуба, в приложении не продаются `[ВЫВОД]`; при сомнении — вопрос в App
   Review Notes.
6. App Privacy — [data-safety.md](data-safety.md#app-store--app-privacy).
7. Version: скриншоты iPhone 6.9/6.5/6.3 и iPad 13, тексты и keywords из
   [listing.md](listing.md), Support URL с контактами, App Review Information
   из [review-notes.md](review-notes.md).
8. `npx eas build --profile store --platform ios` → `npx eas submit` →
   TestFlight (внутренние тестеры, без ревью) → проверить вход ревьюера и
   удаление аккаунта на устройстве → Submit for Review.
9. Export compliance: `ITSAppUsesNonExemptEncryption = false` уже в сборке.

Источники: [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
(2.1, 2.3.3, 2.3.7, 2.3.8, 3.1.1, 3.1.3(e), 5.1.1, 5.1.4),
[скриншоты](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications),
[поля версии](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information),
[App information](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information),
[возраст](https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions),
[Digital Goods](https://developer.apple.com/help/app-store-connect/manage-app-information/complete-the-digital-goods-and-services-questionnaire).

## Чек-лист: RuStore (делает владелец)

1. Аккаунт RuStore Консоль через VK ID. Варианты:
   - **физлицо** — регистрация мгновенная, без модерации; иностранцам-физлицам
     разрешена; монетизация ограничена (нам не нужна);
   - **ИП (жены, РФ)** — нужна УКЭП и плагин КриптоПро, проверка 2–4 рабочих
     дня; карточка покажет название ИП;
   - самозанятым с 1 февраля 2026 платёжные инструменты RuStore недоступны
     (нужен переход на ИП) — для бесплатного приложения не важно.
   Рекомендация `[ВЫВОД]`: сразу ИП жены — разработчик в карточке совпадёт
   с продавцом для российских клубов; физлицо владельца — если ИП ещё нет.
2. Приложения → Добавить → «ClubSpace: расписание и клуб».
3. Загрузить AAB (подпись добавить отдельно — тот же ключ, что в Play) или
   APK из `production`; версия — та же, что в Google Play (RuStore снимает
   отстающие версии).
4. Безопасность данных: чувствительные разрешения `CAMERA`,
   `POST_NOTIFICATIONS` с обоснованием, категории данных — [data-safety.md](data-safety.md#rustore--безопасность-данных-пользователя).
5. Платёжные решения: задекларировать сторонний эквайринг (ЮKassa/Stripe
   клуба) — §9.1.
6. Карточка: тексты из [listing.md](listing.md), категория «Спорт», 6+,
   иконка 512, ≥ 3 скриншота телефона, контакты разработчика, политика.
7. Комментарий модератору — [review-notes.md](review-notes.md#rustore--комментарий-модератору).
8. Отправить на модерацию; после публикации — `RUSTORE_URL` в env клиента.

Источники: [публикация](https://www.rustore.ru/help/developers/publishing-and-verifying-apps/app-publication),
[правила модерации](https://www.rustore.ru/help/developers/publishing-and-verifying-apps/requirement-apps)
(§4.6, §5.1, §5.4, §6, §9.1),
[регистрация](https://www.rustore.ru/help/developers/developer-account/registration-developer),
[FAQ регистрации](https://www.rustore.ru/developer/blog/faq-po-registracii-razrabotchikov-v-rustore),
[самозанятые → ИП](https://www.rustore.ru/developer/blog/self-employed),
[разрешения](https://www.rustore.ru/help/developers/publishing-and-verifying-apps/app-publication/new-version-app/declare-app-permissions/permission-types),
[возраст](https://www.rustore.ru/help/developers/publishing-and-verifying-apps/app-publication/new-version-app/age-restrictions).
