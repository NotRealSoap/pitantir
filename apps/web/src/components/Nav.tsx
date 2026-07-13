"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/accounts", label: "Accounts" },
  { href: "/items", label: "Items" },
  { href: "/search", label: "Search" },
  { href: "/scans", label: "Scans" },
  { href: "/settings", label: "Settings" },
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
