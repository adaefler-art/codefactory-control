import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AFU-9 Login",
  description: "AFU-9 Landing Page",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
