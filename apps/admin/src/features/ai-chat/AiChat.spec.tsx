/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';

import {
  type AiChatConversation,
  type AiChatConversationSummary,
  type AiChatState,
  getAiChatConversation,
  getAiChatState,
  listAiChatConversations,
} from '../../shared/api/ai-chat';
import { AiChat } from './AiChat';

jest.mock('../../shared/api/ai-chat', () => ({
  acceptAiChatWarning: jest.fn(),
  askAiChat: jest.fn(),
  deleteAiChatConversation: jest.fn(),
  getAiChatConversation: jest.fn(),
  getAiChatState: jest.fn(),
  listAiChatConversations: jest.fn(),
}));

const stateMock = getAiChatState as jest.MockedFunction<typeof getAiChatState>;
const listMock = listAiChatConversations as jest.MockedFunction<
  typeof listAiChatConversations
>;
const getMock = getAiChatConversation as jest.MockedFunction<
  typeof getAiChatConversation
>;

const STATE: AiChatState = {
  configured: true,
  model: 'openai/gpt-4.1-mini',
  scope: 'club',
  consent: {
    accepted: true,
    acceptedAt: '2026-10-26T13:55:00.000Z',
    canAccept: true,
    warning: { version: 'chat-1', title: 'Условия', text: 'Текст' },
  },
  limit: { perMonth: 300, used: 1, remaining: 299 },
  suggestions: ['Кому позвонить сегодня?'],
};

const SUMMARY: AiChatConversationSummary = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Кому позвонить сегодня?',
  questions: 1,
  createdAt: '2026-11-02T04:00:00.000Z',
  updatedAt: '2026-11-02T04:00:00.000Z',
};

const CONVERSATION: AiChatConversation = {
  ...SUMMARY,
  turns: [
    {
      question: 'Кому позвонить сегодня?',
      askedAt: '2026-11-02T04:00:00.000Z',
      steps: [],
      answer: 'Позвоните троим.',
      error: null,
    },
  ],
  entities: [],
};

const EMPTY = 'Спросите о клубе обычными словами';

describe('AiChat', () => {
  // jsdom has no layout: the chat scrolls to its bottom after each change.
  beforeAll(() => {
    Element.prototype.scrollIntoView = jest.fn();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    stateMock.mockResolvedValue(STATE);
  });

  it('opens the latest saved conversation', async () => {
    listMock.mockResolvedValue([SUMMARY]);
    getMock.mockResolvedValue(CONVERSATION);
    render(<AiChat workspaceId="w1" />);
    expect(await screen.findByText('Позвоните троим.')).toBeTruthy();
  });

  it('keeps a new conversation started while the saved ones were loading', async () => {
    const list = Promise.withResolvers<AiChatConversationSummary[]>();
    listMock.mockReturnValue(list.promise);
    render(<AiChat workspaceId="w1" />);
    fireEvent.click(screen.getByText('Новый диалог'));
    await act(async () => list.resolve([SUMMARY]));
    expect(await screen.findByText(EMPTY)).toBeTruthy();
    expect(getMock).not.toHaveBeenCalled();
  });

  it('drops a conversation that finished loading after «Новый диалог»', async () => {
    listMock.mockResolvedValue([SUMMARY]);
    const opened = Promise.withResolvers<AiChatConversation>();
    getMock.mockReturnValue(opened.promise);
    render(<AiChat workspaceId="w1" />);
    expect(await screen.findByText(EMPTY)).toBeTruthy();
    expect(getMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('Новый диалог'));
    await act(async () => opened.resolve(CONVERSATION));
    expect(screen.queryByText('Позвоните троим.')).toBeNull();
    expect(screen.getByText(EMPTY)).toBeTruthy();
  });
});
