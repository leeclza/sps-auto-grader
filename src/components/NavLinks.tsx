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
    <nav className="order-3 flex basis-full gap-1 overflow-x-auto md:order-0 md:flex-1 md:basis-auto">
      {LINKS.map((l) => {
        const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href) || (l.href === "/classroom" && pathname.startsWith("/assignments"));
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`relative rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors hover:bg-surface-2 hover:text-ink after:absolute after:inset-x-3 after:bottom-px after:h-0.5 after:origin-left after:rounded-sm after:bg-primary after:transition-transform after:duration-350 after:ease-out-soft ${
              active ? "text-ink after:scale-x-100" : "text-muted after:scale-x-0"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
