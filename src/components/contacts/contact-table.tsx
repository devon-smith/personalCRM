"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Sparkline } from "@/components/ui/sparkline";
import type { ContactWithCount } from "@/lib/hooks/use-contacts";
import { useMomentum } from "@/lib/hooks/use-momentum";
import { formatDistanceToNow } from "@/lib/date-utils";
import { getAvatarColor, getInitials } from "@/lib/avatar";
import { useMemo } from "react";

const sourceLabels: Record<string, string> = {
  MANUAL: "Manual",
  CSV_IMPORT: "CSV",
  GOOGLE_CONTACTS: "Google",
  GMAIL_DISCOVER: "Gmail",
  APPLE_CONTACTS: "Apple",
  IMESSAGE: "iMessage",
  LINKEDIN: "LinkedIn",
  WHATSAPP: "WhatsApp",
};

interface ContactTableProps {
  contacts: ContactWithCount[];
  onSelect: (id: string) => void;
  selectedId: string | null;
}

export function ContactTable({ contacts, onSelect, selectedId }: ContactTableProps) {
  const contactIds = useMemo(() => contacts.map((c) => c.id), [contacts]);
  const { data: momentumData } = useMomentum(contactIds);

  const momentumMap = useMemo(() => {
    const map = new Map<string, { sparkline: readonly number[]; trend: import("@/lib/momentum").MomentumTrend }>();
    for (const m of momentumData?.momentum ?? []) {
      map.set(m.contactId, { sparkline: m.sparkline, trend: m.trend });
    }
    return map;
  }, [momentumData]);

  if (contacts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
          <svg className="h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
          </svg>
        </div>
        <p className="text-sm font-medium text-gray-900">No contacts found</p>
        <p className="mt-1 text-[13px] text-gray-400">Try adjusting your search or filters</p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="border-b border-gray-100">
          <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Name</TableHead>
          <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Company</TableHead>
          <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Circles</TableHead>
          <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Momentum</TableHead>
          <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Last Contact</TableHead>
          <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Source</TableHead>
          <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Tags</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {contacts.map((contact) => {
          const avatarColor = getAvatarColor(contact.name);
          return (
            <TableRow
              key={contact.id}
              className={`cursor-pointer transition-all duration-150 h-[44px] ${
                selectedId === contact.id
                  ? "bg-gray-100 border-l-2 border-l-gray-900"
                  : "hover:bg-gray-50 border-l-2 border-l-transparent"
              }`}
              onClick={() => onSelect(contact.id)}
            >
              <TableCell className="py-1.5">
                <div className="flex items-center gap-2.5">
                  <Avatar className="h-7 w-7">
                    <AvatarFallback
                      className="text-[10px] font-semibold"
                      style={{ backgroundColor: avatarColor.bg, color: avatarColor.text }}
                    >
                      {getInitials(contact.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-gray-900 truncate">{contact.name}</p>
                    {contact.email && (
                      <p className="text-[11px] text-gray-400 truncate">{contact.email}</p>
                    )}
                  </div>
                </div>
              </TableCell>
              <TableCell className="py-1.5 text-[13px] text-gray-500">
                {contact.company ?? "—"}
              </TableCell>
              <TableCell className="py-1.5">
                <div className="flex flex-wrap gap-1">
                  {contact.circles?.slice(0, 2).map((cc) => (
                    <span
                      key={cc.circle.id}
                      className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
                      style={{ backgroundColor: `${cc.circle.color}15`, color: cc.circle.color }}
                    >
                      {cc.circle.name}
                    </span>
                  ))}
                  {!contact.circles?.length && (
                    <span className="text-[10px] text-gray-300">—</span>
                  )}
                </div>
              </TableCell>
              <TableCell className="py-1.5">
                {(() => {
                  const m = momentumMap.get(contact.id);
                  if (!m) return <span className="text-[10px] text-gray-300">—</span>;
                  return <Sparkline data={m.sparkline} trend={m.trend} />;
                })()}
              </TableCell>
              <TableCell className="py-1.5 text-[12px] text-gray-400">
                {contact.lastInteraction
                  ? formatDistanceToNow(new Date(contact.lastInteraction))
                  : "Never"}
              </TableCell>
              <TableCell className="py-1.5">
                <span className="text-[11px] text-gray-400">
                  {sourceLabels[contact.source] ?? "—"}
                </span>
              </TableCell>
              <TableCell className="py-1.5">
                <div className="flex flex-wrap gap-1">
                  {contact.tags.slice(0, 2).map((tag) => (
                    <Badge key={tag} variant="outline" className="text-[10px] px-1.5 py-0 text-gray-500 border-gray-200">
                      {tag}
                    </Badge>
                  ))}
                  {contact.tags.length > 2 && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-gray-400 border-gray-200">
                      +{contact.tags.length - 2}
                    </Badge>
                  )}
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
