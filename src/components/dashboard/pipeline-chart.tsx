"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { useRouter } from "next/navigation";

const statusConfig: Record<string, { label: string; color: string }> = {
  INTERESTED: { label: "Interested", color: "#3B82F6" },
  APPLIED: { label: "Applied", color: "#EAB308" },
  SCREEN: { label: "Screen", color: "#F97316" },
  ONSITE: { label: "On-Site", color: "#A855F7" },
  OFFER: { label: "Offer", color: "#22C55E" },
  REJECTED: { label: "Rejected", color: "#EF4444" },
  CLOSED: { label: "Closed", color: "#9CA3AF" },
};

const statusOrder = ["INTERESTED", "APPLIED", "SCREEN", "ONSITE", "OFFER", "REJECTED", "CLOSED"];

interface PipelineChartProps {
  data: { status: string; count: number }[];
}

export function PipelineChart({ data }: PipelineChartProps) {
  const router = useRouter();

  const chartData = statusOrder.map((status) => {
    const match = data.find((d) => d.status === status);
    return {
      status,
      label: statusConfig[status]?.label ?? status,
      count: match?.count ?? 0,
      color: statusConfig[status]?.color ?? "#9CA3AF",
    };
  });

  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No applications yet.{" "}
        <button
          onClick={() => router.push("/pipeline")}
          className="text-blue-600 hover:underline"
        >
          Add one
        </button>
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={chartData} layout="vertical" margin={{ left: 10, right: 10 }}>
        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
        <YAxis
          type="category"
          dataKey="label"
          width={70}
          tick={{ fontSize: 12 }}
        />
        <Tooltip
          contentStyle={{ fontSize: 12, borderRadius: 8 }}
        />
        <Bar
          dataKey="count"
          radius={[0, 4, 4, 0]}
          cursor="pointer"
          onClick={() => router.push("/pipeline")}
        >
          {chartData.map((entry) => (
            <Cell key={entry.status} fill={entry.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
