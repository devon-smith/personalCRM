"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Kanban,
  MessageSquare,
  Bell,
  Brain,
  MapPin,
  Settings,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { UserNav } from "@/components/auth/user-nav";
import { useQuery } from "@tanstack/react-query";

const navItems = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/pipeline", label: "Pipeline", icon: Kanban },
  { href: "/interactions", label: "Interactions", icon: MessageSquare },
  { href: "/reminders", label: "Reminders", icon: Bell },
  { href: "/insights", label: "Insights", icon: Brain },
  { href: "/map", label: "Map", icon: MapPin },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();
  const { data: reminders } = useQuery<{ overdue: unknown[] }>({
    queryKey: ["reminders"],
    queryFn: async () => {
      const res = await fetch("/api/reminders");
      if (!res.ok) return { overdue: [] };
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });
  const overdueCount = reminders?.overdue?.length ?? 0;

  return (
    <aside
      className={cn(
        "flex h-screen flex-col border-r border-gray-200 bg-white transition-all duration-200",
        collapsed ? "w-[60px]" : "w-[240px]"
      )}
    >
      {/* Header */}
      <div
        className={cn(
          "flex h-14 items-center border-b border-gray-200 px-3",
          collapsed ? "justify-center" : "justify-between"
        )}
      >
        {!collapsed && (
          <span className="text-sm font-semibold text-gray-900">
            Personal CRM
          </span>
        )}
        <Button variant="ghost" size="icon" onClick={onToggle}>
          {collapsed ? (
            <PanelLeft className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-2 py-3">
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive =
            pathname === href || pathname.startsWith(`${href}/`);

          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                collapsed && "justify-center px-0",
                isActive
                  ? "bg-blue-50 font-semibold text-blue-700"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              )}
              title={collapsed ? label : undefined}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span className="flex-1">{label}</span>}
              {!collapsed && href === "/reminders" && overdueCount > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
                  {overdueCount}
                </span>
              )}
              {collapsed && href === "/reminders" && overdueCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                  {overdueCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* User section */}
      <Separator />
      <div className={cn("p-2", collapsed && "flex justify-center")}>
        <UserNav />
      </div>
    </aside>
  );
}
