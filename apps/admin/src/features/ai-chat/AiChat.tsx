'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Loader2,
  MessageSquarePlus,
  Send,
  Square,
  Trash2,
} from 'lucide-react';

import { Button, Textarea } from '@clubspace/ui-kit/ui';

import {
  type AiChatConversation,
  type AiChatConversationSummary,
  type AiChatEntity,
  type AiChatState,
  type AiChatStreamEvent,
  acceptAiChatWarning,
  askAiChat,
  deleteAiChatConversation,
  getAiChatConversation,
  getAiChatState,
  listAiChatConversations,
} from '../../shared/api/ai-chat';
import { errorMessage } from '../../shared/lib/error-message';
import { pluralRu } from '../../shared/lib/plural-ru';
import { ChatMarkdown } from './ChatMarkdown';

type Step = {
  id: string;
  tool: string;
  label: string;
  status: 'running' | 'done' | 'error';
};

// The turn being streamed right now.
type LiveTurn = {
  question: string;
  steps: Step[];
  answer: string;
  error: string | null;
  // A tool round happened since the last text: the next text starts a new
  // paragraph (the server joins the pieces the same way).
  breakBefore: boolean;
};

const newId = () => crypto.randomUUID();

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

function Steps({ steps }: { steps: Step[] }) {
  if (steps.length === 0) return null;
  return (
    <ul className="mb-2 flex flex-wrap gap-1.5">
      {steps.map((s) => (
        <li
          key={s.id}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground"
        >
          {s.status === 'running' ? (
            <Loader2 className="size-3 animate-spin" />
          ) : s.status === 'error' ? (
            <AlertCircle className="size-3 text-destructive" />
          ) : (
            <CheckCircle2 className="size-3 text-emerald-600" />
          )}
          {s.status === 'running' ? s.label : s.label.replace(/…$/, '')}
        </li>
      ))}
    </ul>
  );
}

