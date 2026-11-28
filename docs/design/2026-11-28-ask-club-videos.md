# «Спросить ИИ по видео клуба»: answers from the club's own lessons

Status: **implemented** · 2026-11-28 · branch `feat/ask-club-videos`
Builds on: «Поиск по видео» (`features/search-videos`), content gating
([2026-11-01-content-gating.md](2026-11-01-content-gating.md)), the admin's «ИИ-ассистент» chat (`features/ai-chat`).

## Кратко (для владельца)

Ученик пишет вопрос своими словами («как выйти из маунта, если держат голову?») и получает короткий ответ,
собранный **только из расшифровок видео клуба**, со ссылками [1], [2] на моменты — нажатие открывает видео с
этой секунды. Если в видео клуба ответа нет, так и говорим: советов «от себя» модель не даёт. Ответ строится
только по тем видео, которые этот ученик может смотреть (закрытые и скрытые уроки не цитируются).

1. **Включает клуб:** «Настройки → Приложение учеников» → «ИИ-ответы по видео клуба» (по умолчанию выключено;
   переключатель виден, только когда у платформы есть ИИ-модель и видео клуба включены).
2. **В приложении:** «Видео → Поиск» — под полем появляется «Спросить ИИ по видео клуба» для набранного текста.
   Модель вызывается только по нажатию, не на каждую букву. Ответ — одна карточка над результатами поиска.
3. **Перед первым вопросом** человек один раз подтверждает, что вопрос уйдёт ИИ-сервису (App Store 5.1.2);
   согласие хранится на сервере, по клубу и редакции текста.
4. **Лимиты:** вопрос расходует месячный лимит ИИ клуба (общий с «ИИ-ассистентом» админки — строка «Вопросы к ИИ
   в этом месяце» на «Лимитах»), плюс не больше 10 вопросов в день на человека.
5. **Приватность:** ИИ-сервис получает вопрос (телефон и e-mail в нём скрываются, полные имена людей клуба
   заменяются псевдонимами, как в чате админки) и отрывки видео клуба — названия и то, что в них говорится.
   Данных профиля спрашивающего в запросе нет. Каждый вопрос — запись в «Истории изменений», как у чата.
6. **Профиль ребёнка:** в профиле ребёнка (родитель действует за ребёнка) функции нет — ни кнопки, ни ответа.

Не входит: история вопросов, чат с уточнениями, потоковый вывод ответа, поиск по смыслу (эмбеддинги).

## 1. Availability

`available = isLlmConfigured() && Workspace.videoAnswersEnabled && CourseAccessService.resolveMemberAccess passes`
(the same member/video gate as playback: ACTIVE, unexpired, club videos on, VIDEO module entitled; staff and the
owner pass). Coaches use it in the app like members; there is no extra admin UI beyond the switch.

**Not in a child profile.** Under `X-Act-As` (a guardian acting for a child) the state reports unavailable and
the notice and ask routes refuse with 403 — a child's questions don't go to a third-party model, and nobody
accepts the notice on a child's behalf. The app hides the action there as well.

## 2. API (`features/ask-club-videos`)

| Route | What |
| --- | --- |
| `GET  workspaces/:id/video-answers/state` | `{ available, noticeAccepted, notice: { version, title, text } }`; never refuses a member |
| `POST workspaces/:id/video-answers/notice` `{ version }` | stores `AiDataTransferAcceptance` (per user, edition `video-answers-2026-11-28`), audit `ai.videoAnswerNotice`; stale edition → 409 |
| `POST workspaces/:id/video-answers` `{ question }` (5–200) | `{ answer, answered, citations: [{ n, videoId, courseId, title, startAt, endAt, excerpt }] }` |

Errors, in order: not configured → 400; club switch off → 403; member/video gate → its own 403; no notice → 403;
club month used up / 10 a day → 429 `QUOTA_EXCEEDED`; model failure or the 30 s deadline → 503 `AI_UNAVAILABLE`
with a member-safe message (no provider or key details).

## 3. Retrieval without embeddings

1. **Expansion** — one model call returns `{"terms": […]}`: key words, technique names in Russian (as athletes
   say them) and English, synonyms. Not JSON → the question's own meaningful words.
2. **Glossary** — `@clubspace/sport-glossary` adds the canonical names of what was named: the technique's English
   spellings and Russian name (`findTechniques`) and the Russian ↔ English pair of a term (`SPORT_RUSSIAN_TERMS`).
   Single Russian words lose their case ending so `ILIKE` matches every form. ≤ 20 terms, ≥ 3 characters.
3. **Moments** — one SQL (`ask-club-videos.sql.ts`) over chapter titles, `VideoTranscript.segments` and
   `translations->'ru'` of the **watchable ready** videos (`watchableVideoIds`), `ILIKE ANY(patterns)`, each row
   scored by how many terms it names (+ title). `pickMoments` re-filters by the watchable set, ranks, keeps one per
   minute of a video, ≤ 2 per video, ≤ 6 in all.
4. **Excerpts** — the Russian translation (else the original) cues overlapping `[at − 10 s, at + 50 s]`, ≤ 1000
   characters; `startAt` = first cue's start, `endAt` = last cue's end.
5. **Answer** — second model call: answer only from the numbered excerpts, cite `[n]`, reply `NO_ANSWER` when they
   don't answer. `parseAnswer` expands `[1, 2]`, drops numbers that aren't excerpts, renumbers in order of
   appearance; nothing cited → the honest fallback (an uncited answer may be the model's own knowledge).

No watchable videos → the fallback without any model call and nothing counted. No moments found → the fallback
after the expansion call (counted).

## 4. Limits and audit

`AiChatUsage` gained `kind` (`'chat'` default, `'videoAnswer'`) and an index `[workspaceId, userId, createdAt]`.
The monthly allowance (`domains/ai-assistant/ai-allowance.ts`, used by the chat too) counts every row; the daily
cap (`DAILY_QUESTIONS_PER_MEMBER = 10`, club-local day) counts only `videoAnswer` rows of the user. Both caps are
checked and the row inserted in one transaction under `pg_advisory_xact_lock` on `ai-allowance:<club>` and
`video-answers:<club>:<user>`, so parallel questions can't all pass before any is counted (the admin chat still
checks then inserts; it is admin-only). The row is written before the first model call (a failure still counts)
and updated with tokens and status afterwards — a failed update is logged, never replacing the answer. Audit
`ai.videoAnswerQuestion` keeps the scrubbed question (first 200 characters, like the chat), term/excerpt/cited
counts, tokens, status and duration.

## 5. App

`VideoSearchScreen` reads the state once per club (errors = not offered). The secondary action appears for a typed
text of ≥ 5 characters; first use shows the notice (`showAlert`, a browser confirm on the PWA), accepting it sends
the notice then the question. `VideoAnswerCard` renders loading / error with «Повторить» / the answer with inline
citation chips, the cited lessons with their time, and «Ответ по видео клуба · может ошибаться». Editing the text
drops the answer. The request gets a 40 s client timeout (`HttpRequestConfig.timeout`, new) over the default 15 s.
A refusal (`FORBIDDEN`) or a stale notice (`CONFLICT`) re-reads the state: when the feature is gone or the notice
needs accepting again, the card clears and the next tap shows the current notice instead of retrying into the same
error. In a child profile the state isn't read and the action is never shown.
