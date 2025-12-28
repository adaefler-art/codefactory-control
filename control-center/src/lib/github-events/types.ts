export interface GithubActionEventEnvelope {
  // Optional explicit idempotency key (recommended).
  delivery_id?: string;

  // GitHub Actions context fields (when publishing `toJson(github)`)
  event_name?: string;
  repository?: {
    full_name?: string;
    name?: string;
    owner?: { login?: string };
  };

  // Common alternatives
  eventName?: string;
  repo?: string;
  repository_full_name?: string;
  run_id?: number | string;

  // Allow arbitrary additional payload
  [key: string]: unknown;
}

export interface GithubEventRecord {
  delivery_id: string;
  event_name: string | null;
  repository_full_name: string | null;
  envelope: Record<string, unknown>;
  received_at: string;
  processed: boolean;
  processed_at: string | null;
  error: string | null;
}
