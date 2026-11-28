# Видеоинструкции

Короткие (60–90 с) ролики по задачам, без голоса, с русскими субтитрами,
вшитыми в кадр. Записываются скриптом с живого локального стенда на демо-клубе
ACADEMY, поэтому после изменений интерфейса их перезаписывают одной командой.

Где их видят:
- публичный сайт (`SITE_URL`, на clubspace.space — `https://site.clubspace.space`):
  `/help` («Видеоинструкции», по ролям);
- админка: меню аккаунта внизу боковой панели → «Видеоинструкции» — в клубе
  и в кабинете федерации (новая вкладка с `/help`; пункта нет, если адрес
  сайта неизвестен);
- справочная панель «?» админки — по `id` из того же манифеста.

Оба читают манифест `${GUIDES_BASE_URL}/guides.json`.

## Инструкции

| `id` (контракт) | Кому | Что показывает | Сценарий |
|---|---|---|---|
| `owner-setup` | Владелец клуба | зал, группа, слоты «каждую неделю», тариф | `scripts/guides/scenarios/owner-setup.mjs` |
| `invite` | Владелец клуба | код клуба, ссылка, QR, страница `/join`, заявка принята | `scripts/guides/scenarios/invite.mjs` |
| `attendance` | Тренер | приложение: сегодняшняя тренировка, код самоотметки, отметка по имени, заметка | `scripts/guides/scenarios/attendance.mjs` |
| `video-course` | Тренер | загрузка видео, курс с разделом, урок, публикация | `scripts/guides/scenarios/video-course.mjs` |
| `money` | Владелец клуба | абонемент в карточке, отметка оплаты, заморозка, «Кому позвонить» | `scripts/guides/scenarios/money.mjs` |
| `student` | Ученик | `/download`, главная, запись на тренировку другой группы, урок курса | `scripts/guides/scenarios/student.mjs` |
| `federation` | Федерация | заявки клубов, взвешивание, результат схватки, сетка, итоги | `scripts/guides/scenarios/federation.mjs` |

`id` менять нельзя: по ним справочная панель админки находит ролик.

## Стенд

Нужен локальный стек с демо-данными (см. [demo.md](demo.md)):

1. `npm run demo:reset -- --args=all`, затем `npm run demo:videos`.
2. API с `DEMO_MODE=true`, `ORGANIZATIONS_ENABLED=true`,
   `PLATFORM_DPA_VERSION=2026-12-01`, `ADMIN_URL` и `CORS_ORIGINS` на адреса
   ниже; видео-воркер; MailDev (код входа для «новичка» из `invite`).
3. Админка (production-сборка, как в `apps/admin-e2e/run.sh`), публичный сайт
   и PWA (`npm run build:pwa` в `apps/mobile`, раздаётся статикой с fallback на
   `index.html`). Сайту — боевые `PWA_URL`, `SITE_URL`, `ANDROID_APK_URL`
   (`https://app.clubspace.space` и т. д.): `/download` из `student` показывает
   адрес приложения, и в ролике он должен быть настоящим, а не `localhost`.

Переменные (по умолчанию — локальные порты):

| Переменная | По умолчанию |
|---|---|
| `GUIDES_ADMIN_URL` | `http://localhost:4301` |
| `GUIDES_API_URL` | `http://localhost:3301` |
| `GUIDES_SITE_URL` | `http://localhost:4302` |
| `GUIDES_PWA_URL` | `http://localhost:8086` |
| `GUIDES_MAILDEV_URL` | `http://localhost:1080` |
| `GUIDES_OWNER_EMAIL`, `GUIDES_COACH_EMAIL`, `GUIDES_STUDENT_EMAIL`, `GUIDES_FEDERATION_EMAIL` | демо-аккаунты `@academy.demo` |
| `DEMO_LOGIN_CODE` | из `.env` репозитория (вводится в форму входа, нигде не печатается) |
| `GUIDES_OUT_DIR` / `GUIDES_WORK_DIR` | `/tmp/guides/out` / `/tmp/guides/work` |
| `GUIDES_VERSION` | сегодняшняя дата `YYYYMMDD` — суффикс имён файлов |
| `GUIDES_PUBLIC_HELP_URL` | `https://site.clubspace.space/help` — на финальной карточке |
| `GUIDES_HEADED=1` | показать браузер во время записи |

## Записать

```sh
node scripts/guides/record.mjs                 # все
node scripts/guides/record.mjs invite          # одну
node scripts/guides/record.mjs --assemble-only invite   # пересобрать последнюю запись (правка субтитров, оформления)
```

