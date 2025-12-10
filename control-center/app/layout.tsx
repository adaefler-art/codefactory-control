import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AFU-9 Control Center",
  description: "Autonomous Fabrication Unit – Ninefold Architecture v0.1",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
