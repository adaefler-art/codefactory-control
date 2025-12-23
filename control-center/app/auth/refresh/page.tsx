import { Suspense } from 'react';
import RefreshClient from './refresh-client';

export const dynamic = 'force-dynamic';

export default function AuthRefreshPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6">
          <h1 className="text-lg font-semibold">Refreshing session…</h1>
          <p className="mt-2 text-sm">Please wait.</p>
        </div>
      }
    >
      <RefreshClient />
    </Suspense>
  );
}
