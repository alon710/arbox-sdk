import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { Arbox, ArboxReadOnlyError, type OperationId, operations } from '../../src';

const apiKey = process.env.ARBOX_API_KEY;
const spec = JSON.parse(readFileSync(new URL('../../openapi/arbox.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
ajv.addSchema({ ...spec, $id: 'arbox' });

const pointer = (path: string, method: string) =>
  `arbox#/paths/${path.replaceAll('~', '~0').replaceAll('/', '~1')}/${method}/responses/200/content/application~1json/schema`;

const today = new Date();
const day = (offset: number) => new Date(today.getTime() + offset * 86_400_000).toISOString().slice(0, 10);

const reads: [OperationId, Record<string, unknown>?][] = [
  ['locations.list'],
  ['membershipTypes.list', { limit: 5 }],
  ['membershipTypes.cancelReasons'],
  ['membershipTypes.holdReasons'],
  ['schedule.list', { from_date: day(0), to_date: day(7), limit: 5 }],
  ['schedule.services'],
  ['schedule.settings', { limit: 5 }],
  ['schedule.waitingListEntries', { from_date: day(-7), to_date: day(7), limit: 5 }],
  ['users.list', { limit: 5 }],
  ['memberships.list', { limit: 5 }],
  ['leads.list', { limit: 5 }],
  ['leads.statuses'],
  ['leads.sources'],
  ['leads.lostReasons'],
  ['tasks.types'],
  ['customFields.list'],
  ['messages.templates'],
  ['staff.list', { limit: 5 }],
];

describe.skipIf(!apiKey)('live Arbox API (read-only)', () => {
  const arbox = new Arbox({ apiKey, readOnly: true });
  const call = (id: OperationId, params?: Record<string, unknown>) => {
    const [resource, method] = id.split('.') as [string, string];
    const target = arbox as unknown as Record<string, Record<string, (p?: unknown) => Promise<unknown>>>;
    return target[resource]?.[method]?.(params);
  };

  it('refuses writes without sending them', async () => {
    await expect(arbox.schedule.book({ user_id: 1, schedule_id: 1 })).rejects.toBeInstanceOf(
      ArboxReadOnlyError,
    );
  });

  it.each(reads)('%s matches the OpenAPI response schema', async (id, params) => {
    const op = operations[id];
    expect(op.method).toBe('GET');
    const body = await call(id, params);
    const validate = ajv.getSchema(pointer(op.path, 'get')) ?? ajv.compile({ $ref: pointer(op.path, 'get') });
    const valid = validate(body);
    const problems = (validate.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`);
    expect(problems, `${id} differs from the spec`).toEqual([]);
    expect(valid).toBe(true);
  });
});
