export function getEffectiveHostname(input: {
  nextUrlHostname?: string | null;
  hostHeader?: string | null;
  forwardedHostHeader?: string | null;
}): string {
  const parse = (value: string | null | undefined): string => {
    const raw = (value || '').trim();
    if (!raw) return '';

    // Header can be a comma-separated list: take first.
    const first = raw.split(',')[0]?.trim() ?? '';
    if (!first) return '';

    // Strip :port if present.
    return (first.split(':')[0]?.trim().toLowerCase() ?? '');
  };

  // Prefer host headers (proxy-safe) over URL hostname (which can be internal in ECS/ALB setups).
  const host = parse(input.hostHeader);
  if (host) return host;

  const forwarded = parse(input.forwardedHostHeader);
  if (forwarded) return forwarded;

  return parse(input.nextUrlHostname);
}
