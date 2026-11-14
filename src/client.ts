import { ArboxError } from './core/errors';
import { DEFAULT_BASE_URL, type RequestOptions, Transport } from './core/transport';
import { ArboxResources } from './generated/resources';

export interface ArboxOptions {
  /** The studio's Arbox API key. Defaults to the `ARBOX_API_KEY` environment variable. */
  apiKey?: string;
  /** Defaults to `https://arboxserver.arboxapp.com/api/public`. */
  baseUrl?: string;
  /** A custom `fetch`, for proxies, tracing or tests. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Per-attempt timeout in milliseconds. Defaults to 30 000. */
  timeoutMs?: number;
  /** Retries after the first attempt. Defaults to 2. Reads retry on network errors, 408, 429 and 5xx; writes retry only on 429. */
  maxRetries?: number;
  /** Refuse every non-GET call before it is sent. Useful for probes, dashboards and tests against production. */
  readOnly?: boolean;
  /** Extra headers sent with every request. */
  headers?: Record<string, string>;
  /** API keys grant full access to a studio. The client refuses to run in a browser unless you set this. */
  dangerouslyAllowBrowser?: boolean;
}

type Page = { data?: readonly unknown[] | null };
type Pageable = { page?: number; limit?: number };
type PageItem<R> = R extends { data?: readonly (infer T)[] | null } ? T : never;

export interface PaginateOptions extends RequestOptions {
  /** Stop after this many pages. Defaults to 1 000. */
  maxPages?: number;
}

function readEnv(name: string): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.[name]?.trim() || undefined;
}

function isBrowser(): boolean {
  const g = globalThis as { window?: { document?: unknown } };
  return typeof g.window !== 'undefined' && typeof g.window.document !== 'undefined';
}

function createTransport(options: ArboxOptions): Transport {
  const apiKey = options.apiKey?.trim() || readEnv('ARBOX_API_KEY');
  if (!apiKey) {
    throw new ArboxError('Missing Arbox API key: pass { apiKey } or set ARBOX_API_KEY.');
  }
  if (isBrowser() && !options.dangerouslyAllowBrowser) {
    throw new ArboxError(
      'arbox-sdk is running in a browser, which would expose the API key. Call Arbox from your server, or set dangerouslyAllowBrowser: true if you understand the risk.',
    );
  }
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new ArboxError('No fetch implementation found: use Node 20+ or pass { fetch }.');
  }
  return new Transport({
    apiKey,
    baseUrl: (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, ''),
    fetch: fetchImpl,
    timeoutMs: options.timeoutMs ?? 30_000,
    maxRetries: options.maxRetries ?? 2,
    readOnly: options.readOnly ?? false,
    headers: options.headers ?? {},
  });
}

/**
 * Client for the Arbox public API (v3).
 *
 * @example
 * const arbox = new Arbox({ apiKey: process.env.ARBOX_API_KEY });
 * const { data } = await arbox.schedule.list({ from_date: '2026-11-16', to_date: '2026-11-22' });
 */
export class Arbox extends ArboxResources {
  constructor(options: ArboxOptions = {}) {
    super(createTransport(options));
  }

  /**
   * Iterate every item of a paginated list, fetching page after page until one comes back empty.
   *
   * @example
   * for await (const lead of arbox.paginate(arbox.leads.list, { limit: 100 })) {
   *   console.log(lead.first_name);
   * }
   */
  async *paginate<P extends Pageable | undefined, R extends Page>(
    list: (params: P, options?: RequestOptions) => Promise<R>,
    params: NoInfer<NonNullable<P>>,
    options: PaginateOptions = {},
  ): AsyncGenerator<PageItem<R>, void, undefined> {
    const { maxPages = 1_000, ...requestOptions } = options;
    const limit = params.limit ?? 100;
    let previous: string | undefined;
    for (let page = params.page ?? 1, fetched = 0; fetched < maxPages; page++, fetched++) {
      const response = await list({ ...params, page, limit } as P, requestOptions);
      const items = (response.data ?? []) as readonly PageItem<R>[];
      if (items.length === 0) return;
      const fingerprint = JSON.stringify(items);
      if (fingerprint === previous) return;
      previous = fingerprint;
      yield* items;
    }
  }
}
