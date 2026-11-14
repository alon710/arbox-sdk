import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type OperationId, operations } from '../src';
import { recorder } from './support';

type Param = { name: string; in: string; schema?: { type?: string | string[]; enum?: unknown[] } };
type Op = { parameters?: Param[]; requestBody?: unknown };
const spec = JSON.parse(readFileSync(new URL('../openapi/arbox.json', import.meta.url), 'utf8')) as {
  paths: Record<string, Record<string, Op>>;
};

const specKeys = Object.entries(spec.paths).flatMap(([path, item]) =>
  Object.keys(item)
    .filter((m) => ['get', 'post', 'put', 'patch', 'delete'].includes(m))
    .map((m) => `${m.toUpperCase()} ${path}`),
);

const sample = (p: Param): string | number =>
  p.schema?.enum?.length
    ? (p.schema.enum[0] as string)
    : [p.schema?.type].flat().includes('integer') || [p.schema?.type].flat().includes('number')
      ? 7
      : `${p.name}-value`;

describe('coverage of the OpenAPI document', () => {
  it('has exactly one SDK method per Arbox operation', () => {
    const sdkKeys = Object.values(operations).map((op) => `${op.method} ${op.path}`);
    expect(new Set(sdkKeys).size).toBe(sdkKeys.length);
    expect([...sdkKeys].sort()).toEqual([...specKeys].sort());
  });
});

describe.each(Object.keys(operations) as OperationId[])('arbox.%s()', (id) => {
  const op = operations[id];
  const specOp = spec.paths[op.path]?.[op.method.toLowerCase()] as Op;

  it(`sends ${op.method} ${op.path} with its parameters in the right place`, async () => {
    const { client, requests } = recorder();
    const arbox = client() as unknown as Record<
      string,
      Record<string, (p: Record<string, unknown>) => Promise<unknown>>
    >;
    const [resource, method] = id.split('.') as [string, string];
    const params: Record<string, unknown> = {};
    for (const p of specOp.parameters ?? []) params[p.name] = sample(p);
    for (const name of op.bodyParams) params[name] ??= `${name}-body`;

    await arbox[resource]?.[method]?.(params);

    const request = requests[0];
    expect(request?.method).toBe(op.method);
    let expectedPath = `/api/public${op.path}`;
    for (const name of op.pathParams) expectedPath = expectedPath.replace(`{${name}}`, String(params[name]));
    expect(request?.url.pathname).toBe(expectedPath);
    expect([...(request?.url.searchParams.keys() ?? [])].sort()).toEqual([...op.queryParams].sort());
    if (op.body) {
      expect(Object.keys(request?.body as object).sort()).toEqual([...op.bodyParams].sort());
    } else {
      expect(request?.body).toBeUndefined();
    }
  });
});
