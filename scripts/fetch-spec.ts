import { writeFileSync } from 'node:fs';

const DOCS_URL = 'https://arboxserver.arboxapp.com/docs/api';
const MARKER = 'docs.apiDescriptionDocument =';

const response = await fetch(DOCS_URL, { headers: { accept: 'text/html' } });
if (!response.ok) throw new Error(`GET ${DOCS_URL} returned ${response.status}`);
const html = await response.text();
const line = html.split('\n').find((l) => l.includes(MARKER));
if (!line) throw new Error(`No "${MARKER}" in ${DOCS_URL}; the docs page layout changed.`);

const json = line
  .slice(line.indexOf(MARKER) + MARKER.length)
  .trim()
  .replace(/;\s*$/, '');
const spec = JSON.parse(json) as { openapi?: string; paths?: Record<string, unknown> };
if (!spec.openapi || !spec.paths) throw new Error('The embedded document is not an OpenAPI description.');

writeFileSync(new URL('../openapi/arbox.json', import.meta.url), `${JSON.stringify(spec, null, 2)}\n`);
console.log(
  `Saved OpenAPI ${spec.openapi} with ${Object.keys(spec.paths).length} paths to openapi/arbox.json.`,
);
