import { getEffectiveHostname } from '../../src/lib/http/effective-hostname';

describe('getEffectiveHostname', () => {
  test('prefers Host header over x-forwarded-host and nextUrlHostname', () => {
    expect(
      getEffectiveHostname({
        hostHeader: 'stage.afu-9.com',
        forwardedHostHeader: 'prod.afu-9.com',
        nextUrlHostname: 'internal.local',
      })
    ).toBe('stage.afu-9.com');
  });

  test('falls back to x-forwarded-host when Host is missing', () => {
    expect(
      getEffectiveHostname({
        hostHeader: null,
        forwardedHostHeader: 'stage.afu-9.com',
        nextUrlHostname: 'internal.local',
      })
    ).toBe('stage.afu-9.com');
  });

  test('parses comma-separated and port-suffixed values', () => {
    expect(
      getEffectiveHostname({
        hostHeader: 'stage.afu-9.com:443',
        forwardedHostHeader: 'stage.afu-9.com:443, proxy.local',
        nextUrlHostname: 'internal.local:3000',
      })
    ).toBe('stage.afu-9.com');
  });
});
