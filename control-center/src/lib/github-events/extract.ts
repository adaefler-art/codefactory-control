import { createHash, randomUUID } from 'crypto';
import type { GithubActionEventEnvelope } from './types';

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeRepoFullName(envelope: GithubActionEventEnvelope): string | null {
  const direct = asNonEmptyString((envelope as any).repository_full_name) ?? asNonEmptyString((envelope as any).repo);
  if (direct) return direct;

  const repository = envelope.repository as any;
  const fullName = asNonEmptyString(repository?.full_name);
  if (fullName) return fullName;

  const owner = asNonEmptyString(repository?.owner?.login);
  const name = asNonEmptyString(repository?.name);
  if (owner && name) return `${owner}/${name}`;

  return null;
}

function normalizeEventName(envelope: GithubActionEventEnvelope): string | null {
  return asNonEmptyString((envelope as any).event_name) ?? asNonEmptyString((envelope as any).eventName) ?? null;
}

export function computeDeliveryId(envelope: GithubActionEventEnvelope, rawBody: string): string {
  const explicit = asNonEmptyString((envelope as any).delivery_id);
  if (explicit) return explicit;

  const runId = (envelope as any).run_id;
  const runIdStr = typeof runId === 'number' ? String(runId) : asNonEmptyString(runId);
  if (runIdStr) return `gha:${runIdStr}`;

  // Deterministic fallback: hash the raw body.
  // This is stable across SQS retries and protects against accidental duplicates.
  const hash = createHash('sha256').update(rawBody, 'utf8').digest('hex').slice(0, 32);
  return `sha256:${hash}`;
}

export function extractGithubEvent(envelope: GithubActionEventEnvelope, rawBody: string): {
  delivery_id: string;
  event_name: string | null;
  repository_full_name: string | null;
  envelope: Record<string, unknown>;
} {
  const delivery_id = computeDeliveryId(envelope, rawBody);
  const event_name = normalizeEventName(envelope);
  const repository_full_name = normalizeRepoFullName(envelope);

  return {
    delivery_id,
    event_name,
    repository_full_name,
    envelope: envelope as unknown as Record<string, unknown>,
  };
}

export function parseEnvelope(body: string): GithubActionEventEnvelope {
  const parsed = JSON.parse(body);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid event body: expected JSON object');
  }
  return parsed as GithubActionEventEnvelope;
}

export function newRequestId(): string {
  try {
    return randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}
