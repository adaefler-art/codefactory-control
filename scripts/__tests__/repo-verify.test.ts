import {
  computeCleanupReport,
  computeUnreferencedRoutes,
  normalizeApiPath,
} from '../repo-verify';

describe('repo-verify route registry contract', () => {
  test('counts registry-only routes as referenced', () => {
    const routes = [
      {
        filePath: 'control-center/app/api/alpha/route.ts',
        apiPath: '/api/alpha',
      },
    ];

    const calls = [];
    const registryPaths = ['/api/alpha'];

    const unreferenced = computeUnreferencedRoutes(routes, calls, registryPaths);

    expect(unreferenced).toHaveLength(0);
  });

  test('flags routes with no registry or client call', () => {
    const routes = [
      {
        filePath: 'control-center/app/api/beta/route.ts',
        apiPath: '/api/beta',
      },
    ];

    const calls = [];
    const registryPaths: string[] = [];

    const unreferenced = computeUnreferencedRoutes(routes, calls, registryPaths);

    expect(unreferenced).toHaveLength(1);
    expect(unreferenced[0].apiPath).toBe('/api/beta');
  });

  test('reports orphaned registry entries deterministically', () => {
    const routes: Array<{ filePath: string; apiPath: string }> = [];
    const calls = [];
    const registryPaths = ['/api/missing', '/api/alpha'];

    const report = computeCleanupReport(routes, calls, registryPaths);

    expect(report.orphanedRegistryPaths).toEqual(['/api/alpha', '/api/missing']);
    expect(report.unregisteredRoutes).toHaveLength(0);
  });

  test('normalizes template-literal registry paths', () => {
    const normalized = normalizeApiPath('/api/admin/cost-control/settings?env=${env}');

    expect(normalized).toBe('/api/admin/cost-control/settings');
  });
});
