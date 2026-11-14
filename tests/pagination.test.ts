import { describe, expect, it } from 'vitest';
import { ok, recorder } from './support';

const pages = (...data: unknown[][]) =>
  recorder((request) => ok(data[Number(request.url.searchParams.get('page')) - 1] ?? []));

describe('paginate', () => {
  it('walks pages until one comes back empty', async () => {
    const { client, requests } = pages([1, 2], [3, 4], [5]);
    const arbox = client();
    const items: unknown[] = [];
    for await (const lead of arbox.paginate(arbox.leads.list, { limit: 2 })) items.push(lead);
    expect(items).toEqual([1, 2, 3, 4, 5]);
    expect(requests.map((r) => r.url.searchParams.get('page'))).toEqual(['1', '2', '3', '4']);
    expect(requests.every((r) => r.url.searchParams.get('limit') === '2')).toBe(true);
  });

  it('defaults to limit 100 and keeps the other parameters', async () => {
    const { client, requests } = pages([1]);
    const arbox = client();
    const items: unknown[] = [];
    for await (const item of arbox.paginate(arbox.leads.list, { location_id: 4, sort: 'desc' })) {
      items.push(item);
    }
    expect(items).toEqual([1]);
    expect(Object.fromEntries(requests[0]?.url.searchParams ?? [])).toEqual({
      location_id: '4',
      sort: 'desc',
      page: '1',
      limit: '100',
    });
  });

  it('starts from the given page', async () => {
    const { client, requests } = pages([1], [2], [3]);
    const arbox = client();
    const items: unknown[] = [];
    const range = { from_date: '2026-11-01', to_date: '2026-11-30' };
    for await (const item of arbox.paginate(arbox.tasks.list, { ...range, page: 2, limit: 1 })) {
      items.push(item);
    }
    expect(items).toEqual([2, 3]);
    expect(requests[0]?.url.searchParams.get('page')).toBe('2');
  });

  it('stops if the API ignores the page number', async () => {
    const { client, requests } = recorder(() => ok([1, 2]));
    const arbox = client();
    const items: unknown[] = [];
    for await (const item of arbox.paginate(arbox.leads.list, { limit: 2 })) items.push(item);
    expect(items).toEqual([1, 2]);
    expect(requests).toHaveLength(2);
  });

  it('respects maxPages', async () => {
    const { client, requests } = pages([1], [2], [3]);
    const arbox = client();
    const items: unknown[] = [];
    for await (const item of arbox.paginate(arbox.leads.list, { limit: 1 }, { maxPages: 2 })) {
      items.push(item);
    }
    expect(items).toEqual([1, 2]);
    expect(requests).toHaveLength(2);
  });
});
