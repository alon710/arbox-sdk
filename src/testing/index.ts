import { Arbox, type ArboxOptions } from '../client';
import { type OperationId, operations } from '../generated/operations';
import type { OperationTypes } from '../generated/types';

export interface MockRequest<Id extends OperationId = OperationId> {
  operation: Id;
  method: string;
  url: URL;
  pathParams: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  headers: Headers;
}

export class MockResponse {
  constructor(
    readonly status: number,
    readonly body: unknown,
    readonly headers: Record<string, string> = {},
  ) {}
}

/** Build an Arbox-shaped error response, e.g. `mockError(422, 'The schedule id field is required.')`. */
export function mockError(status: number, message: string, name = 'MOCK ERROR'): MockResponse {
  return new MockResponse(status, { statusCode: status, error: { name, code: status, message }, data: null });
}

export type MockReply<Id extends OperationId> = OperationTypes[Id]['response'] | MockResponse;
export type MockHandler<Id extends OperationId> = (
  request: MockRequest<Id>,
) => MockReply<Id> | Promise<MockReply<Id>>;

export interface ArboxMock {
  /** Pass this as `fetch` to your own `Arbox` client, or use `client()`. */
  readonly fetch: typeof fetch;
  /** Every request the mock received, in order. */
  readonly calls: MockRequest[];
  /** Handle one operation with a function. Its return value is typed as that operation's response. */
  on<Id extends OperationId>(id: Id, handler: MockHandler<NoInfer<Id>>): ArboxMock;
  /** Answer one operation with a fixed response. */
  on<Id extends OperationId>(id: Id, reply: MockReply<NoInfer<Id>>): ArboxMock;
  /** Calls recorded for one operation. */
  callsTo<Id extends OperationId>(id: Id): MockRequest<Id>[];
  /** Forget every handler and recorded call. */
  reset(): void;
  /** An `Arbox` client wired to this mock. Retries are off unless you pass maxRetries. */
  client(options?: ArboxOptions): Arbox;
}

const routes = (Object.keys(operations) as OperationId[])
  .map((id) => {
    const op = operations[id];
    const names: string[] = [];
    const pattern = op.path
      .replace(/[.*+?^$()|[\]\\]/g, '\\$&')
      .replace(/\\?\{(\w+)\\?\}/g, (_, name: string) => {
        names.push(name);
        return '([^/]+)';
      });
    return { id, method: op.method, names, regex: new RegExp(`${pattern}$`) };
  })
  .sort((a, b) => a.names.length - b.names.length);

function parseBody(body: BodyInit | null | undefined): unknown {
  if (typeof body !== 'string') return body ?? undefined;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

/**
 * An in-memory Arbox for tests: register typed handlers per operation and inspect the calls.
 *
 * @example
 * const mock = createArboxMock();
 * mock.on('schedule.list', () => ({ statusCode: 200, data: [], extra: [] }));
 * const arbox = mock.client();
 */
export function createArboxMock(): ArboxMock {
  const handlers = new Map<OperationId, MockHandler<OperationId>>();
  const calls: MockRequest[] = [];

  const mockFetch: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const route = routes.find((r) => r.method === method && r.regex.test(url.pathname));
    if (!route) {
      return Response.json(mockError(404, `No Arbox operation matches ${method} ${url.pathname}`).body, {
        status: 404,
      });
    }
    const match = url.pathname.match(route.regex) ?? [];
    const request: MockRequest = {
      operation: route.id,
      method,
      url,
      pathParams: Object.fromEntries(route.names.map((n, i) => [n, decodeURIComponent(match[i + 1] ?? '')])),
      query: Object.fromEntries(url.searchParams),
      body: parseBody(init?.body),
      headers: new Headers(init?.headers),
    };
    calls.push(request);
    const handler = handlers.get(route.id);
    const reply = handler
      ? await handler(request)
      : mockError(501, `No mock handler for ${route.id} (${method} ${operations[route.id].path})`, 'NO MOCK');
    if (reply instanceof MockResponse) {
      return Response.json(reply.body, { status: reply.status, headers: reply.headers });
    }
    return Response.json(reply ?? null);
  };

  const mock: ArboxMock = {
    fetch: mockFetch,
    calls,
    on(id: OperationId, handler: unknown) {
      handlers.set(id, (typeof handler === 'function' ? handler : () => handler) as MockHandler<OperationId>);
      return mock;
    },
    callsTo<Id extends OperationId>(id: Id) {
      return calls.filter((c) => c.operation === id) as MockRequest<Id>[];
    },
    reset() {
      handlers.clear();
      calls.length = 0;
    },
    client(options = {}) {
      return new Arbox({ apiKey: 'mock-api-key', maxRetries: 0, ...options, fetch: mockFetch });
    },
  };
  return mock;
}
