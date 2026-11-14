import { readFileSync, writeFileSync } from 'node:fs';
import openapiTS, { astToString } from 'openapi-typescript';
import { resourceDocs, resources } from './names.ts';

type Param = { name: string; in: string; required?: boolean };
type Schema = { $ref?: string; required?: string[]; properties?: Record<string, unknown> };
type Operation = {
  summary?: string;
  description?: string;
  operationId?: string;
  parameters?: Param[];
  requestBody?: { required?: boolean; content: Record<string, { schema: Schema }> };
  responses: Record<string, { content?: Record<string, unknown> }>;
};
type Spec = {
  info: { version: string };
  paths: Record<string, Record<string, Operation | Param[]> & { parameters?: Param[] }>;
  components: { schemas: Record<string, Schema> };
};

const root = new URL('..', import.meta.url);
const read = (file: string) => readFileSync(new URL(file, root), 'utf8');
const write = (file: string, text: string) => writeFileSync(new URL(file, root), text);
const spec = JSON.parse(read('openapi/arbox.json')) as Spec;
const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

const specOps = new Map<string, { path: string; method: string; op: Operation; shared: Param[] }>();
for (const [path, item] of Object.entries(spec.paths)) {
  for (const method of METHODS) {
    const op = item[method] as Operation | undefined;
    if (op)
      specOps.set(`${method.toUpperCase()} ${path}`, { path, method, op, shared: item.parameters ?? [] });
  }
}

const problems: string[] = [];
const mapped = new Set<string>();
for (const [resource, methods] of Object.entries(resources)) {
  for (const [name, key] of Object.entries(methods)) {
    if (!specOps.has(key)) problems.push(`${resource}.${name}: "${key}" is not in openapi/arbox.json`);
    if (mapped.has(key)) problems.push(`"${key}" is mapped twice`);
    mapped.add(key);
  }
}
for (const key of specOps.keys()) {
  if (!mapped.has(key)) problems.push(`"${key}" has no SDK method: add it to scripts/names.ts`);
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}

const pascal = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const resolve = (s: Schema): Schema =>
  s.$ref ? (spec.components.schemas[s.$ref.split('/').pop() ?? ''] ?? {}) : s;
