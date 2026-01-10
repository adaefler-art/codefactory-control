import {
  MAX_EVIDENCE_PAYLOAD_BYTES,
  computeHash,
  redactSecrets,
} from '@/lib/intent-issue-evidence';

export type CostControlAction = 'settings_patch' | 'status_snapshot';

export interface CostControlEvidence {
  paramsJson: Record<string, any>;
  paramsHash: string;
  resultJson: Record<string, any>;
  resultHash: string;
}

function byteLengthUtf8(value: unknown): number {
  const json = JSON.stringify(value);
  return Buffer.byteLength(json, 'utf8');
}

export function createCostControlEvidence(options: {
  params: Record<string, any>;
  result: Record<string, any>;
}): CostControlEvidence {
  const redactedParams = redactSecrets(options.params);
  const redactedResult = redactSecrets(options.result);

  const totalBytes = byteLengthUtf8(redactedParams) + byteLengthUtf8(redactedResult);
  if (totalBytes > MAX_EVIDENCE_PAYLOAD_BYTES) {
    throw new Error(
      `Combined payload exceeds maximum size: ${totalBytes} bytes > ${MAX_EVIDENCE_PAYLOAD_BYTES} bytes`
    );
  }

  return {
    paramsJson: redactedParams,
    paramsHash: computeHash(redactedParams),
    resultJson: redactedResult,
    resultHash: computeHash(redactedResult),
  };
}
