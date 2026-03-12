"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  Users,
  CircleDot,
  Activity,
  Settings,
  Menu,
  X,
  Merge,
  Plug,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { UserNav } from "@/components/auth/user-nav";

const navItems = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/people", label: "People", icon: Users },
  { href: "/circles", label: "Circles", icon: CircleDot },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/integrations", label: "Integrations", icon: Plug },
  { href: "/merge", label: "Merge", icon: Merge },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function NavMenu() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, []);

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="flex h-9 w-9 items-center justify-center rounded-[10px] transition-[color,background-color]"
        style={{
          color: "var(--text-secondary)",
          transitionDuration: "var(--duration-fast)",
        }}
        aria-label="Navigation menu"
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {open && (
        <div
          className="absolute left-0 top-full z-50 mt-2 w-56 rounded-[14px] p-2"
          style={{
            backgroundColor: "var(--surface)",
            border: "1px solid var(--border)",
            boxShadow: "0 8px 32px rgba(26,25,23,0.10)",
          }}
        >
          <nav className="space-y-0.5">
            {navItems.map(({ href, label, icon: Icon }) => {
              const isActive = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex items-center gap-3 rounded-[10px] px-3 py-2 text-[13px]",
                    "transition-[color,background-color]",
                    isActive
                      ? "font-semibold"
                      : "",
                  )}
                  style={{
                    color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                    backgroundColor: isActive ? "var(--accent-soft)" : undefined,
                    borderLeft: isActive ? "2px solid var(--accent-color)" : "2px solid transparent",
                    transitionDuration: "var(--duration-fast)",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.backgroundColor = "var(--accent-soft)";
                      e.currentTarget.style.color = "var(--text-primary)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.backgroundColor = "";
                      e.currentTarget.style.color = "var(--text-secondary)";
                    }
                  }}
                >
                  <Icon className="h-[18px] w-[18px]" />
                  {label}
                </Link>
              );
            })}
          </nav>

          <div className="mt-2 pt-2" style={{ borderTop: "1px solid var(--border-subtle)" }}>
            <UserNav />
          </div>
        </div>
      )}
    </div>
  );
}
