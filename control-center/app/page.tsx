import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function Home() {
  // Redirect root to /intent (Steering-Loop entry point)
  redirect('/intent');
}