function Turn({
  question,
  steps,
  answer,
  error,
  streaming,
  entities,
  workspaceId,
}: {
  question: string;
  steps: Step[];
  answer: string;
  error: string | null;
  streaming: boolean;
  entities: ReadonlyMap<string, AiChatEntity>;
  workspaceId: string;
}) {
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-primary px-4 py-2 text-sm text-primary-foreground">
          {question}
        </div>
      </div>
      <div className="flex gap-3">
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Bot className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <Steps steps={steps} />
          {answer && (
            <ChatMarkdown
              text={answer}
              entities={entities}
              workspaceId={workspaceId}
            />
          )}
          {streaming &&
            !answer &&
            steps.every((s) => s.status !== 'running') && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Думаю…
              </div>
            )}
          {error && (
            <p className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function ConsentCard({
  state,
  busy,
  onAccept,
}: {
  state: AiChatState;
  busy: boolean;
  onAccept: () => void;
}) {
  const [checked, setChecked] = useState(false);
  const { warning, canAccept } = state.consent;
  return (
    <section className="mx-auto max-w-2xl space-y-4 rounded-lg border border-border bg-card p-6">
      <h2 className="text-lg font-semibold">{warning.title}</h2>
      <div className="space-y-3 text-sm text-muted-foreground">
        {warning.text.split('\n\n').map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      {canAccept ? (
        <div className="space-y-3">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
            />
            Я владелец клуба и разрешаю передачу данных ИИ-сервису на этих
            условиях
          </label>
          <Button disabled={!checked || busy} onClick={onAccept}>
            Включить ИИ-ассистента
          </Button>
        </div>
      ) : (
        <p className="rounded-md bg-muted px-3 py-2 text-sm">
          Включить ИИ-ассистента может только владелец клуба — попросите его
          открыть эту страницу.
        </p>
      )}
    </section>
  );
}

// «ИИ-ассистент»: saved conversations on the left, the chat on the right.
export function AiChat({ workspaceId }: { workspaceId: string }) {
  const [state, setState] = useState<AiChatState | null>(null);
  const [conversations, setConversations] = useState<
    AiChatConversationSummary[]
  >([]);
  const [activeId, setActiveId] = useState<string>(newId);
  const [conversation, setConversation] = useState<AiChatConversation | null>(
    null,
  );
  const [entities, setEntities] = useState<Map<string, AiChatEntity>>(
    new Map(),
  );
  const [live, setLive] = useState<LiveTurn | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const loadList = useCallback(async () => {
    setConversations(await listAiChatConversations({ workspaceId }));
  }, [workspaceId]);

  const openConversation = useCallback(
    async (id: string) => {
      setActiveId(id);
      setLive(null);
      setError(null);
      try {
        const c = await getAiChatConversation({
          workspaceId,
          conversationId: id,
        });
        setConversation(c);
        setEntities(new Map(c.entities.map((e) => [e.token, e])));
      } catch (err) {
        setError(errorMessage(err, 'Не удалось открыть диалог'));
      }
    },
    [workspaceId],
  );

  useEffect(() => {
    let alive = true;
    Promise.all([
      getAiChatState({ workspaceId }),
      listAiChatConversations({ workspaceId }),
    ])
      .then(([s, list]) => {
        if (!alive) return;
        setState(s);
        setConversations(list);
        if (list[0]) void openConversation(list[0].id);
      })
      .catch(
        (err) =>
          alive &&
          setError(errorMessage(err, 'Не удалось загрузить ИИ-ассистента')),
      );
    return () => {
      alive = false;
      abortRef.current?.abort();
    };
  }, [workspaceId, openConversation]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [conversation, live]);

  const startNew = () => {
    abortRef.current?.abort();
    setActiveId(newId());
    setConversation(null);
    setEntities(new Map());
    setLive(null);
    setError(null);
  };

  const remove = async (id: string) => {
    if (!window.confirm('Удалить диалог? Его нельзя будет восстановить.'))
      return;
    try {
      await deleteAiChatConversation({ workspaceId, conversationId: id });
      if (id === activeId) startNew();
      await loadList();
    } catch (err) {
      setError(errorMessage(err, 'Не удалось удалить диалог'));
    }
  };

  const accept = async () => {
    if (!state) return;
    setBusy(true);
    try {
      setState(
        await acceptAiChatWarning({
          workspaceId,
          warningVersion: state.consent.warning.version,
        }),
      );
    } catch (err) {
      setError(errorMessage(err, 'Не удалось включить ИИ-ассистента'));
    } finally {
      setBusy(false);
    }
  };

  const onEvent = (e: AiChatStreamEvent) => {
    switch (e.event) {
      case 'text':
        setLive(
          (t) =>
            t && {
              ...t,
              answer:
                t.answer +
                (t.breakBefore && t.answer ? '\n\n' : '') +
                e.data.text,
              breakBefore: false,
            },
        );
        break;
      case 'tool':
        setLive((t) => {
          if (!t) return t;
          const known = t.steps.some((s) => s.id === e.data.id);
          const steps = known
            ? t.steps.map((s) => (s.id === e.data.id ? e.data : s))
            : [...t.steps, e.data];
          return { ...t, steps, breakBefore: true };
        });
        break;
      case 'entities':
        setEntities((m) => {
          const next = new Map(m);
          for (const x of e.data.entities) next.set(x.token, x);
          return next;
        });
        break;
      case 'done':
        setState((s) => s && { ...s, limit: e.data.limit });
        break;
      case 'error':
        setLive((t) => t && { ...t, error: e.data.message });
        break;
      case 'start':
        break;
    }
  };

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || live) return;
    const conversationId = activeId;
    const controller = new AbortController();
    abortRef.current = controller;
    setDraft('');
    setError(null);
    setLive({
      question,
      steps: [],
      answer: '',
      error: null,
      breakBefore: false,
    });
    let failed: string | null = null;
    try {
      await askAiChat({
        workspaceId,
        conversationId,
        question,
        signal: controller.signal,
        onEvent,
      });
    } catch (err) {
      failed = controller.signal.aborted
        ? 'Ответ остановлен'
        : errorMessage(err, 'Не удалось получить ответ');
    }
    abortRef.current = null;
    if (failed && !controller.signal.aborted) {
      // Refused before the stream (limit, consent…): nothing was saved.
      setLive(null);
      setDraft(question);
      setError(failed);
      return;
    }
    // The server saves the turn as the stream ends; a stopped one a moment later.
    if (controller.signal.aborted) await new Promise((r) => setTimeout(r, 600));
    await Promise.all([openConversation(conversationId), loadList()]).catch(
      () => undefined,
    );
    void getAiChatState({ workspaceId })
      .then(setState)
      .catch(() => undefined);
  };

  const turns = conversation?.turns ?? [];
  const limit = state?.limit;
  const ready = !!state && state.configured && state.consent.accepted;
  const canAsk = ready && !!limit && limit.remaining > 0;

  const historyPane = (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border">
      <div className="p-3">
        <Button
          variant="outline"
          className="w-full justify-start gap-2"
          onClick={startNew}
        >
          <MessageSquarePlus className="size-4" /> Новый диалог
        </Button>
      </div>
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {conversations.length === 0 && (
          <li className="px-2 py-1 text-xs text-muted-foreground">
            Пока нет сохранённых диалогов
          </li>
        )}
        {conversations.map((c) => (
          <li key={c.id} className="group relative">
            <button
              type="button"
              onClick={() => void openConversation(c.id)}
              className={`w-full rounded-md px-2 py-2 pr-8 text-left text-sm hover:bg-muted ${
                c.id === activeId ? 'bg-muted font-medium' : ''
              }`}
            >
              <div className="truncate">{c.title}</div>
              <div className="text-xs font-normal text-muted-foreground">
                {fmtDate(c.updatedAt)} · {c.questions}{' '}
                {pluralRu(c.questions, 'вопрос', 'вопроса', 'вопросов')}
              </div>
            </button>
            <button
              type="button"
              aria-label="Удалить диалог"
              onClick={() => void remove(c.id)}
              className="absolute right-1.5 top-2 hidden rounded p-1 text-muted-foreground hover:text-destructive group-hover:block"
            >
              <Trash2 className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );

  return (
    <div className="flex h-full min-h-[520px] overflow-hidden rounded-lg border border-border bg-card">
      {historyPane}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {error && (
            <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          {state && !state.configured && (
            <div className="mx-auto mb-6 max-w-2xl rounded-lg border border-amber-500/40 bg-amber-50 p-5 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              <div className="mb-1 font-semibold">ИИ-ассистент не настроен</div>
              На сервере не задан ключ ИИ-сервиса (AI_CHAT_API_KEY). Сохранённые
              диалоги можно читать, новые вопросы — после настройки. Обратитесь
              к администратору платформы.
            </div>
          )}
          {state && state.configured && !state.consent.accepted && (
            <ConsentCard
              state={state}
              busy={busy}
              onAccept={() => void accept()}
            />
          )}
          {ready && turns.length === 0 && !live && (
            <div className="mx-auto mt-10 max-w-xl text-center">
              <Bot className="mx-auto size-10 text-primary" />
              <h2 className="mt-3 text-lg font-semibold">
                Спросите о клубе обычными словами
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Ассистент смотрит данные{' '}
                {state.scope === 'club' ? 'всего клуба' : 'ваших направлений'} и
                отвечает со ссылками на учеников, группы и абонементы. Имена
                ИИ-сервису не передаются.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {state.suggestions.map((s) => (
                  <Button
                    key={s}
                    variant="outline"
                    size="sm"
                    disabled={!canAsk}
                    onClick={() => void send(s)}
                  >
                    {s}
                  </Button>
                ))}
              </div>
            </div>
          )}
          <div className="space-y-6">
            {turns.map((t, i) => (
              <Turn
                key={i}
                question={t.question}
                steps={t.steps.map((s, j) => ({
                  id: String(j),
                  tool: s.tool,
                  label: s.label,
                  status: s.isError ? 'error' : 'done',
                }))}
                answer={t.answer}
                error={t.error}
                streaming={false}
                entities={entities}
                workspaceId={workspaceId}
              />
            ))}
            {live && (
              <Turn
                question={live.question}
                steps={live.steps}
                answer={live.answer}
                error={live.error}
                streaming
                entities={entities}
                workspaceId={workspaceId}
              />
            )}
          </div>
          <div ref={bottomRef} />
        </div>
        <form
          className="border-t border-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send(draft);
          }}
        >
          <div className="flex items-end gap-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send(draft);
                }
              }}
              rows={2}
              maxLength={2000}
              disabled={!canAsk}
              placeholder={
                !ready
                  ? 'Чат станет доступен после настройки'
                  : limit && limit.remaining === 0
                    ? 'Лимит вопросов на этот месяц исчерпан'
                    : 'Например: кто из новичков перестал ходить?'
              }
              className="min-h-[44px] resize-none"
            />
            {live ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => abortRef.current?.abort()}
              >
                <Square className="size-4" /> Стоп
              </Button>
            ) : (
              <Button type="submit" disabled={!canAsk || !draft.trim()}>
                <Send className="size-4" /> Спросить
              </Button>
            )}
          </div>
          {limit && ready && (
            <div className="mt-1.5 text-xs text-muted-foreground">
              Осталось {limit.remaining} из {limit.perMonth}{' '}
              {pluralRu(limit.perMonth, 'вопроса', 'вопросов', 'вопросов')} в
              этом месяце · каждый вопрос попадает в «Историю изменений»
            </div>
          )}
        </form>
      </section>
    </div>
  );
}
