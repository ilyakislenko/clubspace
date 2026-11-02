# Возрастной рейтинг и целевая аудитория

Что приложение показывает: расписание, абонементы, посещаемость, ранги и
видеоуроки, которые загружает клуб (техника единоборств, связки танцев,
упражнения). Нет чата между пользователями, ленты, рекламы, покупок внутри
приложения, браузера, геолокации. Пользовательский контент — видео и
объявления сотрудников клуба внутри своего клуба; жалоба на контент есть
(`content.report`).

**Дети.** Ребёнок без своего входа — профиль, который ведёт родитель (раздел
«Дети», переключение «от имени»). Своим e-mail входят подростки и взрослые.
Поэтому приложение **не для детей**: не выбирать категорию Kids (App Store) и
возраст до 13 лет в Google Play, не писать «для детей» в названии,
подзаголовке, иконке и на скриншотах (App Store 2.3.8, 5.1.4; Google Play —
[Target audience](https://support.google.com/googleplay/android-developer/answer/9867159)).
Политика конфиденциальности (раздел 7): младше 16 лет — с согласия родителя.

`[ВЫВОД]` Видео клуба — не наш контент: если клуб единоборств выкладывает
спарринги и бои (не разбор техники), ответ про «реалистичное насилие»
меняется на «редко» — рейтинг App Store станет 13+, RuStore — 12+.

## Google Play

**App content → Target audience and content**

| Вопрос | Ответ |
|---|---|
| Target age groups | **13–15, 16–17, 18 и старше** (без групп до 13 — иначе применяется Families Policy) |
| Could your store listing unintentionally appeal to children? | **No** — на скриншотах интерфейс, без детских персонажей; кадр «Родитель ведёт профили детей» — экран родителя |
| Appeals to children (если Google спросит) | Дети занимаются в клубах, но приложением пользуются родители; детских аккаунтов со входом нет |

**App content → Content rating** (анкета IARC)

- E-mail для IARC — почта владельца аккаунта.
- Category: **All Other App Types** (не игра, не соцсеть, не магазин).

| Вопрос анкеты | Ответ |
|---|---|
| Violence (насилие, кровь) | **No** — разбор техники единоборств как спорта `[ВЫВОД]` |
| Sexuality, Language (мат), Controlled substances, Crude humor | **No** |
| Gambling / simulated gambling | **No** |
| Users interact or exchange content? | **Yes** — сотрудники клуба публикуют видео и объявления для участников клуба; чата и личных сообщений нет |
| Shares user’s current physical location? | **No** |
| Allows users to purchase digital goods? | **No** — покупок в приложении нет; онлайн-оплата абонемента клуба — физическая услуга на странице платёжного сервиса |
| Contains web browser / unrestricted internet? | **No** |

Ожидаемо: IARC Generic 3+/PEGI 3 с пометкой «Users Interact». Точный
итог выдаёт анкета.

**App content → другие декларации**

| Раздел | Ответ |
|---|---|
| Ads | **No ads** |
| App access | Вход обязателен — инструкция из [review-notes.md](review-notes.md) |
| Data safety | [data-safety.md](data-safety.md) |
| Government apps | No |
| Financial features | **None** (оплата абонемента клуба — не финансовая услуга приложения) |
| Health apps | **No health features** `[ВЫВОД]`: учёт посещений клуба, без медицинских данных, датчиков и Health Connect. Если Play попросит уточнить — «Activity and fitness: attendance log of a sports club, no sensors, no health data» |
| News app | No |

## App Store

App Store Connect → App Information → **Age Rating → Edit** (новая анкета 2025:
4+/9+/13+/16+/18+,
[определения](https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions)).

| Раздел | Вопрос | Ответ |
|---|---|---|
| In-App Controls | Parental Controls | **No** |
| In-App Controls | Age Assurance | **No** |
| Capabilities | Unrestricted Web Access | **No** |
| Capabilities | User-Generated Content | **Yes** — видео и объявления сотрудников клуба |
| Capabilities | Social Media | **No** (нет ленты, лайков, комментариев) |
| Capabilities | Messaging and Chat | **No** |
| Capabilities | Advertising | **No** |
| Mature Themes | Profanity, Horror, Alcohol/Tobacco/Drugs | **None** |
| Medical or Wellness | Medical or Treatment Information | **None** |
| Medical or Wellness | Health or Wellness Topics | **Yes** — тренировки и упражнения |
| Sexuality or Nudity | все три | **None** |
| Violence | Cartoon / Realistic / Prolonged graphic | **None** (см. `[ВЫВОД]` выше про спарринги) |
| Violence | Guns or Other Weapons | **None** |
| Chance-Based | Gambling, Simulated Gambling, Loot Boxes | **None** |
| Chance-Based | Contests | **Infrequent** — рейтинг посещаемости клуба |

Итог: **9+** (из-за Health or Wellness Topics). Made for Kids — **нет**, Kids
Category — **не выбирать**.

## RuStore

Консоль → версия → «Возрастная категория»
([как выбрать](https://www.rustore.ru/help/developers/publishing-and-verifying-apps/app-publication/new-version-app/age-restrictions),
маркировка по 436-ФЗ).

Рекомендуем **6+**: учебные видео контактных видов спорта (броски, удержания,
удары в разборе техники) формально не подходят под «0+ — только полностью
безопасный контент» `[ВЫВОД]`. Для студии без единоборств допустимо 0+, но
приложение одно на все клубы — берём 6+.

Детские приложения (§3.2, §9.7 правил RuStore) — не наш случай: приложение
не предназначено для детей, рекламы нет, данные детей вводит родитель с
согласием (экран «Дети» → подтверждение с галочкой согласия).
