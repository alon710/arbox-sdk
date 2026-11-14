import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArboxConnectionError, ArboxRateLimitError, ArboxServerError, ArboxTimeoutError } from '../src';
import { ok, recorder } from './support';

const status = (code: number, headers: Record<string, string> = { 'retry-after': '0' }) =>
  Response.json({ message: `status ${code}` }, { status: code, headers });

afterEach(() => {
  vi.useRealTimers();
});

describe('retries', () => {
  it('retries a read on 503 and then succeeds', async () => {
    const { client, requests } = recorder((_, attempt) => (attempt < 3 ? status(503) : ok(['x'])));
    await expect(client().locations.list()).resolves.toMatchObject({ data: ['x'] });
    expect(requests).toHaveLength(3);
  });

  it('gives up after maxRetries', async () => {
    const { client, requests } = recorder(() => status(500));
    await expect(client({ maxRetries: 1 }).locations.list()).rejects.toBeInstanceOf(ArboxServerError);
    expect(requests).toHaveLength(2);
  });

  it('never retries a write on a server error', async () => {
    const { client, requests } = recorder(() => status(500));
    await expect(client().schedule.book({ user_id: 1, schedule_id: 2 })).rejects.toBeInstanceOf(
      ArboxServerError,
    );
    expect(requests).toHaveLength(1);
  });

  it('retries a write on 429, which Arbox rejected before processing', async () => {
    const { client, requests } = recorder((_, attempt) => (attempt === 1 ? status(429) : ok()));
    await client().schedule.book({ user_id: 1, schedule_id: 2 });
    expect(requests).toHaveLength(2);
  });

  it('raises ArboxRateLimitError when 429 persists', async () => {
    const { client } = recorder(() => status(429));
    await expect(client({ maxRetries: 0 }).locations.list()).rejects.toBeInstanceOf(ArboxRateLimitError);
  });

  it('waits for Retry-After before retrying', async () => {
    vi.useFakeTimers();
    const { client, requests } = recorder((_, attempt) =>
      attempt === 1 ? status(429, { 'retry-after': '2' }) : ok(),
    );
    const pending = client().locations.list();
    await vi.advanceTimersByTimeAsync(1_900);
    expect(requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(200);
    await pending;
    expect(requests).toHaveLength(2);
  });

  it('backs off exponentially without Retry-After', async () => {
    vi.useFakeTimers();
    const { client, requests } = recorder((_, attempt) => (attempt < 3 ? status(503, {}) : ok()));
    const pending = client().locations.list();
    await vi.advanceTimersByTimeAsync(300);
    expect(requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(400);
    expect(requests).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1_300);
    await pending;
    expect(requests).toHaveLength(3);
  });

  it('retries a read after a network error', async () => {
    const { client, requests } = recorder((_, attempt) => {
      if (attempt === 1) throw new TypeError('fetch failed');
      return ok();
    });
    vi.useFakeTimers();
    const pending = client().locations.list();
    await vi.advanceTimersByTimeAsync(1_000);
    await pending;
    expect(requests).toHaveLength(2);
  });

  it('does not retry a write after a network error', async () => {
    const { client, requests } = recorder(() => {
      throw new TypeError('fetch failed');
    });
    const error = await client()
      .schedule.book({ user_id: 1, schedule_id: 2 })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ArboxConnectionError);
    expect((error as Error).cause).toBeInstanceOf(TypeError);
    expect(requests).toHaveLength(1);
  });
});

describe('timeouts and cancellation', () => {
  const hang: typeof fetch = (_, init) =>
    new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)));

  it('raises ArboxTimeoutError when a request takes too long', async () => {
    const { Arbox } = await import('../src');
    const arbox = new Arbox({ apiKey: 'k', fetch: hang, timeoutMs: 20, maxRetries: 0 });
    await expect(arbox.locations.list()).rejects.toBeInstanceOf(ArboxTimeoutError);
  });

  it('rejects with the caller’s abort reason and does not retry', async () => {
    const { Arbox } = await import('../src');
    let calls = 0;
    const arbox = new Arbox({
      apiKey: 'k',
      fetch: (input, init) => {
        calls++;
        return hang(input, init);
      },
    });
    const controller = new AbortController();
    const pending = arbox.locations.list(undefined, { signal: controller.signal });
    controller.abort(new Error('user cancelled'));
    await expect(pending).rejects.toThrow('user cancelled');
    expect(calls).toBe(1);
  });
});
