import type { ApiTypes } from '@clubspace/api-client';

import { environment } from '../../environments/environment';
import { getAccessToken, getApiClient } from './client';

// «ИИ-ассистент» chat (Аналитика → ИИ-ассистент): state, saved conversations
// and the streamed question.
export type AiChatState = ApiTypes.AiChatStateOutputOutput;
export type AiChatConversationSummary =
  ApiTypes.ListAiChatConversationsOutputOutput['data'][number];
export type AiChatConversation = ApiTypes.AiChatConversationOutputOutput;
export type AiChatTurn = AiChatConversation['turns'][number];
export type AiChatEntity = AiChatConversation['entities'][number];
export type AiChatLimit = AiChatState['limit'];

export const getAiChatState = async (params: {
  workspaceId: string;
}): Promise<AiChatState> =>
  getApiClient().request<AiChatState>({
    method: 'get',
    url: `/workspaces/${params.workspaceId}/ai-chat`,
  });

export const acceptAiChatWarning = async (params: {
  workspaceId: string;
  warningVersion: string;
}): Promise<AiChatState> =>
  getApiClient().request<AiChatState, ApiTypes.AcceptAiChatWarningInput>({
    method: 'post',
    url: `/workspaces/${params.workspaceId}/ai-chat/consent`,
    data: { warningVersion: params.warningVersion },
  });

export const listAiChatConversations = async (params: {
  workspaceId: string;
}): Promise<AiChatConversationSummary[]> =>
  (
    await getApiClient().request<ApiTypes.ListAiChatConversationsOutputOutput>({
      method: 'get',
      url: `/workspaces/${params.workspaceId}/ai-chat/conversations`,
    })
  ).data;

export const getAiChatConversation = async (params: {
  workspaceId: string;
  conversationId: string;
}): Promise<AiChatConversation> =>
  getApiClient().request<AiChatConversation>({
    method: 'get',
    url: `/workspaces/${params.workspaceId}/ai-chat/conversations/${params.conversationId}`,
  });

export const deleteAiChatConversation = async (params: {
  workspaceId: string;
  conversationId: string;
}): Promise<void> => {
  await getApiClient().request<
    ApiTypes.DeleteAiChatConversationOutputOutput,
    undefined
  >({
    method: 'delete',
    url: `/workspaces/${params.workspaceId}/ai-chat/conversations/${params.conversationId}`,
  });
};

// The server-sent events of one answer (server: AiChatStreamEvent in
// features/ai-chat/ai-chat.feature.ts — SSE has no OpenAPI schema).
export type AiChatStreamEvent =
  | { event: 'start'; data: { conversationId: string; title: string } }
  | { event: 'text'; data: { text: string } }
  | {
      event: 'tool';
      data: {
        id: string;
        tool: string;
        label: string;
        status: 'running' | 'done' | 'error';
      };
    }
  | { event: 'entities'; data: { entities: AiChatEntity[] } }
  | {
      event: 'done';
      data: {
        usage: { inputTokens: number; outputTokens: number };
        limit: AiChatLimit;
      };
    }
  | { event: 'error'; data: { message: string } };

// SSE blocks («event: x\ndata: {...}») out of a text stream; a block split
// across chunks waits for its end.
export const createSseEventParser = () => {
  let buffer = '';
  return (chunk: string): AiChatStreamEvent[] => {
    buffer += chunk.replace(/\r\n/g, '\n');
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() ?? '';
    return blocks.flatMap((block) => {
      const event = /^event: (.+)$/m.exec(block)?.[1];
      const data = /^data: (.+)$/m.exec(block)?.[1];
      if (!event || !data) return [];
      try {
        return [{ event, data: JSON.parse(data) } as AiChatStreamEvent];
      } catch {
        return [];
      }
    });
  };
};

// A refusal before the stream (403 consent, 429 limit, 400 «не настроено»)
// is thrown shaped like an axios error, so errorMessage() reads the server's
// message.
const httpError = (status: number, body: unknown) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data: body },
  });

export const askAiChat = async (params: {
  workspaceId: string;
  conversationId: string;
  question: string;
  signal: AbortSignal;
  onEvent: (e: AiChatStreamEvent) => void;
}): Promise<void> => {
  const open = () =>
    fetch(
      `${environment.apiBaseUrl}/workspaces/${params.workspaceId}/ai-chat/conversations/${params.conversationId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${getAccessToken() ?? ''}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          question: params.question,
        } satisfies ApiTypes.AskAiChatInput),
        signal: params.signal,
      },
    );
  let res = await open();
  if (res.status === 401) {
    // An expired access token: any axios call refreshes it, then retry once.
    await getAiChatState({ workspaceId: params.workspaceId }).catch(
      () => undefined,
    );
    res = await open();
  }
  if (!res.ok || !res.body) {
    throw httpError(res.status, await res.json().catch(() => null));
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parse = createSseEventParser();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const e of parse(decoder.decode(value, { stream: true })))
      params.onEvent(e);
  }
};
