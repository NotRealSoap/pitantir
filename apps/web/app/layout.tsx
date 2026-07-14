import type { ReactNode } from "react";
import { Manrope, Sora, IBM_Plex_Mono } from "next/font/google";
import { Nav } from "../src/components/Nav";
import { LiveStatusBar } from "../src/components/LiveStatusBar";
import "./globals.css";

const sora = Sora({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "600", "700"],
});

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500", "600", "700"],
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500"],
});

export const metadata = {
  title: "Pitantir",
  description: "Track Hypixel Pit mystic items across accounts by nonce",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sora.variable} ${manrope.variable} ${plexMono.variable}`}>
      <body>
        <div className="shell">
          <header className="topbar">
            <a className="brand" href="/">
              <span className="brand-mark" aria-hidden="true" />
              <span>
                <span className="brand-accent">Pit</span>antir
              </span>
            </a>
            <Nav />
          </header>
          <LiveStatusBar />
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
