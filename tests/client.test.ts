import { inspect } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Arbox, ArboxError, ArboxReadOnlyError, DEFAULT_BASE_URL } from '../src';
import { recorder } from './support';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('configuration', () => {
  it('requires an API key', () => {
    vi.stubEnv('ARBOX_API_KEY', '');
    expect(() => new Arbox()).toThrow(/Missing Arbox API key/);
  });

  it('reads ARBOX_API_KEY from the environment', async () => {
    vi.stubEnv('ARBOX_API_KEY', 'from-env');
    const { fetch, requests } = recorder();
    await new Arbox({ fetch }).locations.list();
    expect(requests[0]?.headers.get('api-key')).toBe('from-env');
  });

  it('refuses to run in a browser unless told to', () => {
    vi.stubGlobal('window', { document: {} });
    expect(() => new Arbox({ apiKey: 'k' })).toThrow(/browser/);
    expect(() => new Arbox({ apiKey: 'k', dangerouslyAllowBrowser: true })).not.toThrow();
  });

  it('uses the public API base URL and accepts an override', async () => {
    const { client, requests } = recorder();
    await client().locations.list();
    await client({ baseUrl: 'https://proxy.example/arbox/' }).locations.list();
    expect(requests[0]?.url.href).toBe(`${DEFAULT_BASE_URL}/v3/locations`);
    expect(requests[1]?.url.href).toBe('https://proxy.example/arbox/v3/locations');
  });

  it('never exposes the API key through inspection or errors', async () => {
    const { client } = recorder(() => Response.json({ message: 'nope' }, { status: 500 }));
    const arbox = client({ apiKey: 'super-secret-key', maxRetries: 0 });
    expect(inspect(arbox, { depth: 10 })).not.toContain('super-secret-key');
    const error = await arbox.locations.list().catch((e: unknown) => e);
    expect(inspect(error, { depth: 10 })).not.toContain('super-secret-key');
    expect(JSON.stringify(error)).not.toContain('super-secret-key');
  });
});

describe('requests', () => {
  it('sends the api-key, accept and user-agent headers', async () => {
    const { client, requests } = recorder();
    await client({ headers: { 'x-trace': 'a', 'api-key': 'spoofed' } }).locations.list(undefined, {
      headers: { 'x-request': 'b' },
    });
    const headers = requests[0]?.headers;
    expect(headers?.get('api-key')).toBe('test-key');
    expect(headers?.get('accept')).toBe('application/json');
    expect(headers?.get('user-agent')).toBe('arbox-sdk/0.0.0-test');
    expect(headers?.get('x-trace')).toBe('a');
    expect(headers?.get('x-request')).toBe('b');
    expect(headers?.get('content-type')).toBeNull();
  });

  it('serializes query parameters and skips empty ones', async () => {
    const { client, requests } = recorder();
    await client().schedule.list({
      from_date: '2026-11-16',
      to_date: '2026-11-22',
      location_id: 3,
      cancelled: '0',
      staff_id: undefined,
    });
    expect(requests[0]?.method).toBe('GET');
    expect(Object.fromEntries(requests[0]?.url.searchParams ?? [])).toEqual({
      from_date: '2026-11-16',
      to_date: '2026-11-22',
      location_id: '3',
      cancelled: '0',
    });
  });

  it('sends writes as JSON bodies', async () => {
    const { client, requests } = recorder();
    await client().schedule.book({ user_id: 12, schedule_id: 34 });
    expect(requests[0]?.method).toBe('POST');
    expect(requests[0]?.url.pathname).toBe('/api/public/v3/schedule/bookSession');
    expect(requests[0]?.headers.get('content-type')).toBe('application/json');
    expect(requests[0]?.body).toEqual({ user_id: 12, schedule_id: 34 });
    expect(requests[0]?.url.search).toBe('');
  });

  it('encodes path parameters', async () => {
    const { client, requests } = recorder();
    await client().users.get({ userId: 'a b/c@x' });
    await client().users.withWaiver({ type: 'medical', value: '1' });
    expect(requests[0]?.url.pathname).toBe('/api/public/v3/users/a%20b%2Fc%40x');
    expect(requests[1]?.url.pathname).toBe('/api/public/v3/users/waiver/medical/1');
  });

  it('fails fast when a path parameter is missing', async () => {
    const { client, requests } = recorder();
    await expect(client().users.get({ userId: '' })).rejects.toThrow(/needs the "userId" parameter/);
    expect(requests).toHaveLength(0);
  });

  it('puts a parameter documented in both path and query in both places', async () => {
    const { client, requests } = recorder();
    await client().reports.get({ reportName: 'birthdayReport', limit: 10 });
    expect(requests[0]?.url.pathname).toBe('/api/public/v3/reports/birthdayReport');
    expect(requests[0]?.url.searchParams.get('reportName')).toBe('birthdayReport');
    expect(requests[0]?.url.searchParams.get('limit')).toBe('10');
  });

  it('sends fields documented as both query and body in both places', async () => {
    const { client, requests } = recorder();
    await client().memberships.create({ user_id: 1, membership_type_id: 2 });
    expect(requests[0]?.url.searchParams.get('user_id')).toBe('1');
    expect(requests[0]?.body).toEqual({ user_id: 1, membership_type_id: 2 });
  });

  it('passes through parameters the spec does not list yet', async () => {
    const { client, requests } = recorder();
    const read = client().locations.list as (p: Record<string, unknown>) => Promise<unknown>;
    const write = client().schedule.book as (p: Record<string, unknown>) => Promise<unknown>;
    await read({ include_inactive: true });
    await write({ user_id: 1, schedule_id: 2, source: 'bot' });
    expect(requests[0]?.url.searchParams.get('include_inactive')).toBe('1');
    expect(requests[1]?.body).toEqual({ user_id: 1, schedule_id: 2, source: 'bot' });
  });

  it('returns the parsed response envelope', async () => {
    const { client } = recorder(() =>
      Response.json({ statusCode: 200, data: [{ location_name: 'Main' }], extra: [] }),
    );
    await expect(client().locations.list()).resolves.toEqual({
      statusCode: 200,
      data: [{ location_name: 'Main' }],
      extra: [],
    });
  });
});

describe('readOnly', () => {
  it('blocks writes before anything is sent', async () => {
    const { client, requests } = recorder();
    const arbox = client({ readOnly: true });
    await expect(arbox.schedule.book({ user_id: 1, schedule_id: 2 })).rejects.toBeInstanceOf(
      ArboxReadOnlyError,
    );
    await expect(arbox.users.archive({ user_id: 1 } as never)).rejects.toThrow(/readOnly: true/);
    expect(requests).toHaveLength(0);
  });

  it('allows reads', async () => {
    const { client, requests } = recorder();
    await client({ readOnly: true }).locations.list();
    expect(requests).toHaveLength(1);
  });

  it('is an ArboxError', () => {
    expect(new ArboxReadOnlyError('x')).toBeInstanceOf(ArboxError);
  });
});
