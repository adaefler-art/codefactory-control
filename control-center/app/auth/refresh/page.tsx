'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export const dynamic = 'force-dynamic';

function safeRedirectTo(value: string | null): string {
  if (!value) return '/dashboard';
  // Prevent open redirects; allow only same-site absolute paths.
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  return '/dashboard';
}

export default function AuthRefreshPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'refreshing' | 'failed'>('refreshing');

  useEffect(() => {
    const redirectTo = safeRedirectTo(searchParams.get('redirectTo'));

    const run = async () => {
      try {
        const res = await fetch('/api/auth/refresh', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify({}),
          cache: 'no-store',
        });

        if (!res.ok) {
          setStatus('failed');
          router.replace('/login');
          return;
        }

        router.replace(redirectTo);
      } catch {
        setStatus('failed');
        router.replace('/login');
      }
    };

    run();
  }, [router, searchParams]);

  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold">Refreshing session…</h1>
      {status === 'failed' ? (
        <p className="mt-2 text-sm">Refresh failed. Redirecting…</p>
      ) : (
        <p className="mt-2 text-sm">Please wait.</p>
      )}
    </div>
  );
}
