# ClubSpace — Production Deploy

One-host Docker Compose deploy: the NestJS API, Postgres, Redis, MinIO object
storage, the video worker, the admin panel and the student web app, all behind
Caddy with automatic Let's Encrypt TLS. Sized for a home server or a small VPS.

Read this top to bottom the first time. The steps are ordered so nothing is
referenced before it exists.

## Запуск с нуля за час (VDS Selectel / Timeweb)

Путь для одного арендованного сервера без DevOps-инженера. Всё ниже делает
`deploy/bootstrap.sh`; руками — только то, что требует ваших аккаунтов (DNS,
почта, S3, Telegram). Остальная часть документа (на английском) — справочник.

### Что понадобится и сколько стоит

| Что | Где | ≈ в месяц |
|---|---|---|
| VDS 4 vCPU / 8 ГБ / 80 ГБ NVMe, Ubuntu 24.04 | Selectel «VDS 4-8-80» или Timeweb Cloud «Cloud MSK 80» | 1 100–1 800 ₽ |
| S3 для бэкапов (дампы базы + зеркало видео, 20–60 ГБ) | Selectel S3 или Timeweb S3 (холодное/стандартное хранилище) | 50–200 ₽ |
| Почта для кодов входа (транзакционный SMTP) | см. шаг 3 | 0–600 ₽ |
| Домен `.ru` | любой регистратор | ~20–80 ₽ (200–900 ₽ в год) |
| HTTPS-сертификаты, Telegram-алерты, мониторинг | Let's Encrypt, свой бот | 0 ₽ |
| **Итого** | | **≈ 1 300–2 700 ₽** |

