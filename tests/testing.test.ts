import { describe, expect, it } from 'vitest';
import { ArboxServerError, ArboxValidationError } from '../src';
import { createArboxMock, MockResponse, mockError } from '../src/testing';

describe('createArboxMock', () => {
  it('answers with a typed handler and records the call', async () => {
    const mock = createArboxMock();
    mock.on('schedule.list', ({ query }) => ({
      statusCode: 200,
      data: [{ date: query.from_date ?? '', session_name: 'Strength', schedule_id: '42' }],
      extra: [],
    }));
    const arbox = mock.client();
    const { data } = await arbox.schedule.list({ from_date: '2026-11-16', to_date: '2026-11-22' });
    expect(data?.[0]?.schedule_id).toBe('42');
    expect(mock.callsTo('schedule.list')).toHaveLength(1);
    expect(mock.calls[0]?.query).toEqual({ from_date: '2026-11-16', to_date: '2026-11-22' });
    expect(mock.calls[0]?.headers.get('api-key')).toBe('mock-api-key');
  });

  it('accepts a static reply and records write bodies', async () => {
    const mock = createArboxMock().on('schedule.book', { statusCode: 200, data: [], extra: [] });
    await mock.client().schedule.book({ user_id: 5, schedule_id: 9 });
    expect(mock.callsTo('schedule.book')[0]?.body).toEqual({ user_id: 5, schedule_id: 9 });
  });

  it('matches static paths before parameterized ones', async () => {
    const mock = createArboxMock()
      .on('users.notes', { statusCode: 200, data: [], extra: [] })
      .on('users.get', { statusCode: 200, data: [], extra: [] });
    const arbox = mock.client();
    await arbox.users.notes({ user_id: 1 } as never);
    await arbox.users.get({ userId: '77' });
    expect(mock.calls.map((c) => c.operation)).toEqual(['users.notes', 'users.get']);
    expect(mock.calls[1]?.pathParams).toEqual({ userId: '77' });
  });

  it('simulates Arbox errors', async () => {
    const mock = createArboxMock().on(
      'schedule.book',
      () => new MockResponse(422, { message: 'Class is full', errors: { schedule_id: ['Class is full'] } }),
    );
    await expect(mock.client().schedule.book({ user_id: 1, schedule_id: 2 })).rejects.toBeInstanceOf(
      ArboxValidationError,
    );
  });

  it('fails loudly for an operation without a handler', async () => {
    const mock = createArboxMock();
    const error = await mock
      .client()
      .locations.list()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ArboxServerError);
    expect((error as ArboxServerError).code).toBe('NO MOCK');
    expect((error as Error).message).toContain('No mock handler for locations.list');
  });

  it('builds Arbox-shaped errors', () => {
    expect(mockError(404, 'gone').body).toEqual({
      statusCode: 404,
      error: { name: 'MOCK ERROR', code: 404, message: 'gone' },
      data: null,
    });
  });

  it('resets handlers and calls', async () => {
    const mock = createArboxMock().on('locations.list', { statusCode: 200, data: [], extra: [] });
    await mock.client().locations.list();
    mock.reset();
    expect(mock.calls).toHaveLength(0);
    await expect(mock.client().locations.list()).rejects.toBeInstanceOf(ArboxServerError);
  });
});
