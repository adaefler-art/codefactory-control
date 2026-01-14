/**
 * INTENT Page UI: scroll containment regression test
 *
 * Ensures:
 * - Window scroll APIs are not used for "scroll to bottom"
 * - Chat messages scroll within the dedicated container
 * - body/html overflow is locked while INTENT page is mounted
 */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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

describe('IntentPage scroll containment', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  test('uses container scrollTop; does not scroll window', async () => {
    const scrollIntoViewImpl = jest.fn();
    if (!('scrollIntoView' in Element.prototype)) {
      Object.defineProperty(Element.prototype, 'scrollIntoView', {
        configurable: true,
        value: scrollIntoViewImpl,
      });
    }
    const scrollIntoViewSpy = jest
      .spyOn(Element.prototype as any, 'scrollIntoView')
      .mockImplementation(scrollIntoViewImpl);

    const scrollToImpl = jest.fn();
    if (!('scrollTo' in window)) {
      Object.defineProperty(window, 'scrollTo', {
        configurable: true,
        value: scrollToImpl,
      });
    }
    const scrollToSpy = jest.spyOn(window as any, 'scrollTo').mockImplementation(scrollToImpl);

    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes('/api/intent/status')) {
        return jsonResponse({ enabled: true });
      }

      if (url.includes('/api/intent/sessions') && !url.includes('/messages') && !/\/api\/intent\/sessions\/[^/]+$/.test(url)) {
        // Sessions list
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
        // Session get -> messages
        return jsonResponse({
          messages: [
            {
              id: 'm1',
              session_id: 'session-1',
              role: 'assistant',
              content: 'Hello from INTENT',
              created_at: '2026-01-01T00:00:01.000Z',
              seq: 1,
            },
          ],
        });
      }

      return jsonResponse({});
    });

    // @ts-expect-error override global
    global.fetch = fetchMock;

    render(<IntentPage />);

    // Overflow should be locked via CSS class on mount
    expect(document.body.classList.contains('intent-page-active')).toBe(true);
    expect(document.documentElement.classList.contains('intent-page-active')).toBe(true);

    const chatScroll = await screen.findByTestId('intent-chat-scroll');

    // Provide a deterministic scrollHeight for jsdom
    Object.defineProperty(chatScroll, 'scrollHeight', {
      configurable: true,
      get: () => 500,
    });

    // Select the session to load messages
    const sessionButton = await screen.findByText('Test Session');
    fireEvent.click(sessionButton);

    await screen.findByText('Hello from INTENT');

    await waitFor(() => {
      expect((chatScroll as HTMLElement).scrollTop).toBe(500);
    });

    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
    expect(scrollToSpy).not.toHaveBeenCalled();
  });
});
