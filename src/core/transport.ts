import { type OperationId, operations } from '../generated/operations';
import type { OperationTypes } from '../generated/types';
import { VERSION } from '../version';
import {
  ArboxConnectionError,
  ArboxError,
  ArboxReadOnlyError,
  ArboxTimeoutError,
  createAPIError,
} from './errors';
import type { OperationDefinition } from './operation';

export const DEFAULT_BASE_URL = 'https://arboxserver.arboxapp.com/api/public';

export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  maxRetries?: number;
  headers?: Record<string, string>;
}

export interface TransportConfig {
  apiKey: string;
  baseUrl: string;
  fetch: typeof fetch;
  timeoutMs: number;
  maxRetries: number;
  readOnly: boolean;
  headers: Record<string, string>;
}

const RETRYABLE_READ_STATUSES = new Set([408, 500, 502, 503, 504]);
const MAX_RETRY_AFTER_MS = 60_000;

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener('abort', abort);
      resolve();
    }
    function abort() {
      clearTimeout(timer);
      reject(signal?.reason);
    }
    signal?.addEventListener('abort', abort, { once: true });
  });

function backoff(attempt: number): number {
  const base = Math.min(500 * 2 ** attempt, 8_000);
  return Math.round(base * (0.75 + Math.random() * 0.5));
}

function retryAfter(headers: Headers): number | undefined {
  const value = headers.get('retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(ms) ? Math.min(Math.max(ms, 0), MAX_RETRY_AFTER_MS) : undefined;
}

function serialize(value: unknown): string {
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

function appendQuery(query: URLSearchParams, name: string, value: unknown) {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    for (const item of value) appendQuery(query, `${name}[]`, item);
    return;
  }
  query.append(name, serialize(value));
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function bodyError(body: unknown): number | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const { statusCode, error } = body as { statusCode?: unknown; error?: unknown };
  return typeof statusCode === 'number' && statusCode >= 400 && error ? statusCode : undefined;
}

export class Transport {
  readonly #config: TransportConfig;

  constructor(config: TransportConfig) {
    this.#config = config;
  }

  async call<Id extends OperationId>(
    id: Id,
    params: OperationTypes[Id]['params'] | undefined,
    options: RequestOptions = {},
  ): Promise<OperationTypes[Id]['response']> {
    const op: OperationDefinition = operations[id];
    if (this.#config.readOnly && op.method !== 'GET') {
      throw new ArboxReadOnlyError(
        `arbox.${id}() sends ${op.method} ${op.path}, and this client was created with readOnly: true.`,
      );
    }
    const { url, body } = this.#build(id, op, (params ?? {}) as Record<string, unknown>);
    const headers: Record<string, string> = {
      accept: 'application/json',
      'user-agent': `arbox-sdk/${VERSION}`,
      ...this.#config.headers,
      ...options.headers,
      'api-key': this.#config.apiKey,
    };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const maxRetries = options.maxRetries ?? this.#config.maxRetries;
    const timeoutMs = options.timeoutMs ?? this.#config.timeoutMs;

    for (let attempt = 0; ; attempt++) {
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
      let response: Response;
      try {
        response = await this.#config.fetch(url, { method: op.method, headers, body, signal });
      } catch (cause) {
        if (options.signal?.aborted) throw options.signal.reason;
        if (op.method === 'GET' && attempt < maxRetries) {
          await sleep(backoff(attempt), options.signal);
          continue;
        }
        if (timeout.aborted) {
          throw new ArboxTimeoutError(`${op.method} ${op.path} timed out after ${timeoutMs} ms.`, { cause });
        }
        throw new ArboxConnectionError(`${op.method} ${op.path} could not reach Arbox.`, { cause });
      }

      const retryable =
        response.status === 429 || (op.method === 'GET' && RETRYABLE_READ_STATUSES.has(response.status));
      if (retryable && attempt < maxRetries) {
        await response.body?.cancel();
        await sleep(retryAfter(response.headers) ?? backoff(attempt), options.signal);
        continue;
      }

      const parsed = await readBody(response);
      const status = response.ok ? bodyError(parsed) : response.status;
      if (status !== undefined) {
        throw createAPIError({
          status,
          operation: id,
          method: op.method,
          path: op.path,
          body: parsed,
          headers: response.headers,
        });
      }
      return parsed as OperationTypes[Id]['response'];
    }
  }

  #build(id: string, op: OperationDefinition, params: Record<string, unknown>) {
    let path = op.path;
    for (const name of op.pathParams) {
      const value = params[name];
      if (value === undefined || value === null || value === '') {
        throw new ArboxError(`arbox.${id}() needs the "${name}" parameter.`);
      }
      path = path.replace(`{${name}}`, encodeURIComponent(serialize(value)));
    }
    const query = new URLSearchParams();
    const payload: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(params)) {
      const inQuery = op.queryParams.includes(name);
      if (op.pathParams.includes(name) && !inQuery) continue;
      if (inQuery || !op.body) appendQuery(query, name, value);
      if (op.body && value !== undefined && (op.bodyParams.includes(name) || !inQuery)) payload[name] = value;
    }
    const search = query.toString();
    return {
      url: `${this.#config.baseUrl}${path}${search ? `?${search}` : ''}`,
      body: op.body ? JSON.stringify(payload) : undefined,
    };
  }
}