const clean = (s = '') =>
  s
    .replace(/<[^>]+>/g, ' ')
    .replace(/\*\//g, '* /')
    .replace(/\s+/g, ' ')
    .trim();

type OpInfo = {
  id: string;
  resource: string;
  name: string;
  typeBase: string;
  method: string;
  path: string;
  pathParams: string[];
  queryParams: string[];
  body: boolean;
  bodyParams: string[];
  required: string[];
  summary: string;
  description: string;
  hasJsonResponse: boolean;
  pageable: boolean;
};

const ops: OpInfo[] = [];
for (const [resource, methods] of Object.entries(resources)) {
  for (const [name, key] of Object.entries(methods)) {
    const entry = specOps.get(key);
    if (!entry) continue;
    const { path, method, op, shared } = entry;
    const params = [...shared, ...(op.parameters ?? [])];
    const pathParams = params.filter((p) => p.in === 'path').map((p) => p.name);
    const queryParams = params.filter((p) => p.in === 'query').map((p) => p.name);
    const unsupported = params.filter((p) => p.in !== 'path' && p.in !== 'query');
    if (unsupported.length) problems.push(`${key}: unsupported parameter location ${unsupported[0]?.in}`);
    const content = op.requestBody?.content ?? {};
    const contentTypes = Object.keys(content);
    if (contentTypes.some((c) => c !== 'application/json'))
      problems.push(`${key}: non-JSON body ${contentTypes}`);
    const bodySchema = content['application/json']?.schema;
    const bodyRequired = bodySchema ? (resolve(bodySchema).required ?? []) : [];
    const bodyProps = bodySchema ? Object.keys(resolve(bodySchema).properties ?? {}) : [];
    const clash = bodyProps.filter((p) => pathParams.includes(p));
    if (clash.length) problems.push(`${key}: body fields also used as path parameters: ${clash.join(', ')}`);
    const required = [
      ...params.filter((p) => p.required).map((p) => p.name),
      ...(op.requestBody?.required || bodyRequired.length ? bodyRequired : []),
    ];
    ops.push({
      id: `${resource}.${name}`,
      resource,
      name,
      typeBase: `${pascal(resource)}${pascal(name)}`,
      method: method.toUpperCase(),
      path,
      pathParams,
      queryParams,
      body: Boolean(bodySchema),
      bodyParams: bodyProps,
      required: [...new Set(required)],
      summary: clean(op.summary ?? op.operationId),
      description: clean(op.description),
      hasJsonResponse:
        Object.keys(
          (op.responses['200']?.content?.['application/json'] as { schema?: object } | undefined)?.schema ??
            {},
        ).length > 0,
      pageable: method === 'get' && queryParams.includes('page') && queryParams.includes('limit'),
    });
  }
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}

const header = `// Generated by scripts/generate.ts from openapi/arbox.json (Arbox API ${spec.info.version}). Do not edit.\n`;

const ast = await openapiTS(spec as never, { alphabetize: true });
write('src/generated/schema.ts', header + astToString(ast));

const q = (s: string) => `'${s}'`;
write(
  'src/generated/operations.ts',
  `${header}import type { OperationDefinition } from '../core/operation';

export const operations = {
${ops
  .map(
    (o) =>
      `  ${q(o.id)}: { method: ${q(o.method)}, path: ${q(o.path)}, pathParams: [${o.pathParams.map(q).join(', ')}], queryParams: [${o.queryParams.map(q).join(', ')}], body: ${o.body}, bodyParams: [${o.bodyParams.map(q).join(', ')}] },`,
  )
  .join('\n')}
} as const satisfies Record<string, OperationDefinition>;

export type OperationId = keyof typeof operations;
`,
);

const typeLines: string[] = [];
for (const o of ops) {
  const P = `paths[${q(o.path)}][${q(o.method.toLowerCase())}]`;
  const parts: string[] = [];
  if (o.pathParams.length) parts.push(`${P}['parameters']['path']`);
  if (o.queryParams.length) parts.push(`NonNullable<${P}['parameters']['query']>`);
  if (o.body) parts.push(`NonNullable<${P}['requestBody']>['content']['application/json']`);
  typeLines.push(
    `/** Parameters for \`arbox.${o.id}()\` (${o.method} ${o.path}). */`,
    `export type ${o.typeBase}Params = ${parts.join(' & ') || 'Record<string, never>'};`,
    `/** Response of \`arbox.${o.id}()\` (${o.method} ${o.path}). */`,
    `export type ${o.typeBase}Response = ${o.hasJsonResponse ? `${P}['responses'][200]['content']['application/json']` : 'ArboxResponse'};`,
  );
}
write(
  'src/generated/types.ts',
  `${header}import type { paths } from './schema';

/** The envelope every Arbox v3 response uses. Operations whose response the spec leaves undocumented return this. */
export interface ArboxResponse<T = unknown> {
  statusCode?: 200 | 204;
  data?: T;
  extra?: unknown;
}

${typeLines.join('\n')}

export interface OperationTypes {
${ops.map((o) => `  ${q(o.id)}: { params: ${o.typeBase}Params; response: ${o.typeBase}Response };`).join('\n')}
}
`,
);

const doc = (o: OpInfo) => {
  const lines = [
    `**${o.summary}**${o.description && o.description !== o.summary ? `. ${o.description}` : ''}`,
    '',
  ];
  lines.push(`\`${o.method} ${o.path}\`${o.method === 'GET' ? '' : '. Writes to Arbox.'}`);
  if (o.required.length) lines.push('', `Required: ${o.required.map((r) => `\`${r}\``).join(', ')}.`);
  if (o.pageable)
    lines.push('', 'Paginated with `page` and `limit`; iterate every item with `arbox.paginate()`.');
  return `  /**\n${lines.map((l) => `   *${l ? ` ${l}` : ''}`).join('\n')}\n   */`;
};

const classes: string[] = [];
for (const resource of Object.keys(resources) as (keyof typeof resources)[]) {
  const mine = ops.filter((o) => o.resource === resource);
  classes.push(`/** ${resourceDocs[resource]} */
export class ${pascal(resource)}Resource {
  readonly #transport: Transport;

  constructor(transport: Transport) {
    this.#transport = transport;
  }

${mine
  .map(
    (o) => `${doc(o)}
  readonly ${o.name} = (params${o.required.length ? '' : '?'}: T.${o.typeBase}Params, options?: RequestOptions): Promise<T.${o.typeBase}Response> =>
    this.#transport.call(${q(o.id)}, params, options);`,
  )
  .join('\n\n')}
}`);
}
const resourceKeys = Object.keys(resources) as (keyof typeof resources)[];
write(
  'src/generated/resources.ts',
  `${header}import type { RequestOptions, Transport } from '../core/transport';
import type * as T from './types';

${classes.join('\n\n')}

export abstract class ArboxResources {
${resourceKeys.map((r) => `  /** ${resourceDocs[r]} */\n  readonly ${r}: ${pascal(r)}Resource;`).join('\n')}

  protected constructor(transport: Transport) {
${resourceKeys.map((r) => `    this.${r} = new ${pascal(r)}Resource(transport);`).join('\n')}
  }
}
`,
);

const table = resourceKeys
  .map((r) => {
    const rows = ops
      .filter((o) => o.resource === r)
      .map((o) => `| \`${o.id}()\` | \`${o.method} ${o.path}\` | ${o.summary} |`)
      .join('\n');
    return `<details>\n<summary><code>arbox.${r}</code>: ${resourceDocs[r]}</summary>\n\n| Method | Endpoint | Arbox name |\n| --- | --- | --- |\n${rows}\n\n</details>`;
  })
  .join('\n\n');
const readme = read('README.md');
const start = '<!-- api:start -->';
const end = '<!-- api:end -->';
const from = readme.indexOf(start);
const to = readme.indexOf(end);
if (from !== -1 && to > from) {
  write(
    'README.md',
    `${readme.slice(0, from + start.length)}\n\n${ops.length} methods, generated from the official OpenAPI document.\n\n${table}\n\n${readme.slice(to)}`,
  );
}

console.log(`Generated ${ops.length} operations across ${resourceKeys.length} resources.`);
