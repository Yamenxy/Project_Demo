/** Module boundary rules. See docs/architecture.md §2. */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'web-not-into-api',
      comment: 'The web client talks to the API over HTTP only.',
      severity: 'error',
      from: { path: '^apps/web/' },
      to: { path: '^apps/api/' },
    },
    {
      name: 'api-not-into-web',
      severity: 'error',
      from: { path: '^apps/api/' },
      to: { path: '^apps/web/' },
    },
    {
      name: 'module-public-api-only',
      comment:
        "A module may use another module only through that module's index.ts (its public API).",
      severity: 'error',
      from: { path: '^apps/api/src/modules/([^/]+)/' },
      to: {
        path: '^apps/api/src/modules/[^/]+/',
        pathNot: ['^apps/api/src/modules/$1/', '^apps/api/src/modules/[^/]+/index[.]ts$'],
      },
    },
    {
      name: 'platform-db-restricted',
      comment:
        'Cross-workspace database access is limited to the tenancy and platform-admin modules (architecture �4).',
      severity: 'error',
      from: {
        path: '^apps/api/src/',
        pathNot: [
          '^apps/api/src/database/',
          '^apps/api/src/jobs/',
          '^apps/api/src/modules/(tenancy|platform-admin)/',
        ],
      },
      to: { path: '^apps/api/src/database/platform-db[.]ts$' },
    },
    {
      name: 'database-public-api-only',
      comment: 'Modules use the database layer through src/database/index.ts.',
      severity: 'error',
      from: { path: '^apps/api/src/modules/' },
      to: {
        path: '^apps/api/src/database/',
        pathNot: ['^apps/api/src/database/index[.]ts$', '^apps/api/src/database/platform-db[.]ts$'],
      },
    },
    {
      name: 'no-unresolvable',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: ['(^|/)(dist|[.]next|coverage)/', 'next-env[.]d[.]ts$'] },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      extensions: ['.ts', '.tsx', '.mts', '.js', '.mjs', '.cjs', '.json'],
      conditionNames: ['import', 'require', 'node', 'types', 'default'],
      exportsFields: ['exports'],
    },
  },
};
