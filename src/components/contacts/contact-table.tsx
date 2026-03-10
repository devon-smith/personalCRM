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
import type { ContactWithCount } from "@/lib/hooks/use-contacts";
import { formatDistanceToNow } from "@/lib/date-utils";
import { HealthBadge } from "@/components/insights/health-badge";

const tierColors: Record<string, string> = {
  INNER_CIRCLE: "bg-purple-100 text-purple-700",
  PROFESSIONAL: "bg-blue-100 text-blue-700",
  ACQUAINTANCE: "bg-gray-100 text-gray-700",
};

const tierLabels: Record<string, string> = {
  INNER_CIRCLE: "Inner Circle",
  PROFESSIONAL: "Professional",
  ACQUAINTANCE: "Acquaintance",
};

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

interface ContactTableProps {
  contacts: ContactWithCount[];
  onSelect: (id: string) => void;
  selectedId: string | null;
}

export function ContactTable({ contacts, onSelect, selectedId }: ContactTableProps) {
  if (contacts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-sm text-muted-foreground">No contacts found</p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Company</TableHead>
          <TableHead>Tier</TableHead>
          <TableHead>Health</TableHead>
          <TableHead>Last Contact</TableHead>
          <TableHead>Tags</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {contacts.map((contact) => (
          <TableRow
            key={contact.id}
            className={`cursor-pointer transition-colors ${selectedId === contact.id ? "bg-blue-50" : "hover:bg-gray-50"}`}
            onClick={() => onSelect(contact.id)}
          >
            <TableCell>
              <div className="flex items-center gap-3">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-blue-100 text-xs text-blue-700">
                    {getInitials(contact.name)}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-medium text-gray-900">{contact.name}</p>
                  {contact.email && (
                    <p className="text-xs text-gray-500">{contact.email}</p>
                  )}
                </div>
              </div>
            </TableCell>
            <TableCell className="text-gray-600">
              {contact.company ?? "—"}
            </TableCell>
            <TableCell>
              <Badge variant="secondary" className={tierColors[contact.tier]}>
                {tierLabels[contact.tier]}
              </Badge>
            </TableCell>
            <TableCell>
              <HealthBadge contactId={contact.id} compact />
            </TableCell>
            <TableCell className="text-gray-500 text-sm">
              {contact.lastInteraction
                ? formatDistanceToNow(new Date(contact.lastInteraction))
                : "Never"}
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {contact.tags.slice(0, 3).map((tag) => (
                  <Badge key={tag} variant="outline" className="text-xs">
                    {tag}
                  </Badge>
                ))}
                {contact.tags.length > 3 && (
                  <Badge variant="outline" className="text-xs">
                    +{contact.tags.length - 3}
                  </Badge>
                )}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
