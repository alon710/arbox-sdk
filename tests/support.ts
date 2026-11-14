import { Arbox, type ArboxOptions } from '../src';

export interface RecordedRequest {
  method: string;
  url: URL;
  headers: Headers;
  body: unknown;
}

type Responder = (request: RecordedRequest, attempt: number) => Response | Promise<Response>;

export const ok = (data: unknown = [], extra: unknown = []) =>
  Response.json({ statusCode: 200, data, extra });

export function recorder(responder: Responder = () => ok()) {
  const requests: RecordedRequest[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request: RecordedRequest = {
      method: init?.method ?? 'GET',
      url: new URL(String(input)),
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    requests.push(request);
    init?.signal?.throwIfAborted();
    return responder(request, requests.length);
  };
  const client = (options: ArboxOptions = {}) => new Arbox({ apiKey: 'test-key', fetch, ...options });
  return { fetch, requests, client };
}