Цены — ориентир на ноябрь 2026 по публичным тарифам ([сравнение 4/8/80](https://hostmetrics.ru/vps/config/4-cpu-8-gb/),
[Timeweb S3](https://timeweb.cloud/services/s3-storage)); перед покупкой
проверьте, входит ли в тариф публичный IPv4 и сколько стоит исходящий трафик S3.
Одной такой машины хватает на первые десятки клубов; видео — главный
потребитель диска и канала (см. «Видео и диск» ниже).

### 1. Сервер

- **Selectel:** Панель → Облачная платформа / VDS → создать сервер, образ
  Ubuntu 24.04 LTS, 4 vCPU / 8 ГБ / 80 ГБ, публичный IPv4, добавьте свой
  SSH-ключ. **Timeweb Cloud:** Облачные серверы → Создать, Ubuntu 24.04, регион
  Москва, та же конфигурация, SSH-ключ.
- Запишите IP. Проверьте вход: `ssh root@<IP>`.

### 2. DNS

У регистратора домена (или в DNS-хостинге Selectel/Timeweb) создайте четыре
A-записи на IP сервера, TTL 300–600:

| Имя | Тип | Значение | Зачем |
|---|---|---|---|
| `api` | A | `<IP>` | API для приложений и сайта |
| `admin` | A | `<IP>` | админка клубов и консоль платформы |
| `app` | A | `<IP>` | сайт: лендинг, страницы клубов, `/join`, `/legal` |
| `s3` | A | `<IP>` | загрузка и просмотр видео (браузер ходит напрямую) |

Проверка: `dig +short api.<домен>` (и для остальных трёх) показывает ваш IP.
Пока записи не разошлись, `bootstrap.sh` остановится на проверке DNS — так и
задумано: иначе Caddy потратит лимит Let's Encrypt на неудачные попытки.

### 3. Почта для кодов входа

Пароля в ClubSpace нет: вход — по коду на почту. Не доходит письмо — человек не
войдёт, поэтому нужен именно **транзакционный SMTP-сервис** с вашим доменом в
адресе отправителя, а не отправка с самого сервера (письма с IP VDS почти
гарантированно уйдут в спам, а 25-й порт провайдеры часто закрывают).

- Подходят российские транзакционные сервисы (Unisender Go, Notisend,
  SendPulse SMTP и т. п.) или почта для домена (Яндекс 360 для бизнеса, VK
  WorkSpace) — у последних есть суточные лимиты на отправку, для старта
  обычно хватает; условия и цены проверьте на сайте сервиса.
- В сервисе подтвердите домен — он выдаст DNS-записи. Добавьте все три вида:
  - **SPF** — TXT на `@`: `v=spf1 include:<значение от сервиса> ~all`
    (одна SPF-запись на домен: если уже есть — допишите `include:` в неё);
  - **DKIM** — TXT (или CNAME) с именем вида `<селектор>._domainkey`, значение
    даёт сервис;
  - **DMARC** — TXT на `_dmarc`: `v=DMARC1; p=none; rua=mailto:<ваш ящик>`;
    через пару недель без проблем в отчётах ужесточите до `p=quarantine`.
- Отправитель — `noreply@<домен>` (по умолчанию). Строка подключения:
  `smtps://<логин>:<пароль>@<smtp-хост>:465` (спецсимволы в пароле —
  в URL-кодировке: `@` → `%40`, `:` → `%3A`, `/` → `%2F`, `#` → `%23`).
- После запуска отправьте себе код входа и посмотрите заголовки письма в Gmail /
  Яндексе: `spf=pass`, `dkim=pass`, `dmarc=pass`.

### 4. S3 для бэкапов

- **Selectel:** S3 → создать бакет `clubspace-backups` (приватный, класс
  «холодное» подходит), затем сервисный пользователь с ролью на S3 и
  S3-ключ для него. Эндпоинт для бакета в пуле ru-1:
  `https://s3.ru-1.storage.selcloud.ru` (для другого пула — `s3.<пул>.storage.selcloud.ru`,
  список в [документации](https://docs.selectel.ru/s3/manage/domains/)).
- **Timeweb Cloud:** S3-хранилище → создать бакет (приватный), ключи — на вкладке
  «Дашборд» бакета. Эндпоинт: `https://s3.twcstorage.ru`.
- Если провайдер позволяет — включите версионирование бакета: тогда даже
  удаление файлов с самого сервера (взлом, ошибка) можно откатить.
- Держите бэкапы у **другого** провайдера или хотя бы в другом проекте/регионе,
  чем сервер, — тогда блокировка аккаунта или авария в ДЦ не заберёт всё сразу.

### 5. Telegram-бот для алертов (2 минуты)

1. В Telegram: [@BotFather](https://t.me/BotFather) → `/newbot` → получите токен.
2. Напишите своему боту любое сообщение.
3. Откройте `https://api.telegram.org/bot<токен>/getUpdates` — в ответе
   `"chat":{"id":…}` это ваш chat id (для группы — добавьте бота в группу,
   id будет отрицательным).

Вместо Telegram или вместе с ним можно получать алерты на почту
(`ALERT_EMAIL`, через тот же SMTP).

### 6. Запуск

```bash
ssh root@<IP>
curl -fsSL https://raw.githubusercontent.com/ilyakislenko/clubspace/main/deploy/bootstrap.sh \
  | bash -s -- --domain <домен> --admin-email <ваш e-mail> \
               --smtp-url 'smtps://<логин>:<пароль>@<smtp-хост>:465'
```

Скрипт (повторный запуск безопасен — он только доделывает недостающее):
ставит Docker, создаёт пользователя `clubspace`, включает firewall (открыты
только SSH, 80, 443), fail2ban и автоматические обновления безопасности,
добавляет swap 4 ГБ, клонирует код в `/opt/clubspace`, создаёт
`.env.production` со случайными стойкими секретами, проверяет DNS, собирает и
запускает стек (первая сборка — 15–30 минут) с Caddy, который сам получает и
продлевает HTTPS-сертификаты для `api.`/`admin.`/`app.`/`s3.`, и ставит
таймеры: ночной бэкап, проверку здоровья каждые 5 минут, ежемесячную проверку
восстановления.

Если `docker pull` падает с ошибками доступа к Docker Hub — запустите ещё раз с
`--registry-mirror <адрес зеркала>` (например, `https://mirror.gcr.io` или
зеркало, которое даёт ваш провайдер).

### 7. Бэкапы и алерты

Впишите в `/opt/clubspace/.env.production` (остальное там уже заполнено):

```bash
BACKUP_S3_ENDPOINT=https://s3.ru-1.storage.selcloud.ru   # или https://s3.twcstorage.ru
BACKUP_S3_ACCESS_KEY_ID=<ключ>
BACKUP_S3_SECRET_ACCESS_KEY=<секрет>
BACKUP_S3_BUCKET=clubspace-backups
MEDIA_BACKUP_LOCAL=false          # видео зеркалируются в S3, вторая копия на диске VDS не нужна
ALERT_TELEGRAM_BOT_TOKEN=<токен>
ALERT_TELEGRAM_CHAT_ID=<chat id>
ALERT_EMAIL=<ваш e-mail>          # необязательно
```

Затем:

```bash
cd /opt/clubspace
sudo ./deploy/healthcheck.sh --test-alert       # должно прийти сообщение
sudo ./deploy/backup-s3.sh                      # первый бэкап в S3
sudo ./deploy/restore.sh --check latest         # и сразу проверка, что он восстанавливается
docker compose -f docker-compose.prod.yml --env-file .env.production up -d media-backup
```

**Сохраните `.env.production` целиком в менеджер паролей** (`sudo cat
/opt/clubspace/.env.production`). Без `BACKUP_ENCRYPTION_KEY` бэкапы не
расшифровать никому, включая вас; без остальных секретов восстановленная база
не откроет зашифрованные поля.

### 8. Первый супер-админ и первый клуб

1. `https://admin.<домен>` → вход по `--admin-email` (`SUPER_ADMIN_EMAIL`), код
   придёт на почту. Этот адрес становится администратором платформы при
   каждом старте сервера — доступ к ящику = доступ к платформе, включите в нём
   двухфакторную защиту.
2. В `/platform` создайте клуб (название + e-mail владельца) или включите
   самостоятельную регистрацию клубов: `SELF_SERVE_SIGNUP_ENABLED=true` в
   `.env.production`, затем
   `docker compose -f docker-compose.prod.yml --env-file .env.production up -d`.
3. Реквизиты для страниц `/legal/*` и оплату клубов картой — см. разделы
   *Updates* и *Card payments* ниже.

### 9. Мобильное приложение и пуши

- Приложение одно для всех клубов; направьте его на ваш сервер:
  `./scripts/set-mobile-target.sh --domain <домен> --support-email <e-mail>`,
  затем сборка через EAS — см. *Your club, and the first students*.
- **Пуши** не настраиваются в `.env.production`: сервер шлёт через Expo, а
  Android-сборке нужен FCM-ключ (Firebase → `google-services.json`), загруженный в
  EAS-проект; для iOS — APNs-ключ в EAS. Без них приложение работает, но
  уведомления не приходят. Подробно — [docs/store-distribution.md](../docs/store-distribution.md).

### 10. Проверка «всё работает»

- [ ] `https://admin.<домен>` открывается с замком, вход по коду работает
- [ ] `curl -s https://api.<домен>/readyz` → `"status":"ok"`
- [ ] тестовое сообщение пришло в Telegram/почту
- [ ] `sudo ./deploy/restore.sh --list` показывает копию в `daily/`
- [ ] загрузили видео в админке и посмотрели его с телефона
- [ ] `.env.production` лежит в менеджере паролей

### Жизнь после запуска

| Что | Как |
|---|---|
| Обновить | `sudo /opt/clubspace/deploy/update.sh` — бэкап → сборка → нужные миграции → переключение → проверка; при сбое сам откатывается и пишет в Telegram |
| Бэкап | каждую ночь в 03:30 (`systemctl list-timers 'clubspace-*'`); 7 ежедневных, 4 еженедельных, 6 ежемесячных копий |
| Проверка восстановления | 2-го числа каждого месяца, отчёт приходит алертом |
| Восстановить базу | `sudo ./deploy/restore.sh --list`, затем `--to-production <копия> --yes` |
| Алерты | сайт недоступен, `/readyz` не ok (в т. ч. сломалась почта), контейнер упал, диск > 85 %, бэкапу > 30 ч, сертификат истекает < 14 дн. |
| Логи | `cd /opt/clubspace && docker compose -f docker-compose.prod.yml --env-file .env.production logs -f server` |
| Перезагрузка после обновления ядра | если есть `/var/run/reboot-required` — `sudo reboot` в тихий час; стек поднимется сам |

**Видео и диск.** Видео хранятся в MinIO на диске VDS. Из 80 ГБ под видео
остаётся примерно 40–50 ГБ (система, образы Docker и база занимают остальное);
алерт по диску сработает на 85 %. Когда видео станет больше — увеличьте диск
у провайдера (без переустановки) или возьмите тариф крупнее.

**Безопасность входа на сервер.** Firewall и fail2ban включены. Когда вход по
SSH-ключу проверен, отключите вход по паролю: `PasswordAuthentication no` в
`/etc/ssh/sshd_config`, затем `sudo systemctl reload ssh`.

## Prerequisites

- A host with Docker Engine 24+ and the Compose v2 plugin
  (`curl -fsSL https://get.docker.com | sh`). Ubuntu 22.04+ / Debian 12+.
- **Ports 80 and 443** either free for the bundled Caddy, or already owned by a
  reverse proxy you keep (nginx-proxy-manager, Traefik, nginx) — see *Behind an
  existing reverse proxy* below. `deploy/init.sh` detects which and picks the
  matching mode.
- **A public IPv4 that reaches this host on ports 80 and 443.** On a home
  connection, verify all three before going further:
  - the address in the router's WAN status equals `curl -s ifconfig.me`
    (if it does not, the ISP has you behind CGNAT and port forwarding cannot
    work — you need a tunnel or a small VPS in front);
  - ports 80 and 443 are forwarded to this host
    (`ufw allow 80,443/tcp && ufw allow 443/udp`);
  - port 80 is not blocked upstream. Caddy proves domain ownership over HTTP-01
    on port 80; if the ISP blocks it, no certificate is ever issued.
- **Four A-records, all pointing at this host, all resolving before first start:**

  | Record | Serves | Why it cannot be skipped |
  |---|---|---|
  | `api.<domain>` | the NestJS API | every client call |
  | `admin.<domain>` | the admin panel | where you run the club |
  | `app.<domain>` | the student web app | the browser alternative to the APK |
  | `s3.<domain>` | object storage | uploads and video segments go **directly** here on presigned URLs; the API never proxies them |

  Caddy requests a certificate per hostname at startup. A record that does not
  resolve yet means that one site stays down while the others work — and failed
  validations count against Let's Encrypt's rate limit, so premature starts are
  not free. `deploy/init.sh` checks all four for you before touching Docker.
- A working outbound SMTP relay — see *Email* below. Not optional.

**A note on home uplink.** Students stream video from this box. A 720p viewer
costs ~2.5 Mbit/s, so a 30 Mbit/s uplink carries roughly eight at once. If yours
is slower or the group grows, move MinIO to a small VPS — no code changes, only
the `s3.` record, the two `S3_INTERNAL_URL` lines in `docker-compose.prod.yml`
(point them at the VPS) and a data copy. Also enable SQM / fq_codel on the router if it
offers it: without it, one person watching video adds seconds of latency to
everything else in the house.

## Email

Sign-in is an emailed OTP; `/readyz` fails when the transport is unusable.
Sending directly from a residential IP will land in spam, so use a relay
(Resend, Postmark, Brevo, Yandex 360 — any of them). Set `SMTP_URL` and
`SMTP_NO_REPLY_EMAIL`, and add SPF, DKIM and DMARC records for the domain,
or Gmail will quietly bin the codes.

## First-time bring-up

```bash
git clone https://github.com/<org>/clubspace.git
cd clubspace

./deploy/init.sh \
  --domain your-domain.com \
  --admin-email you@example.com \
  --smtp-url 'smtps://user:pass@smtp.provider.com:465'
```

That checks DNS, generates every secret, writes `.env.production` with mode
0600, builds and starts the stack, waits until `/readyz` reports ok, and prints
a suggested key for your first club.

Useful flags: `--club-key <key>` to choose that suggested key yourself (default:
the domain's first label), `--skip-dns` when the host is not publicly reachable
yet, `--dry-run` to see the generated env file without writing anything.

Re-running is refused once `.env.production` exists. Those secrets sign the live
sessions and encrypt stored data, so regenerating them would sign everyone out
of a working install. `--force` overrides, and is almost never what you want.

### Exposing only this stack, on a host that runs other things

A home server usually already serves a few private things — photos, dashboards,
automation — behind a reverse proxy on 80/443. Opening those ports on the router
would put **all of it** on the internet, which is rarely what anyone wants.

Give this stack its own Caddy on different host ports and let the router decide
what the outside world reaches:

```bash
./deploy/init.sh --domain your-domain.com --caddy-ports 8080:8443 ...
```

Then forward, on the router, external `80 -> 8080` and `443 -> 8443`. The result:

- the internet reaches this stack and nothing else — the existing proxy keeps
  listening on 80/443, but the router never hands it a packet from outside;
- public URLs stay clean, with no port in them, because the translation happens
  at the router;
- certificates still issue, since ACME HTTP-01 arrives on external 80.

Note that verifying from the server itself may fail even when everything works:
many home routers will not send a machine's own traffic back in through the
public address. Check from elsewhere — a phone on mobile data is enough.

### When the ISP blocks 443

Residential connections often drop inbound 80 and 443 while passing everything
else. Check before assuming the worst — and check from somewhere that is not
your own network, since a VPN or a router that does not hairpin will lie to you.
`https://check-host.net/check-tcp?host=<ip>:443` probes from several countries.
Read the answers carefully: *connection refused* means the packets arrive and
nothing is listening, which is good news; *timed out* means they are dropped.

If a high port answers and 443 does not, serve on the high port:

```bash
./deploy/init.sh --domain your-domain.com --public-port 8443 ...
```

Two things follow from that, both mandatory:

- **Certificates must come from the DNS challenge.** ACME HTTP-01 needs port 80,
  which is exactly what is blocked. nginx-proxy-manager and Caddy both support
  DNS challenges, DuckDNS included.
- **The port is baked into the app build**: pass `--public-port` to
  `scripts/set-mobile-target.sh` as well, or the APK will call the wrong origin.

Once the ISP opens 443, drop `--public-port`, rebuild the web images and the
APK, and the URLs go back to normal.

### Behind an existing reverse proxy

If the host already serves other things on 80/443, the bundled Caddy cannot bind
them. `init.sh` notices and switches to overlay mode automatically
(`--behind-proxy` forces it, `--with-caddy` forces the other way). The overlay
joins your proxy's Docker network — `shared-net` by default, override with
`PROXY_NETWORK=<name>` — and publishes no host ports at all, so nothing of this
stack is exposed on the LAN.

Add four proxy hosts, all plain HTTP; your proxy terminates TLS:

| Hostname | Target |
|---|---|
| `api.<domain>` | `http://clubspace-api:3000` |
| `admin.<domain>` | `http://clubspace-admin:3000` |
| `app.<domain>` | `http://clubspace-app:3000` |
| `s3.<domain>` | `http://clubspace-s3:9000` |

**On the `s3.` host, lift the upload limit and pass on only what browsers
send.** nginx caps request bodies by default, and video uploads go through this
host — a large file is cut off mid-flight with no useful error. Browsers and
phones only ever GET/HEAD objects, PUT one object (the presigned upload) and
send the CORS preflight; MinIO's admin API under `/minio/`, bucket listings,
DELETE and POST have no business on the public name (the server and the worker
reach MinIO directly on the internal network). In nginx-proxy-manager's
*Advanced* box, with the default bucket name `clubspace`:

```
client_max_body_size 0;
proxy_request_buffering off;
location ~ ^/clubspace/.+ {
    limit_except GET HEAD PUT OPTIONS { deny all; }
    proxy_set_header Host $http_host;   # signatures cover the Host header
    proxy_pass http://clubspace-s3:9000;
}
location / { return 403; }
```

The bundled Caddy applies the same rule (`deploy/Caddyfile`).

Running the compose commands yourself in this mode means passing both files:

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.proxy.yml \
  --env-file .env.production up -d
```

<details>
<summary>Doing it by hand instead</summary>

```bash
cp .env.production.example .env.production
# Fill in DOMAIN, ACME_EMAIL, the passwords and secrets, SUPER_ADMIN_EMAIL and SMTP_URL.
# Generate secrets with: openssl rand -hex 64  (32 for ENCRYPTION_SECRET)
docker compose -f docker-compose.prod.yml --profile caddy \
  --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f server
```

Everything hostname-shaped — `ROOT_URL`, the JWT issuer and audience,
`CORS_ORIGINS`, the API URL baked into the web bundles and the S3 endpoint — is
derived from `DOMAIN` in `docker-compose.prod.yml`. Setting those in the env
file has no effect.

The server refuses to start if `JWT_SECRET` or `PLAYBACK_TOKEN_SECRET` is under
32 characters or if the two are equal — deliberately, since a weak or shared
signing secret silently accepts forged tokens and playback URLs.

There is no admin password to set anywhere. Sign-in is OTP-only.
</details>

## Verify

```bash
# Liveness — the process is up.
curl -sf https://api.<domain>/healthz && echo OK

# Readiness — db, redis, smtp and the video worker are all usable. Check this
# after every deploy: a broken SMTP config locks everyone out while the app
# looks perfectly healthy.
curl -s https://api.<domain>/readyz | tee /dev/stderr | grep -q '"status":"ok"' \
  && echo READY || echo 'NOT READY — see checks above'

# Storage is published and the bucket policy is right. The first must NOT be
# 200 (private), the second must not be 403 (thumbnails are read anonymously).
curl -s -o /dev/null -w 'hls: %{http_code}\n' https://s3.<domain>/clubspace/hls/probe
curl -s -o /dev/null -w 'thumbnails: %{http_code}\n' https://s3.<domain>/clubspace/thumbnails/probe

# The public storage name refuses everything browsers never send. Both must
# be 403 with an EMPTY body (the proxy's refusal, not MinIO's XML error).
curl -s -w ' admin: %{http_code}\n' https://s3.<domain>/minio/admin/v3/info
curl -s -X DELETE -w ' delete: %{http_code}\n' https://s3.<domain>/clubspace/thumbnails/probe

# The bucket bootstrap ran and created both service accounts.
docker compose -f docker-compose.prod.yml --env-file .env.production logs minio-init
```

A `403` on the `thumbnails/` probe, or no `service account clubspace-server`
/ `clubspace-worker` lines in the log, means `minio-init` did not finish —
rerun it with
`docker compose -f docker-compose.prod.yml --env-file .env.production up minio-init`.

## Your club, and the first students

1. **Sign in to the admin panel** at `https://admin.<domain>` with
   `SUPER_ADMIN_EMAIL`. The code arrives by email — there is no password.
2. **Create the club** in the platform console at `/platform`: name plus owner
   email. The club gets a key (a Cyrillic name is transliterated — "Академия
   БЖЖ" becomes `akademiya_bzhzh`) and a join code.
3. **Point the app at your server**, on the machine that builds the APK:

   ```bash
   ./scripts/set-mobile-target.sh --domain <domain> --support-email <email>
   ```

   The app is the neutral «ClubSpace» club picker: no club is baked into it.
   Students sign in and join by the club's code, its link or its QR code (admin:
   Участники → «Пригласить учеников»), or you invite them by e-mail. A club that
   wants its own branded app publishes it from its own developer account — see
   [docs/store-distribution.md](../docs/store-distribution.md).

   `--support-email` and the `app.<domain>` web URL it derives are what the
   app's Support, Privacy, Terms and account-deletion links point at. Release
   builds (`production`, `store`) refuse to start if any of these are still
   placeholders.

4. **Build and hand out the APK:**

   ```bash
   cd apps/mobile
   npx eas build --profile production --platform android
   ```

   EAS generates a signing keystore on the first build. **Save it**
   (`npx eas credentials`). Lose it and no future build can install over the one
   your students already have — they would have to delete the app first.

   For Google Play use the `store` profile instead. The two profiles in
   `apps/mobile/eas.json` differ only in the artifact: `production` is an APK for
   hand distribution (a file you give students), `store` is an AAB for Play,
   which rejects APKs. `store` extends `production`, so both share the same env
   (API URL, web URL, support email) that `set-mobile-target.sh` wrote.
   (eas.json is strict JSON-schema: it cannot carry comments, so this is where
   that is written down.) Push notifications additionally need `EAS_PROJECT_ID`
   and `GOOGLE_SERVICES_FILE` — see
   [docs/store-distribution.md](../docs/store-distribution.md).

   ```bash
   npx eas build --profile store --platform android
   npx eas submit --profile store --platform android
   ```

   Two Play-specific rules:

   - **The first upload must be done by hand** in the Play Console; `eas submit`
     only works for an app that already exists there.
   - **Students who sideloaded the APK can upgrade from Play only if both are
     signed with the same key.** When you create the app in Play, choose "use my
     own key" and upload the EAS keystore (`npx eas credentials`) as the app
     signing key. Let Play generate its own and the sideloaded installs can no
     longer be updated over it.

   Students need "install from unknown sources" enabled for whatever app opens
   the file. Play Protect will warn about an unknown developer; that is expected
   for a hand-distributed build.

5. **Two ways in for the first group** — pick either:

   - **They sign themselves up.** Each opens the app, enters their email, gets a
     code. This creates an `INVITED` membership in your club, which shows up in
     the admin under *Пользователи* → «Ожидают одобрения». Press «Принять» and
     they become full members. Best when you want to confirm each person.
   - **You add them first.** In the admin, import a list of emails. Each becomes
     an `ACTIVE` member immediately, and they just sign in. Faster for a known
     group, and nobody waits on your approval. Importing an email that already
     has a pending membership promotes it, so the two paths mix safely.

6. **Upload a video and watch it back on a phone** before telling anyone the app
   is ready. This is the only check that exercises the whole chain at once:
   presigned upload to storage → worker transcode → manifest proxy → segment
   playback. If the `s3.` record or the bucket policy is wrong, this is where you
   find out, not the students.

## Known gaps at first install

- **Push notifications do not arrive.** The server sends through Expo's push
  service, but an Android build needs FCM credentials uploaded to your EAS
  project first. Without them the app registers no token and fails silently by
  design — nothing crashes, notifications simply never appear.
- **Video is capped at 720p.** The HLS ladder deliberately omits a 1080p rung so
  a home uplink can serve several viewers at once. Restore it in
  `apps/video-worker/src/main.ts` when egress no longer rides that link.
- **Uploads are vetted before transcoding.** The worker probes every file and
  accepts only MP4/MOV and MKV/WebM containers with a video track, up to
  `MAX_VIDEO_UPLOAD_MB` (at most 5120 — one browser PUT) and
  `MAX_VIDEO_DURATION_MINUTES` (240). Anything else fails at once with a reason
  the coach sees next to the video, instead of after three retries. Failed
  transcode jobs stay in Redis for 7 days for inspection.

## Updates

```bash
sudo ./deploy/update.sh            # or --ref <tag>; --help for the rest
```

It fast-forwards the checkout, adds settings the template gained to
`.env.production` (never changing existing values), builds the four app images
one at a time while the old containers keep serving, takes an encrypted backup
to S3, runs the one-off data migrations from `apps/server/scripts/` **only when
the database still has the shape they migrate from** (detected per script —
e.g. `WorkspaceBilling.planId` still present), runs `prisma db push` with the
new image, switches containers and smoke-checks: server healthy and `/healthz`
inside the container, worker and web apps running without restarts. Any
failure puts the previous images and checkout back and alerts; success alerts
too. Downtime is the seconds each container takes to restart (longer when a
data migration has to stop the apps first).

By hand, the equivalent is:

```bash
git pull
./deploy/backup-now.sh        # fresh verified dump first; stops here if it fails
docker compose -f docker-compose.prod.yml --env-file .env.production build server video-worker admin client
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
docker image prune -f
```

Rebuild all four app images together. The worker reads the same schema as the
server, and the admin/client bundles speak the same API — an admin left on the
old image is sending requests the new server was written for.

**Upgrading an install from before storage service accounts.** The server and
the worker no longer use MinIO's root keys: `minio-init` creates an account for
each, and compose refuses to start until their secrets exist. Before the
`up -d` above, append to `.env.production`:

```bash
cat >> .env.production <<EOF
S3_SERVER_ACCESS_KEY_ID=clubspace-server
S3_SERVER_SECRET_ACCESS_KEY=$(openssl rand -hex 32)
S3_WORKER_ACCESS_KEY_ID=clubspace-worker
S3_WORKER_SECRET_ACCESS_KEY=$(openssl rand -hex 32)
EOF
```

`up -d` then runs `minio-init` before the apps start. Also lower
`MAX_VIDEO_UPLOAD_MB` to `5120` or less if it is higher: uploads are a single
S3 PUT, which tops out at 5 GiB, and the server and worker now refuse to boot
above that rather than fail each oversized upload at the very end.

`update.sh` takes its own encrypted backup to S3 first (`backup-s3.sh`). By
hand, `./deploy/backup-now.sh` takes a fresh verified local dump instead — `up
-d` does not restart an unchanged `db-backup` container, so without it an update
runs on yesterday's dump. In reverse-proxy mode pass the compose files it should
use: `COMPOSE="docker compose -f docker-compose.prod.yml -f docker-compose.proxy.yml --env-file .env.production" ./deploy/backup-now.sh`.

The server runs `prisma db push` at startup, so an **additive** schema change
(new table, new column with a default) applies on the next `up -d`. A change
that would **drop** data is refused instead — see below.

`NEXT_PUBLIC_API_URL` is baked into the web bundles at build time, so rebuild
the `admin` and `client` images whenever the domain changes:
`docker compose -f docker-compose.prod.yml --env-file .env.production build admin client`.

The same applies to the contact details on the public `/legal/*` pages
(`https://app.<domain>/legal/privacy`, `/legal/terms`, `/legal/delete-account`).
`init.sh` writes them to `.env.production` — `--support-email` (defaults to
`--admin-email`), `--legal-operator` (name of the data operator) and
`--legal-address` (optional) — and the client image bakes them in as
`NEXT_PUBLIC_SUPPORT_EMAIL` / `NEXT_PUBLIC_LEGAL_OPERATOR` /
`NEXT_PUBLIC_LEGAL_ADDRESS`. Rebuild `client` after changing them. When unset,
the pages fall back to the default operator in `apps/client/src/shared/lib/legal.ts`.
`CONSENT_VERSION` (default `2026-11-01`) is the edition of the personal-data
consent: compose passes it to the server and bakes it into `/legal/consent`;
bumping it (and rebuilding `client`) makes every user re-accept in the apps.

### Join links, club pages and app links on `app.<domain>`

`app.<domain>` (the `client` service) now answers every link the server hands
out:

- `/` — the public landing for clubs: what ClubSpace does, prices and a
  calculator read from the server's billing config (`GET /public/pricing`,
  `POST /public/pricing/quote` — the same `PLATFORM_PLANS`, `PLATFORM_MODULES`,
  `PLATFORM_ANNUAL_DISCOUNT_PERCENT`, `PLATFORM_SETUP_FEE`, `PLATFORM_TRIAL_DAYS`
  every club is billed by; a change shows up within five minutes of the server
  restart), FAQ and the «Показать демо» form. Demo requests land in the platform
  console («Заявки на демо») and are mailed to `SUPER_ADMIN_EMAIL`; the form is
  limited to 5 requests an hour per address. «Попробовать» leads to
  `<ADMIN_URL>/sign-up` when `SELF_SERVE_SIGNUP_ENABLED=true`, otherwise to the
  demo form. A signed-in student opening `/` is sent on to `/courses`.
  `robots.txt` lets crawlers index `/`; `sitemap.xml` lists the public pages.
- `/join/<code>` — the target of invite e-mails, the owner welcome e-mail and
  the QR poster. It previews the club (name, logo, city, gyms, weekly schedule,
  «О клубе» contacts), opens the app via `clubspace://join/<code>`, offers the
  store buttons and «Открыть в браузере», and shows the code for manual entry.
  An unknown or rotated code gets a friendly «Приглашение не найдено» (404).
- `/c/<slug>` and `/clubs` — the public page and the catalog of clubs that
  enabled «Показывать клуб в каталоге» in the admin («Публичная страница»).
  Unlisted clubs answer 404 there and never appear in search.
- `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json`
  — Universal Links / App Links for `/join/*`, `application/json`, 404 until
  configured.

These read the **client container's runtime environment** (a restart applies a
change, no rebuild). Set them in `.env.production`; unset means the button or
file is left out:

| Variable | Used for |
|---|---|
| `APP_STORE_URL`, `PLAY_STORE_URL`, `RUSTORE_URL` | store buttons on `/join` (the server also puts them in e-mails) |
| `PWA_URL` | «Открыть в браузере»: opens `${PWA_URL}/join/<code>` in the installable web app |
| `APPLE_TEAM_ID`, `IOS_BUNDLE_ID` | AASA; `IOS_BUNDLE_ID` may list several bundle ids, comma-separated |
| `ANDROID_PACKAGE`, `ANDROID_CERT_SHA256` | `assetlinks.json`; both comma-separated (e.g. the Play app-signing key and the upload key) |
| `ADMIN_URL`, `SITE_URL` | set by compose to `https://admin.<domain>` / `https://app.<domain>`: the landing's «Попробовать» link, canonical / Open Graph / sitemap URLs |

Check after deploy:

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://app.<domain>/join/<a real code>   # 200
curl -sI https://app.<domain>/.well-known/assetlinks.json | grep -i content-type  # application/json
```

The page talks to the API over the compose network (`API_INTERNAL_URL`, set in
`docker-compose.prod.yml`) and caches each answer for a minute.

### A schema change refused to apply

The server container exits and restarts in a loop, and its log ends with Prisma
listing what it would drop and *"Use the --accept-data-loss flag…"*. Nothing
has been deleted. Decide whether losing that data is intended, then:

```bash
# 1. a fresh verified dump — prints "ok: … restore check" or stops here
./deploy/backup-now.sh

# 2. apply the change deliberately
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm --entrypoint sh server -c \
  './node_modules/.bin/prisma db push --schema=./prisma/schema.prisma --url "$DATABASE_URL" --accept-data-loss'
docker compose -f docker-compose.prod.yml --env-file .env.production up -d server
```

### Billing v2 (active-member tiers) — one-time data migration

The update that replaced the Free / Club / Pro plans drops the `PlatformPlan`
table and `WorkspaceBilling.planId`, so its schema would be refused as above.
Run the shipped migration once, after a fresh backup and before starting the
new server: it maps every club that is not suspended onto a fresh trial (at
least 30 days, never ending before a period already paid), gives clubs
without a billing row the same trial, and removes the old plan data — the
push on boot is then purely additive.

```bash
./deploy/backup-now.sh
docker compose -f docker-compose.prod.yml --env-file .env.production exec -T postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < apps/server/scripts/migrate-billing-v2.sql
docker compose -f docker-compose.prod.yml --env-file .env.production up -d server
```

Then set each club's modules, prices and paid periods in the platform console.

### Parallel abonements (direction sets) — one-time data migration

The update that lets a tariff cover a set of directions and a member hold
several abonements at once replaces `Plan.directionId` with the
`PlanDirection` table (and a scope snapshot on every sold abonement,
`SubscriptionDirection`) and drops the single "current abonement" pointer
`WorkspaceMember.subscriptionId`, so its schema would be refused as above. Run
the shipped migration once, after a fresh backup and before starting the new
server: it copies each tariff's direction into the new tables (the abonements
sold on it keep being drawn by that direction only), records which abonement
past visits were deducted from, closes as «Истёк» the live abonements the old
pointer had already left behind (an old bug; a back-to-back renewal's
predecessor is kept) and drops the two columns — the push on boot is then
purely additive.

```bash
./deploy/backup-now.sh
docker compose -f docker-compose.prod.yml --env-file .env.production exec -T postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < apps/server/scripts/migrate-parallel-abonements.sql
docker compose -f docker-compose.prod.yml --env-file .env.production up -d server
```

Ship the new admin and mobile builds with it: the member-abonement endpoints
now return a list of current abonements instead of one.

### Card payments and autopay of clubs (platform YooKassa shop)

Clubs pay ClubSpace by card on the «Тариф» page; the card is saved and each
renewal is charged a day before the paid period ends (retries within
`PLATFORM_GRACE_DAYS`, the owner gets an e-mail and a push each time). Off until
the platform's own shop is configured — then only the console's «отметить оплату»
works, as before.

1. In the YooKassa dashboard of the **platform's** shop (not a club's): enable
   saved payment methods (автоплатежи) — YooKassa support turns it on per shop —
   and the online receipts (54-ФЗ) if you send them through YooKassa.
2. Settings → HTTP notifications: URL `https://api.<domain>/payments/webhooks/platform/yookassa`
   (i.e. `<ROOT_URL>/payments/webhooks/platform/yookassa`), events
   `payment.succeeded` and `payment.canceled`. Notifications are unsigned: the
   server re-reads every payment from the YooKassa API, so a forged call does nothing.
3. In `.env.production`:
   ```
   PLATFORM_YOOKASSA_SHOP_ID=<shopId>
   PLATFORM_YOOKASSA_SECRET_KEY=<live_… secret key>
   PLATFORM_RECEIPT_VAT_CODE=1            # 1 = без НДС … 11 = 22%
   # PLATFORM_RECEIPT_TAX_SYSTEM_CODE=2   # only for a shop with several tax systems
   ```
   `ADMIN_URL` (or an `api.<domain>` `ROOT_URL`) must resolve: YooKassa returns
   the owner to `<ADMIN_URL>/workspace/<id>/billing`.
4. `docker compose … up -d` — the schema change is additive (`PlatformPayment`,
   new nullable/defaulted columns), `db push` applies it without data loss.
5. Check: the club's «Тариф» page shows «Оплатить картой»; the platform console
   card shows the payments list, «Повторить списание сейчас», refunds and the
   autopay switch.

### Offer, DPA and seller requisites (clubs as customers)

Clubs buy ClubSpace under a public offer and a data processing instruction
(`app.<domain>/legal/offer`, `/legal/dpa`, `/legal/requisites`; drafts — see
`docs/legal/README.md`). The club owner's acceptance (who, when, IP, editions)
is recorded at self-serve sign-up, by the console («владелец уже принял
оферту»), on the owner's first card payment, or on the «Тариф» page.

1. Fill the seller's requisites in `.env.production` (`PLATFORM_SELLER_*`, see
   `.env.production.example`). Until NAME, INN, OGRNIP, ADDRESS, BANK_NAME, BIK
   and ACCOUNT are set, the API logs a warning at boot and **card payments and
   autopay of clubs stay off** in production; the pages show «заполняется».
2. Publishing a new edition: deploy the client with the new text first, then set
   `PLATFORM_OFFER_VERSION` / `PLATFORM_DPA_VERSION` to its effective date and
   restart the API. Owners see a banner; after
   `PLATFORM_LEGAL_ACCEPT_GRACE_DAYS` (14) days from that date their payments,
   card binding and module connection are refused until they accept.
3. Schema change is additive (`ClubLegalAcceptance`).

### Trial guards and «пробный период с картой»

A trial is bounded (`PLATFORM_TRIAL_*`, see `.env.production.example`): VIDEO
up to 2 ГБ stored and 10 h watched a month, no branded app, at most
`PLATFORM_TRIAL_EMAIL_LIMIT` e-mails from the club to people (sign-in codes are
never counted). The owner gets an e-mail and a push with the quote on trial
days 23 and 28 (hourly autopay pass); an unpaid club goes past due → suspended
as before and is archived `PLATFORM_ARCHIVE_AFTER_DAYS` after suspension
(hidden from members and the public listing; nothing deleted).

«Пробный период с картой» (off by default, `PLATFORM_CARD_TRIAL_ENABLED`; the
console switches it per club): the owner binds a card on «Тариф». YooKassa saves
a card only with a real payment (`save_payment_method`; zero-amount payments are
refused and the separate payment-methods API needs a manager to enable it), so
the card is bound with a `PLATFORM_CARD_CHECK_AMOUNT` (1 ₽) payment that is
refunded as soon as it succeeds. When the trial ends, the hourly autopay pass
charges the first period — with the setup fee — once. Schema change is additive.

## Rollback

`deploy/update.sh` rolls back by itself when the new version does not come up
(see *Updates*): the previous images are kept as `clubspace.local/<service>:rollback`
and re-tagged, the checkout is moved back and the old containers started. By
hand, the same:

```bash
for s in server video-worker admin client; do docker tag clubspace.local/$s:rollback clubspace.local/$s:latest; done
git log --oneline -5 && git checkout <previous-sha>
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --no-build
```

Data volumes are preserved — only the application image is rolled back. A
one-off data migration is not undone; for that, restore the backup `update.sh`
took first (`deploy/restore.sh --to-production <key> --yes`, the key is in the
update alert).

## Backups

Two things need backing up, and losing either one is unrecoverable: the database
(accounts, memberships, progress, schedule) and the object store (every video
anyone uploaded). Both are automatic — two services in the stack, nothing to
add to cron:

- **`db-backup`** — a dump when the container starts (`./deploy/backup-now.sh`
  forces one) and then every `BACKUP_INTERVAL_HOURS` (24). Each dump is **restored into a scratch database and checked** before it
  counts; only then are dumps older than `BACKUP_RETENTION_DAYS` pruned, and the
  newest `BACKUP_KEEP_MIN` are always kept, so a run of failures can never age
  out the last good ones. Files: `$BACKUP_DIR/db-<UTC timestamp>.dump`.
- **`media-backup`** — an incremental `mc mirror` of the bucket into
  `$BACKUP_DIR/media/`. One copy that grows as videos are added; deleting a
  video in the app does not delete it from the backup.

A failed round leaves `LAST_FAILURE` (database) or `LAST_MEDIA_FAILURE` (media)
in `$BACKUP_DIR` and is logged: `docker compose -f docker-compose.prod.yml --env-file .env.production logs
db-backup media-backup`.

**Off the machine.** `BACKUP_DIR` (default `/var/backups/clubspace`) is a host
path. On the same disk as the data it does not survive that disk dying, and on
the same host it does not survive the host being stolen, burnt or encrypted by
ransomware. A second disk or a NAS mount is better than nothing; a copy in
another building is the real thing — see *Off-host backups* below.

**Know when it stops.** Set `BACKUP_HEALTHCHECK_URL` to a healthchecks.io-style
ping URL. Every round pings it on success and `<url>/fail` on failure — database
*or* media — and the service alerts you when the pings stop or fail.

Restore the database (stops the apps and the backup job first, so nothing writes
or dumps mid-restore):

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production stop server video-worker db-backup
docker compose -f docker-compose.prod.yml --env-file .env.production exec -T postgres sh -c 'dropdb -U postgres clubspace && createdb -U postgres clubspace'
docker compose -f docker-compose.prod.yml --env-file .env.production exec -T postgres pg_restore -U postgres -d clubspace --no-owner \
  < /var/backups/clubspace/db-YYYY-MM-DDTHHMMSSZ.dump
docker compose -f docker-compose.prod.yml --env-file .env.production start server video-worker db-backup
```

Restore the object store from the mirror:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm --entrypoint sh media-backup -c \
  'mc alias set local http://minio:9000 "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" &&
   mc mirror --overwrite /backups/media/clubspace local/clubspace'
docker compose -f docker-compose.prod.yml --env-file .env.production up minio-init   # re-applies the bucket policy
```

The mirror is a plain directory tree, so restored objects lose their stored
Content-Type and come back as `application/octet-stream`. Video playback is
unaffected (the manifest proxy sets types); thumbnails without a file extension
may need to be re-uploaded.

### Off-host backups (S3, encrypted)

`deploy/backup-s3.sh` runs nightly (systemd timer `clubspace-backup`, 03:30)
and before every `update.sh`:

1. `pg_dump -Fc` from the running Postgres, plus the exact row count of every
   table (`*.counts.tsv`);
2. checks the dump lists as many tables as the database has, encrypts it with
   AES-256 (`BACKUP_ENCRYPTION_KEY`, PBKDF2) and proves it decrypts back;
3. uploads to `<BACKUP_S3_BUCKET>/<BACKUP_S3_PREFIX>/db/daily/`; the first good
   backup of an ISO week / month is also copied to `weekly/` / `monthly/`;
4. keeps the newest 7 daily, 4 weekly, 6 monthly (`BACKUP_KEEP_*`);
5. with external S3, mirrors the video bucket to `<prefix>/media/` (new and
   changed objects; a deletion in the app is not propagated);
6. alerts on any failure; `healthcheck.sh` alerts when the last success is
   older than 30 h.

Where it goes is one setting. `BACKUP_S3_ENDPOINT` empty → the stack's own
MinIO (bucket created on demand): protects against a bad update or a dropped
table, **not** against losing the server. Set it to any external S3 (Selectel
`https://s3.ru-1.storage.selcloud.ru`, Timeweb `https://s3.twcstorage.ru`,
Yandex, Backblaze…) with `BACKUP_S3_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` and an
existing `BACKUP_S3_BUCKET` for the real thing. The app containers never see
these keys (blanked in `docker-compose.prod.yml`).

**Store `BACKUP_ENCRYPTION_KEY` — in fact the whole `.env.production` — in a
password manager, off this machine.** Without the key no backup can be read;
without `ENCRYPTION_SECRET` and the JWT secrets a restored database comes back
with unreadable encrypted fields and every session invalid.

```bash
sudo ./deploy/restore.sh --list                              # what is in S3
sudo ./deploy/restore.sh --check latest                      # restore into a throwaway container, compare row counts
sudo ./deploy/restore.sh --download latest /root/db.dump     # decrypted pg_restore archive
sudo ./deploy/restore.sh --to-production daily/db-<stamp>.dump.enc --yes
```

`--to-production` stops `server`, `video-worker` and `db-backup`, saves the
current database to `/var/lib/clubspace/pre-restore-<stamp>.dump`, recreates the
database from the backup and starts them again. Videos from the S3 mirror:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm --no-deps --entrypoint sh media-backup -c \
  'mc alias set local http://minio:9000 "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" &&
   mc alias set bk <BACKUP_S3_ENDPOINT> <key id> <secret> &&
   mc mirror --overwrite bk/<bucket>/<prefix>/media/clubspace local/clubspace'
docker compose -f docker-compose.prod.yml --env-file .env.production up minio-init
```

### Restore check — monthly, automatic

A backup nobody has restored is a hope, not a backup. On the 2nd of every
month `clubspace-restore-check.timer` runs `restore.sh --check latest --report`:
it downloads and decrypts the newest daily backup, restores it into a scratch
`postgres` container with no network, and compares every table's row count with
the counts recorded at backup time (tolerance 1 % or 5 rows — rows written in
the second between dump and count). The result — pass or fail, with the
largest tables and the time the restore took — arrives as an alert. Production
is not touched.

Once a year, also rebuild on another machine from nothing but the bucket and
the password manager: `bootstrap.sh` on a fresh VDS with the saved
`.env.production` copied to `/opt/clubspace/` first, then
`restore.sh --to-production latest --yes` and the media mirror above. Time it —
that is your real recovery time. The recovery point is the last nightly dump,
so up to a day of attendance and payments can be lost; when that stops being
acceptable, move Postgres to a managed service with point-in-time recovery.

## Monitoring

Sign-in is a code sent by email, so a dead mail relay locks everyone out. The
server now notices: after a failed delivery it re-checks SMTP before issuing the
next code and, while mail is down, answers with an explicit "почта временно не
работает" error that the apps show — instead of a code that never arrives.
`deploy/healthcheck.sh` watches the rest every 5 minutes (systemd timer
`clubspace-healthcheck`, installed by `bootstrap.sh`) and alerts to Telegram
and/or e-mail — no paid service: public `/healthz` (and, when it fails, whether
the server container itself still answers), `/readyz` (database, Redis, SMTP),
every compose service running and not unhealthy, disk usage of `/`, Docker's
data dir and `BACKUP_DIR` (`ALERT_DISK_PERCENT`, 85), age of the last S3 backup
(`ALERT_BACKUP_MAX_AGE_HOURS`, 30), the local backup failure markers, and the
TLS certificates of all four names (`ALERT_CERT_MIN_DAYS`, 14). A failing check
alerts once, again every `ALERT_REPEAT_HOURS` (6) while it stays down, and once
more when it recovers. `sudo ./deploy/healthcheck.sh --test-alert` checks the
channels. It runs on the box it watches, so it cannot report the box itself
being off — for that, also point a free external monitor (UptimeRobot,
healthchecks.io) at `https://api.<domain>/readyz`.

## Caveats

- **There is no migration history.** The schema is applied with `prisma db
  push`. Additive changes apply on boot; anything that would drop data stops
  the server until you apply it deliberately (*Updates* above). The verified
  nightly dump is the safety net either way.
- **MinIO comes from Chainguard's build.** MinIO stopped publishing community
  images, archived its repository and removed the images from Docker Hub;
  quay.io refuses anonymous pulls too. `cgr.dev/chainguard/minio` is built from
  source and free, and reads volumes the old image wrote (it runs as root for
  exactly that). Chainguard only publishes floating `latest` tags, so both
  images are pinned by digest in the compose files; bump them deliberately
  (`docker buildx imagetools inspect cgr.dev/chainguard/minio:latest-dev`).
  Set `MINIO_IMAGE` / `MINIO_CLIENT_IMAGE` to use another build.
  Upstream is frozen, so plan a move to another S3-compatible store eventually.
- **Storage accounts.** `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` are MinIO's
  root keys and only `minio-init` and `media-backup` hold them. `minio-init`
  (`deploy/minio-init.sh`) creates two service accounts on every run:

  | Account | Used by | Allowed |
  |---|---|---|
  | `clubspace-server` (`S3_SERVER_*`) | API | read, write, delete objects in the bucket; list it. Presigned upload and playback URLs act with these rights |
  | `clubspace-worker` (`S3_WORKER_*`) | video worker | read `raw/*`; write and delete `hls/*`; list `hls/` |

  Neither can create buckets, change policies or reach the admin API. To rotate
  a secret, change it in `.env.production`, then
  `docker compose -f docker-compose.prod.yml --env-file .env.production up -d minio-init server video-worker`.
  The worker container gets no `.env.production` at all — only the handful of
  variables it reads — since it is the one parsing untrusted uploads.
- **The public `s3.` name serves objects, nothing else.** Caddy passes only
  GET/HEAD/PUT/OPTIONS on `/<bucket>/<key>`; the server and the worker do their
  listings and deletes against `http://minio:9000` on the internal network.
- **Postgres, Redis and MinIO are not exposed to the host.** They are reachable
  only on the internal `bjj_net` network. For a `psql` shell:
  `docker compose -f docker-compose.prod.yml --env-file .env.production exec postgres psql -U postgres -d clubspace`.
  MinIO's console (9001) is deliberately unpublished as well; use
  `docker compose -f docker-compose.prod.yml --env-file .env.production exec minio mc ...` for one-off
  commands, or forward the port over SSH if you want the web UI.
- **Bucket access policy.** The bucket is **private** so course videos cannot be
  fetched by guessing a key — playback works only through the membership-checked
  manifest proxy, which signs short-lived segment URLs. Only `thumbnails/*` and
  `subtitles/*` are anonymously readable, because the apps load those unsigned
  (plus `playlists/*`, where course covers lived before they moved under
  `thumbnails/`). `minio-init` in `docker-compose.prod.yml` sets this on first
  start; the dev stack mirrors it.
- **Caddy persists certificates** in the `caddy_data` named volume — never
  delete that volume unless you want to re-issue from Let's Encrypt, which is
  rate-limited.
- **Storage and the app share one uplink.** If viewers start buffering, the
  first thing to check is upstream bandwidth, not the server's CPU.
