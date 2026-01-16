/**
 * INTENT Page UI: Layout regression test for I901
 *
 * Ensures:
 * - Chat messages are never clipped at bottom
 * - Composer never overlaps chat content
 * - Header can scroll independently when it gets too tall
 * - Messages container always has proper scrollable space
 * - Layout works at different viewport sizes
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import IntentPage from '../../app/intent/page';

function jsonResponse(data: unknown, init?: ResponseInit) {
  const status = init?.status ?? 200;
  const headers = new Map<string, string>([[
    'content-type',
    'application/json',
  ]]);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    headers: {
      get: (name: string) => headers.get(name.toLowerCase()) ?? null,
    },
    json: async () => data,
  } as any;
}

describe('IntentPage layout regression (I901)', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  test('messages container has proper flex space even with tall header', async () => {
    const scrollIntoViewImpl = jest.fn();
    if (!('scrollIntoView' in Element.prototype)) {
      Object.defineProperty(Element.prototype, 'scrollIntoView', {
        configurable: true,
        value: scrollIntoViewImpl,
      });
    }

    // Generate 30+ messages
    const manyMessages = Array.from({ length: 35 }, (_, i) => ({
      id: `msg-${i}`,
      session_id: 'session-1',
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `Message ${i}: This is a test message with some content`,
      created_at: new Date(2026, 0, 1, 0, 0, i).toISOString(),
      seq: i + 1,
    }));

    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes('/api/intent/status')) {
        return jsonResponse({ enabled: true });
      }

      if (url.includes('/api/intent/sessions') && !url.includes('/messages') && !/\/api\/intent\/sessions\/[^/]+$/.test(url)) {
        return jsonResponse({
          sessions: [
            {
              id: 'session-1',
              title: 'Test Session with Many Messages',
              created_at: '2026-01-01T00:00:00.000Z',
              updated_at: '2026-01-01T00:00:00.000Z',
              status: 'active',
              conversation_mode: 'FREE',
            },
          ],
        });
      }

      if (/\/api\/intent\/sessions\/session-1$/.test(url)) {
        return jsonResponse({
          messages: manyMessages,
          conversation_mode: 'FREE',
        });
      }

      return jsonResponse({});
    });

    // @ts-expect-error override global
    global.fetch = fetchMock;

    const { container } = render(<IntentPage />);

    // Wait for session to appear and click it to load messages
    const sessionButton = await screen.findByText('Test Session with Many Messages');
    sessionButton.click();

    // Find the main chat area container
    const mainChatArea = container.querySelector('.flex-1.flex.flex-col.min-w-0.min-h-0.overflow-hidden');
    expect(mainChatArea).toBeTruthy();

    // Verify overflow-hidden is applied to prevent flex children from breaking out
    expect(mainChatArea?.classList.contains('overflow-hidden')).toBe(true);

    // Find the header section
    const header = container.querySelector('.bg-gray-900.border-b.border-gray-800.px-6.py-4.shrink-0.overflow-y-auto.max-h-\\[40vh\\]');
    expect(header).toBeTruthy();

    // Verify header has overflow-y-auto and max-h constraint
    expect(header?.classList.contains('overflow-y-auto')).toBe(true);
    expect(header?.classList.contains('max-h-[40vh]')).toBe(true);

    // Find the messages container
    const messagesContainer = await screen.findByTestId('intent-chat-scroll');
    expect(messagesContainer).toBeTruthy();

    // Verify messages container has flex-1 and overflow-y-auto
    expect(messagesContainer.classList.contains('flex-1')).toBe(true);
    expect(messagesContainer.classList.contains('min-h-0')).toBe(true);
    expect(messagesContainer.classList.contains('overflow-y-auto')).toBe(true);

    // Mock scrollHeight for messages container
    Object.defineProperty(messagesContainer, 'scrollHeight', {
      configurable: true,
      get: () => 2000, // Simulate tall content
    });

    Object.defineProperty(messagesContainer, 'clientHeight', {
      configurable: true,
      get: () => 400, // Simulate viewport height
    });

    // Verify messages are loaded
    await waitFor(() => {
      const messageElements = container.querySelectorAll('.max-w-2xl.rounded-lg.px-4.py-3');
      expect(messageElements.length).toBeGreaterThan(30);
    });

    // Verify scroll position can be set (container is scrollable)
    messagesContainer.scrollTop = 1600;
    expect(messagesContainer.scrollTop).toBe(1600);
  });

  test('layout works at small viewport (mobile)', async () => {
    // Set small viewport dimensions
    Object.defineProperty(window, 'innerHeight', {
      writable: true,
      configurable: true,
      value: 600,
    });

    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes('/api/intent/status')) {
        return jsonResponse({ enabled: true });
      }

      if (url.includes('/api/intent/sessions')) {
        return jsonResponse({ sessions: [] });
      }

      return jsonResponse({});
    });

    // @ts-expect-error override global
    global.fetch = fetchMock;

    const { container } = render(<IntentPage />);

    // Verify main container uses dvh (dynamic viewport height)
    const mainContainer = container.querySelector('.flex.h-\\[calc\\(100dvh-4rem\\)\\]');
    expect(mainContainer).toBeTruthy();

    // Verify overflow-hidden on main container
    expect(mainContainer?.classList.contains('overflow-hidden')).toBe(true);
  });

  test('composer area never overlaps messages', async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes('/api/intent/status')) {
        return jsonResponse({ enabled: true });
      }

      if (url.includes('/api/intent/sessions')) {
        return jsonResponse({
          sessions: [
            {
              id: 'session-1',
              title: 'Test Session',
              created_at: '2026-01-01T00:00:00.000Z',
              updated_at: '2026-01-01T00:00:00.000Z',
              status: 'active',
            },
          ],
        });
      }

      if (/\/api\/intent\/sessions\/session-1$/.test(url)) {
        return jsonResponse({
          messages: [
            {
              id: 'm1',
              session_id: 'session-1',
              role: 'user',
              content: 'Test message',
              created_at: '2026-01-01T00:00:01.000Z',
              seq: 1,
            },
          ],
          conversation_mode: 'FREE',
        });
      }

      return jsonResponse({});
    });

    // @ts-expect-error override global
    global.fetch = fetchMock;

    const { container } = render(<IntentPage />);

    // Find the input area (composer)
    const composerArea = container.querySelector('form');
    expect(composerArea?.parentElement?.classList.contains('shrink-0')).toBe(true);

    // Find messages container
    const messagesContainer = await screen.findByTestId('intent-chat-scroll');

    // Both should be separate flex children, not overlapping
    // The composer is shrink-0, messages is flex-1
    expect(messagesContainer.classList.contains('flex-1')).toBe(true);
    expect(composerArea?.parentElement?.classList.contains('shrink-0')).toBe(true);
  });
});
