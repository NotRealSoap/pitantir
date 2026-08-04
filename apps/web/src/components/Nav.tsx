"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Pitantir 2.0 primary chrome — see PITANTIR_2.md */
const links = [
  { href: "/api-board", label: "API" },
  { href: "/news", label: "News" },
  { href: "/lookup", label: "Player Lookup" },
  { href: "/duped", label: "Duped" },
  { href: "/extras", label: "Extras" },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="nav" aria-label="Primary">
      {links.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={active ? "active" : undefined}
            aria-current={active ? "page" : undefined}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
