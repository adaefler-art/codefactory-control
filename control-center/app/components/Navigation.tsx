"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

export default function Navigation() {
  const pathname = usePathname();
  const router = useRouter();

  const navItems = [
    { href: "/workflows", label: "Workflows" },
    { href: "/agents", label: "Agents" },
    { href: "/features", label: "Features" },
    { href: "/new-feature", label: "New Feature" },
    { href: "/ninefold", label: "Ninefold" },
    { href: "/settings", label: "Settings" },
  ];

  const isActive = (href: string) => {
    return pathname === href;
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      // Redirect to login page
      router.push("/login");
    } catch (error) {
      console.error("Logout error:", error);
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
              href="/"
              className="text-xl font-bold text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 transition-colors"
            >
              AFU-9 Control Center
            </Link>
          </div>

          {/* Navigation Links */}
          <div className="flex items-center space-x-1">
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
            <button
              onClick={handleLogout}
              className="ml-2 px-4 py-2 rounded-md text-sm font-medium text-gray-200 hover:bg-red-900/30 hover:text-red-200 transition-colors"
            >
              Abmelden
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
