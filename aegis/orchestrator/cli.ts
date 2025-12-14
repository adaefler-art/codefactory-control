#!/usr/bin/env node
import * as fs from 'fs';
import { plan, execute } from './orchestrator';
import { renderLong, renderShort } from './explain';
import { VerdictDocument } from '../verdict/types';
import { ActionAdapter } from './types';

function loadVerdict(path: string): VerdictDocument {
  const raw = fs.readFileSync(path, 'utf8');
  return JSON.parse(raw) as VerdictDocument;
}

function parseArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return undefined;
}

async function main() {
  const cmd = process.argv[2];
  if (!cmd) {
    console.error('Usage: orchestrator <explain|plan|execute> --verdict <path> [--minConfidence <n>] [--dryRun]');
    process.exit(1);
  }

  const verdictPath = parseArg('--verdict');
  if (!verdictPath) {
    console.error('--verdict <path> is required');
    process.exit(1);
  }
  const minConfStr = parseArg('--minConfidence') ?? '0.85';
  const minConf = Number(minConfStr);
  const dryRun = process.argv.includes('--dryRun');
  const verdict = loadVerdict(verdictPath);

  switch (cmd) {
    case 'explain': {
      const p = plan(verdict, { autoExecuteMinConfidence: minConf });
      console.log(renderShort(verdict, p));
      console.log(renderLong(verdict, p));
      break;
    }
    case 'plan': {
      const p = plan(verdict, { autoExecuteMinConfidence: minConf });
      console.log(JSON.stringify(p, null, 2));
      break;
    }
    case 'execute': {
      const p = plan(verdict, { autoExecuteMinConfidence: minConf, dryRun });
      const adapters: ActionAdapter[] = [
        {
          name: 'noop',
          execute: () => ({ adapter: 'noop', status: 'SUCCESS', timestamp_utc: new Date().toISOString(), message: 'noop' }),
        },
      ];
      const result = await execute(verdict, p, adapters, { dryRun });
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    default:
      console.error(`Unknown command: ${cmd}`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
