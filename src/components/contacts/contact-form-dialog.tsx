"use client";

import { useState, useEffect, type FormEvent, type KeyboardEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";
import {
  useCreateContact,
  useUpdateContact,
  useContact,
} from "@/lib/hooks/use-contacts";
import type { ContactTier } from "@/generated/prisma/enums";
import { toast } from "sonner";

const tiers = [
  {
    value: "INNER_CIRCLE",
    label: "Inner Circle",
    description: "Close contacts you interact with frequently",
  },
  {
    value: "PROFESSIONAL",
    label: "Professional",
    description: "Work contacts and industry connections",
  },
  {
    value: "ACQUAINTANCE",
    label: "Acquaintance",
    description: "People you've met but don't know well yet",
  },
] as const;

interface ContactFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editId?: string | null;
}

export function ContactFormDialog({
  open,
  onOpenChange,
  editId,
}: ContactFormDialogProps) {
  const isEditing = !!editId;
  const { data: existing } = useContact(editId ?? null);
  const createContact = useCreateContact();
  const updateContact = useUpdateContact();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [tier, setTier] = useState<ContactTier>("PROFESSIONAL");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [country, setCountry] = useState("");
  const [notes, setNotes] = useState("");
  const [followUpDays, setFollowUpDays] = useState("");

  // Populate form when editing
  useEffect(() => {
    if (existing && isEditing) {
      setName(existing.name);
      setEmail(existing.email ?? "");
      setPhone(existing.phone ?? "");
      setCompany(existing.company ?? "");
      setRole(existing.role ?? "");
      setTier(existing.tier);
      setTags(existing.tags);
      setLinkedinUrl(existing.linkedinUrl ?? "");
      setCity(existing.city ?? "");
      setState(existing.state ?? "");
      setCountry(existing.country ?? "");
      setNotes(existing.notes ?? "");
      setFollowUpDays(existing.followUpDays?.toString() ?? "");
    }
  }, [existing, isEditing]);

  // Reset form when dialog closes
  useEffect(() => {
    if (!open) {
      setName("");
      setEmail("");
      setPhone("");
      setCompany("");
      setRole("");
      setTier("PROFESSIONAL");
      setTags([]);
      setTagInput("");
      setLinkedinUrl("");
      setCity("");
      setState("");
      setCountry("");
      setNotes("");
      setFollowUpDays("");
    }
  }, [open]);

  function handleTagKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && tagInput.trim()) {
      e.preventDefault();
      const newTag = tagInput.trim().toLowerCase();
      if (!tags.includes(newTag)) {
        setTags([...tags, newTag]);
      }
      setTagInput("");
    }
    if (e.key === "Backspace" && !tagInput && tags.length > 0) {
      setTags(tags.slice(0, -1));
    }
  }

  function removeTag(tag: string) {
    setTags(tags.filter((t) => t !== tag));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();

    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }

    const data = {
      name,
      email: email || null,
      phone: phone || null,
      company: company || null,
      role: role || null,
      tier,
      tags,
      linkedinUrl: linkedinUrl || null,
      city: city || null,
      state: state || null,
      country: country || null,
      notes: notes || null,
      followUpDays: followUpDays ? Number(followUpDays) : null,
    };

    if (isEditing && editId) {
      updateContact.mutate(
        { id: editId, ...data },
        {
          onSuccess: () => {
            toast.success("Contact updated");
            onOpenChange(false);
          },
          onError: (err) => toast.error(err.message),
        }
      );
    } else {
      createContact.mutate(data, {
        onSuccess: () => {
          toast.success("Contact created");
          onOpenChange(false);
        },
        onError: (err) => toast.error(err.message),
      });
    }
  }

  const isPending = createContact.isPending || updateContact.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit Contact" : "Add Contact"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name (required) */}
          <FormField label="Name *">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="John Doe"
              required
            />
          </FormField>

          {/* Email / Phone row */}
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Email">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="john@example.com"
              />
            </FormField>
            <FormField label="Phone">
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 (555) 000-0000"
              />
            </FormField>
          </div>

          {/* Company / Role row */}
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Company">
              <Input
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="Acme Inc"
              />
            </FormField>
            <FormField label="Role">
              <Input
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="Software Engineer"
              />
            </FormField>
          </div>

          {/* Tier selector */}
          <FormField label="Tier">
            <div className="space-y-2">
              {tiers.map((t) => (
                <label
                  key={t.value}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                    tier === t.value
                      ? "border-blue-500 bg-blue-50"
                      : "border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  <input
                    type="radio"
                    name="tier"
                    value={t.value}
                    checked={tier === t.value}
                    onChange={() => setTier(t.value)}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="text-sm font-medium">{t.label}</p>
                    <p className="text-xs text-gray-500">{t.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </FormField>

          {/* Tags */}
          <FormField label="Tags">
            <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-gray-200 px-3 py-2">
              {tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="gap-1 text-xs">
                  {tag}
                  <button
                    type="button"
                    onClick={() => removeTag(tag)}
                    className="ml-0.5 hover:text-red-600"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
                placeholder={tags.length === 0 ? "Type and press Enter" : ""}
                className="min-w-[100px] flex-1 bg-transparent text-sm outline-none"
              />
            </div>
          </FormField>

          {/* LinkedIn URL */}
          <FormField label="LinkedIn URL">
            <Input
              value={linkedinUrl}
              onChange={(e) => setLinkedinUrl(e.target.value)}
              placeholder="https://linkedin.com/in/johndoe"
            />
          </FormField>

          {/* Location */}
          <div className="grid grid-cols-3 gap-3">
            <FormField label="City">
              <Input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="San Francisco"
              />
            </FormField>
            <FormField label="State / Province">
              <Input
                value={state}
                onChange={(e) => setState(e.target.value)}
                placeholder="CA"
              />
            </FormField>
            <FormField label="Country">
              <Input
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                placeholder="US"
              />
            </FormField>
          </div>

          {/* Follow-up cadence */}
          <FormField label="Follow-up cadence (days)">
            <Input
              type="number"
              min={1}
              value={followUpDays}
              onChange={(e) => setFollowUpDays(e.target.value)}
              placeholder="30"
            />
          </FormField>

          {/* Notes */}
          <FormField label="Notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="How you met, topics to discuss..."
              rows={3}
              className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </FormField>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending
                ? "Saving..."
                : isEditing
                  ? "Save Changes"
                  : "Add Contact"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FormField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-gray-700">
        {label}
      </label>
      {children}
    </div>
  );
}
