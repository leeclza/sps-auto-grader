"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Beranda" },
  { href: "/classroom", label: "Google Classroom" },
  { href: "/materials", label: "Materi" },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav>
      {LINKS.map((l) => {
        const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href) || (l.href === "/classroom" && pathname.startsWith("/assignments"));
        return (
          <Link key={l.href} href={l.href} className={`nav-link${active ? " active" : ""}`}>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
