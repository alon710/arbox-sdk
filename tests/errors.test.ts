import { describe, expect, it } from 'vitest';
import {
  ArboxAPIError,
  ArboxAuthenticationError,
  ArboxError,
  ArboxNotFoundError,
  ArboxPermissionDeniedError,
  ArboxRateLimitError,
  ArboxServerError,
  ArboxValidationError,
} from '../src';
import { recorder } from './support';

const failWith = (status: number, body: unknown, headers?: Record<string, string>) =>
  recorder(() =>
    typeof body === 'string'
      ? new Response(body, { status, headers })
      : Response.json(body, { status, headers }),
  ).client({ maxRetries: 0 });

describe('API errors', () => {
  it('maps an Arbox 401 to ArboxAuthenticationError with its code and message', async () => {
    const arbox = failWith(401, {
      statusCode: 401,
      error: { name: 'INVALID API KEY', code: 401, message: 'Please provide a valid api key.' },
      data: null,
    });
    const error = await arbox.locations.list().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ArboxAuthenticationError);
    expect(error).toBeInstanceOf(ArboxAPIError);
    expect(error).toBeInstanceOf(ArboxError);
    expect(error).toMatchObject({
      name: 'ArboxAuthenticationError',
      status: 401,
      code: 'INVALID API KEY',
      operation: 'locations.list',
      method: 'GET',
      path: '/v3/locations',
      message: 'GET /v3/locations failed with 401 INVALID API KEY: Please provide a valid api key.',
    });
  });

  it('exposes field errors on a 422', async () => {
    const arbox = failWith(422, {
      message: 'The schedule id field is required.',
      errors: { schedule_id: ['The schedule id field is required.'] },
    });
    const error = await arbox.schedule.book({ user_id: 1, schedule_id: 0 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ArboxValidationError);
    expect((error as ArboxValidationError).errors).toEqual({
      schedule_id: ['The schedule id field is required.'],
    });
    expect((error as Error).message).toBe(
      'POST /v3/schedule/bookSession failed with 422: The schedule id field is required.',
    );
  });

  it.each([
    [403, ArboxPermissionDeniedError],
    [404, ArboxNotFoundError],
    [429, ArboxRateLimitError],
    [500, ArboxServerError],
    [503, ArboxServerError],
    [418, ArboxAPIError],
  ])('maps %i to %o', async (status, type) => {
    const error = await failWith(status, { message: 'x' })
      .locations.list()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(type);
    expect((error as ArboxAPIError).status).toBe(status);
  });

  it('handles a non-JSON error body', async () => {
    const error = await failWith(502, '<html>Bad gateway</html>')
      .locations.list()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ArboxServerError);
    expect((error as ArboxAPIError).body).toBe('<html>Bad gateway</html>');
    expect((error as Error).message).toBe('GET /v3/locations failed with 502: HTTP 502');
  });

  it('throws when a 200 response carries an Arbox error', async () => {
    const error = await recorder(() =>
      Response.json({ statusCode: 404, error: { name: 'NOT FOUND', message: 'No such user' }, data: null }),
    )
      .client()
      .users.get({ userId: '9' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ArboxNotFoundError);
    expect((error as Error).message).toContain('No such user');
  });

  it('keeps query values out of the message', async () => {
    const error = await failWith(422, { message: 'bad' })
      .users.search({ type: 'phone', value: '0501234567' })
      .catch((e: unknown) => e);
    expect((error as Error).message).not.toContain('0501234567');
  });
});