Результат в `GUIDES_OUT_DIR`: `<id>-<версия>.mp4` (1920×1080, H.264 yuv420p,
30 fps, тихая AAC-дорожка), `.jpg` (постер), `.srt` и `guides.json` — записи
инструкций, которые в этот запуск не перезаписывались, сохраняются.

Повторный запуск безопасен: сценарий сам убирает то, что создал в прошлый
раз, а то, что упавший запуск не успел убрать, — в следующий
(`<GUIDES_WORK_DIR>/<id>/cleanup.json`):
- `owner-setup` — зал «СК «Старт»», группа «Взрослые · Старт», тариф
  «Старт · 8 занятий»;
- `invite` — «новичок» Ирина Новикова `guide.newcomer@example.com` выходит из
  клуба и снова подаёт заявку;
- `attendance` — отметки и заметка на тренировке снимаются после записи;
- `video-course` — курс «Защита от удушений» и видео «Уход от удушения сзади»
  (тестовая таблица ffmpeg, 12 с);
- `money` — заморозка завершается, отметка оплаты снимается, абонемент
  отменяется. Отменённый остаётся в истории ученика, поэтому каждый запуск
  берёт следующего взрослого из «Кому позвонить» с кончившимся абонементом;
  кончились — `demo:reset`;
- `student` — запись на тренировку отменяется;
- `federation` — результат схватки отменяется.

От времени суток зависят `attendance` (берёт ближайшую сегодняшнюю
тренировку тренера; шаг «Сканировать» — только если она вот-вот начнётся) и
`student` (записывается на сегодняшнюю «BJJ Взрослые» в 18:00 по Томску —
записывать до неё). Вход — до начала записи, в отдельном окне; в кадр он не
попадает. Если сценарий упал, снимок места ошибки — в
`<GUIDES_WORK_DIR>/<id>/failure.png`.

Как устроено (`scripts/guides/`):
- `scenarios/<id>.mjs` — шаги: `rec.say(текст)` ставит субтитр с текущей
  секунды записи (`{ top: true }` — сверху, если действие внизу страницы),
  `rec.click` / `rec.type` / `rec.drag` ведут видимый курсор с подсветкой
  клика, `rec.offCamera(fn)` вырезает ожидание из ролика, `rec.markPoster()`
  выбирает кадр постера;
- `lib/recorder.mjs` — Playwright с `recordVideo` (админка 1440×900, телефон —
  iPhone 13 в CSS-размере 390×844: кадры скринкаста приходят в CSS-пикселях),
  курсор внедряется только в записываемый контекст; `lib/admin.mjs` и
  `lib/phone.mjs` — вход и открытие записи; субтитры телефона — слева, под
  названием, а не поверх экрана;
- `lib/assemble.mjs` — ffmpeg: обрезка, титул 2 с, рамка, субтитры, финальная
  карточка 3 с, постер, `.srt`. Картинки (титул, рамка, субтитры) рисует
  Chromium из HTML (`lib/render.mjs`): у ffmpeg из Homebrew нет drawtext/libass;
- `lib/captions.mjs` — субтитры: не больше 2 строк по 42 символа (длиннее —
  ошибка, текст нужно сократить), показ до следующего субтитра, не дольше 8 с.

Текст субтитров — короткое повелительное: что сделать и зачем, а не то, что и
так написано на экране.

## Опубликовать

Файлы лежат в бакете `clubspace` под `downloads/guides/` (префикс `downloads/`
открыт на чтение без подписи, см. `minio-init`). Имена версионные — CDN кэширует
mp4/jpg по имени, поэтому новая запись = новые имена, старые можно удалить
позже. На сервере, из каталога с файлами:

```sh
set -a; . /opt/clubspace/.env.production; set +a
docker run --rm --network container:clubspace-minio-1 -v "$PWD:/src" \
  --entrypoint sh "$MINIO_CLIENT_IMAGE" -c \
  'mc alias set s3 http://localhost:9000 "$0" "$1" >/dev/null && mc cp /src/*.mp4 /src/*.jpg s3/clubspace/downloads/guides/ && mc cp /src/guides.json s3/clubspace/downloads/guides/' \
  "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY"
```

Сначала ролики и постеры, `guides.json` вторым шагом: он ссылается на уже
загруженные файлы, а `/help` читает его при каждом запросе.
Затем в `.env.production` — `GUIDES_BASE_URL=https://<хранилище>/clubspace/downloads/guides`
и `docker compose … up -d client` (сайт читает манифест при каждом запросе).
