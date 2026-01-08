/**
 * Custom ESLint rule to enforce admin endpoint authentication patterns
 * 
 * This rule warns when files in app/api/ops/** or app/api/admin/** don't use
 * standardized authentication patterns:
 * - checkProdWriteGuard from @/lib/guards/prod-write-guard
 * - OR local isAdminUser() function
 * 
 * Exception: GET endpoints that are read-only diagnostics (like /api/whoami)
 */

// @ts-check

/**
 * @type {import('eslint').Rule.RuleModule}
 */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Enforce standardized admin authentication in ops/admin endpoints',
      category: 'Security',
      recommended: true,
    },
    messages: {
      missingAdminGuard:
        'Admin endpoint missing standardized authentication. Use checkProdWriteGuard() or implement isAdminUser() function. See docs/CONTRIBUTING.md',
    },
    schema: [],
  },

  create(context) {
    const filename = context.getFilename();
    
    // Only check files in app/api/ops/** or app/api/admin/**
    const isAdminEndpoint = 
      filename.includes('/app/api/ops/') || 
      filename.includes('/app/api/admin/') ||
      filename.includes('\\app\\api\\ops\\') ||
      filename.includes('\\app\\api\\admin\\');
    
    if (!isAdminEndpoint) {
      return {};
    }
    
    // Skip non-route files
    if (!filename.endsWith('route.ts') && !filename.endsWith('route.tsx')) {
      return {};
    }
    
    let hasCheckProdWriteGuard = false;
    let hasIsAdminUser = false;
    let hasAdminSubsCheck = false;
    
    return {
      // Check for checkProdWriteGuard import
      ImportDeclaration(node) {
        if (
          node.source.value === '@/lib/guards/prod-write-guard' &&
          node.specifiers.some(
            (spec) =>
              spec.type === 'ImportSpecifier' &&
              spec.imported.name === 'checkProdWriteGuard'
          )
        ) {
          hasCheckProdWriteGuard = true;
        }
      },
      
      // Check for isAdminUser function declaration
      FunctionDeclaration(node) {
        if (node.id && node.id.name === 'isAdminUser') {
          hasIsAdminUser = true;
        }
      },
      
      // Check for inline AFU9_ADMIN_SUBS checks
      MemberExpression(node) {
        if (
          node.object.type === 'MemberExpression' &&
          node.object.object.name === 'process' &&
          node.object.property.name === 'env' &&
          node.property.name === 'AFU9_ADMIN_SUBS'
        ) {
          hasAdminSubsCheck = true;
        }
      },
      
      // Report if missing at end of file
      'Program:exit'(node) {
        const hasStandardizedAuth = 
          hasCheckProdWriteGuard || 
          hasIsAdminUser || 
          hasAdminSubsCheck;
        
        if (!hasStandardizedAuth) {
          context.report({
            node,
            messageId: 'missingAdminGuard',
          });
        }
      },
    };
  },
};
