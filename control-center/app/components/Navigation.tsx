"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import DeployStatusBadge from "./DeployStatusBadge";
import { API_ROUTES } from "@/lib/api-routes";
import {
  type AuthState,
  getAuthState,
  setAuthState,
  subscribeAuthState,
  updateAuthStateFromResponse,
} from "@/lib/auth/auth-state";

type WhoamiData = {
  sub: string;
  isAdmin: boolean;
  deploymentEnv?: 'production' | 'staging' | 'development' | 'unknown';
};

export default function Navigation() {
  const pathname = usePathname();
  const router = useRouter();
  const [whoami, setWhoami] = useState<WhoamiData | null>(null);
  const [authState, setAuthStateValue] = useState<AuthState>(() => getAuthState());

  const navItems = [
    { href: "/intent", label: "INTENT" },
    { href: "/timeline", label: "Timeline" },
    { href: "/issues", label: "Issues" },
    { href: "/incidents", label: "Incidents" },
    { href: "/lawbook", label: "Lawbook" },
    { href: "/operate", label: "Operate" },
    { href: "/admin/lawbook", label: "Admin" },
    { href: "/settings", label: "Settings" },
  ];

  useEffect(() => {
    const unsubscribe = subscribeAuthState(setAuthStateValue);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    let mounted = true;
    const loadWhoami = async () => {
      try {
        const res = await fetch(API_ROUTES.ops.whoami, {
          credentials: 'include',
          cache: 'no-store',
        });
        updateAuthStateFromResponse(res);
        if (!mounted) return;
        if (!res.ok) {
          setWhoami(null);
          return;
        }
        const data = (await res.json()) as WhoamiData;
        setWhoami(data);
      } catch {
        if (!mounted) return;
        setWhoami(null);
      }
    };
    loadWhoami();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetch(API_ROUTES.ops.whoami, {
          credentials: 'include',
          cache: 'no-store',
        })
          .then((res) => {
            updateAuthStateFromResponse(res);
            return res.ok ? res.json() : null;
          })
          .then((data) => {
            if (data && typeof data === 'object' && 'sub' in data) {
              setWhoami(data as WhoamiData);
            } else if (data === null) {
              setWhoami(null);
            }
          })
          .catch(() => {
            // Keep previous state on transient network errors.
          });
      }
    }, 60000);

    return () => clearInterval(interval);
  }, []);

  const showCostControl = authState === 'authenticated' && whoami?.isAdmin && whoami?.deploymentEnv === 'staging';
  const isAuthenticated = authState === 'authenticated';
  const authStateLabel: Record<AuthState, string> = {
    authenticated: 'Session active',
    unauthenticated: 'Logged out',
    'refresh-required': 'Refresh required',
    invalid: 'Session expired',
    forbidden: 'Access denied',
    public: 'Public',
    service: 'Service',
    smoke: 'Smoke',
    unknown: 'Auth unknown',
  };
  const authStateClass = isAuthenticated
    ? 'bg-emerald-900/40 text-emerald-200 border-emerald-700/50'
    : 'bg-amber-900/30 text-amber-200 border-amber-700/50';

  const isActive = (href: string) => {
    return pathname === href;
  };

  const handleLogout = async () => {
    try {
      await fetch(API_ROUTES.auth.logout, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      setAuthState('unauthenticated');
      // Redirect to login page
      router.push("/login");
    } catch (error) {
      console.error("Logout error:", error);
      setAuthState('unauthenticated');
      // Redirect anyway
      router.push("/login");
    }
  };

  return (
    <nav className="bg-gray-900 border-b border-gray-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo/Branding */}
          <div className="flex items-center">
            <Link
              href="/intent"
              className="text-xl font-bold text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 transition-colors"
            >
              AFU-9 Control Center
            </Link>
          </div>

          {/* Navigation Links */}
          <div className="flex items-center space-x-1">
            {/* Deploy Status Badge */}
            <Link href="/deploy/status" className="mr-2">
              <DeployStatusBadge env="prod" />
            </Link>
            
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive(item.href)
                    ? "bg-purple-900/30 text-purple-200"
                    : "text-gray-200 hover:bg-gray-800 hover:text-white"
                }`}
              >
                {item.label}
              </Link>
            ))}

            {showCostControl && (
              <Link
                href="/admin/cost-control"
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive('/admin/cost-control')
                    ? 'bg-purple-900/30 text-purple-200'
                    : 'text-gray-200 hover:bg-gray-800 hover:text-white'
                }`}
              >
                Cost Control
              </Link>
            )}
            <span
              className={`ml-2 rounded-full border px-3 py-1 text-xs font-semibold ${authStateClass}`}
              aria-live="polite"
            >
              {authStateLabel[authState]}
            </span>
            {isAuthenticated ? (
              <button
                onClick={handleLogout}
                className="ml-2 px-4 py-2 rounded-md text-sm font-medium text-gray-200 hover:bg-red-900/30 hover:text-red-200 transition-colors"
              >
                Abmelden
              </button>
            ) : (
              <Link
                href="/login"
                className="ml-2 px-4 py-2 rounded-md text-sm font-medium text-gray-200 hover:bg-gray-800 hover:text-white transition-colors"
              >
                Login
              </Link>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
