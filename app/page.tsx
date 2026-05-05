import { LiveDashboard } from "@/components/live-dashboard";

export default function HomePage() {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-bold">SBL 2026 — Live</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Auto-refreshes every 5 seconds.
      </p>
      <LiveDashboard />
    </div>
  );
}
