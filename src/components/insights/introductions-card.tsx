"use client";

import { Handshake, Loader2, Copy, Check } from "lucide-react";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useSuggestedIntroductions } from "@/lib/hooks/use-insights";

export function IntroductionsCard() {
  const { data, isLoading, error } = useSuggestedIntroductions();

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="mr-2 h-5 w-5 animate-spin text-purple-500" />
          <span className="text-sm text-muted-foreground">
            Analyzing your network for introductions...
          </span>
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Unable to generate introduction suggestions.
        </CardContent>
      </Card>
    );
  }

  const { introductions } = data;

  if (introductions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Handshake className="h-4 w-4 text-purple-500" />
            Suggested Introductions
          </CardTitle>
        </CardHeader>
        <CardContent className="text-center text-sm text-muted-foreground">
          Add more contacts with tags and roles to get introduction
          suggestions.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Handshake className="h-4 w-4 text-purple-500" />
          Suggested Introductions
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {introductions.map((intro, i) => (
          <IntroductionItem key={i} intro={intro} />
        ))}
      </CardContent>
    </Card>
  );
}

function IntroductionItem({
  intro,
}: {
  intro: {
    contact1: { id: string; name: string };
    contact2: { id: string; name: string };
    reason: string;
    icebreaker: string;
  };
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(intro.icebreaker);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-lg border border-gray-100 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-medium text-gray-900">
          {intro.contact1.name}
        </span>
        <span className="text-xs text-gray-400">↔</span>
        <span className="text-sm font-medium text-gray-900">
          {intro.contact2.name}
        </span>
      </div>
      <p className="mb-2 text-sm text-gray-600">{intro.reason}</p>
      <div className="flex items-start gap-2 rounded-md bg-purple-50 p-2">
        <p className="flex-1 text-xs text-purple-700">{intro.icebreaker}</p>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          onClick={handleCopy}
        >
          {copied ? (
            <Check className="h-3 w-3 text-green-500" />
          ) : (
            <Copy className="h-3 w-3 text-purple-400" />
          )}
        </Button>
      </div>
    </div>
  );
}
