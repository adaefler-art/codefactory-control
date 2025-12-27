# Next.js Routing Patterns

This document describes the canonical patterns for handling routing in the Control Center.

## Dynamic Route Parameters in Client Components

### Background

In Next.js 15+, the `params` prop in page components is **always a Promise** for client components (`"use client"`). This is part of Next.js's migration towards async components and better server-side rendering support.

### Canonical Pattern

For client components with dynamic routes, **always use the `use` hook** from React to unwrap params:

```typescript
"use client";

import { use } from "react";

export default function MyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  
  // Use id directly
  // ...
}
```

### Why This Pattern?

1. **Type Safety**: TypeScript enforces that params is a Promise, catching potential runtime errors at compile time
2. **Consistency**: Works correctly in all rendering scenarios (SSR, client navigation, etc.)
3. **Future-Proof**: Aligns with Next.js 15+ recommendations and future versions
4. **Simplicity**: Single, predictable pattern across all dynamic route pages

### ❌ Anti-Patterns (Do Not Use)

#### Conditional Promise Checking
```typescript
// ❌ DON'T: Complex conditional logic
const resolvedParams = 
  typeof (params as any)?.then === "function" 
    ? use(params as Promise<{ id: string }>) 
    : (params as { id: string });
```

This pattern was used for backwards compatibility but is no longer needed in Next.js 15+.

#### Using useParams Hook
```typescript
// ❌ DON'T: useParams in pages with params prop
import { useParams } from "next/navigation";

export default function MyPage({ params }: { params: Promise<{ id: string }> }) {
  const routeParams = useParams();  // Redundant
  // ...
}
```

While `useParams()` works, it's redundant when the page receives params as a prop. Use the params prop directly with `use()`.

### Multiple Dynamic Segments

For routes with multiple dynamic segments (e.g., `/workflows/[workflowId]/executions/[executionId]`):

```typescript
export default function ExecutionPage({
  params,
}: {
  params: Promise<{ workflowId: string; executionId: string }>;
}) {
  const { workflowId, executionId } = use(params);
  
  // Use both params
  // ...
}
```

### When to Use useParams Hook

Use `useParams()` only when:
- You need route params in a component that is **not** a page component (e.g., a shared component)
- The component doesn't receive params as a prop

```typescript
// ✅ OK: In a non-page component
"use client";

import { useParams } from "next/navigation";

export function NavigationBreadcrumb() {
  const params = useParams();
  const id = params?.id as string;
  
  return <div>Item: {id}</div>;
}
```

## References

- Next.js 15+ uses async params: https://nextjs.org/docs/app/building-your-application/upgrading/version-15#params--searchparams
- React `use` hook: https://react.dev/reference/react/use

## Migration Checklist

When updating existing pages to use the canonical pattern:

- [ ] Change params type to `Promise<{ ... }>`
- [ ] Import `use` from React
- [ ] Replace any conditional logic with `const { id } = use(params)`
- [ ] Remove any `useParams()` calls if params is available as prop
- [ ] Test page works correctly on both direct navigation and client-side routing
