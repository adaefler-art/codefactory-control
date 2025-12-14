import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';
import { PolicyDocument } from './types';

const POLICY_FILENAME = 'aegis.policy.yml';

export function loadPolicy(policyDir: string): PolicyDocument {
  const policyPath = path.join(policyDir, POLICY_FILENAME);
  if (!fs.existsSync(policyPath)) {
    throw new Error(`Policy file missing: ${policyPath}`);
  }

  const raw = fs.readFileSync(policyPath, 'utf8');
  if (!raw || raw.trim().length === 0) {
    throw new Error(`Policy file is empty: ${policyPath}`);
  }

  const doc = yaml.load(raw);
  if (!doc || typeof doc !== 'object') {
    throw new Error(`Policy file is not a valid YAML object: ${policyPath}`);
  }

  return doc as PolicyDocument;
}
