import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { buildAfu9ControlOpenApiDocument } from '../src/lib/openapi/afu9ControlOpenapi.js';

const outputPath = path.join(
  process.cwd(),
  'src',
  'generated',
  'afu9-control-openapi.json'
);

const document = buildAfu9ControlOpenApiDocument();

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');

console.log(`OpenAPI spec written to ${outputPath}`);
