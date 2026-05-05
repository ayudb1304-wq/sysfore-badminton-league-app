"use client";

import useSWR from "swr";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { MatchListRow } from "@/lib/queries";

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json() as Promise<MatchListRow[]>;
  });

export function LiveDashboard() {
  const { data: live, error: liveErr } = useSWR<MatchListRow[]>(
    "/api/matches?status=live",
    fetcher,
    { refreshInterval: 5000 },
  );
  const { data: scheduled } = useSWR<MatchListRow[]>(
    "/api/matches?status=scheduled",
    fetcher,
    { refreshInterval: 10000 },
  );
  const { data: completed } = useSWR<MatchListRow[]>(
    "/api/matches?status=completed",
    fetcher,
    { refreshInterval: 10000 },
  );

  if (liveErr) {
    return (
      <p className="text-sm text-destructive">
        Failed to load live matches. Refresh to retry.
      </p>
    );
  }

  const isLoading = !live;
  const nothingHappening =
    !isLoading &&
    (live?.length ?? 0) === 0 &&
    (completed?.length ?? 0) === 0;

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  if (nothingHappening) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          Tournament hasn&apos;t started — first slot at 09:00.
        </CardContent>
      </Card>
    );
  }

  const liveMatches = live ?? [];
  const upcoming = (scheduled ?? []).slice(0, 6);
  const recent = (completed ?? []).slice(-3).reverse();

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="mb-3 text-lg font-semibold">
          Live now <Badge variant="secondary">{liveMatches.length}</Badge>
        </h2>
        {liveMatches.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No matches in progress right now.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {liveMatches.map((m) => (
              <MatchCard key={m.id} m={m} />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Up next</h2>
        {upcoming.length === 0 ? (
          <p className="text-sm text-muted-foreground">No more matches scheduled.</p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {upcoming.map((m) => (
              <MatchRow key={m.id} m={m} />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Recent results</h2>
        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">No completed matches yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {recent.map((m) => (
              <MatchRow key={m.id} m={m} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function MatchCard({ m }: { m: MatchListRow }) {
  return (
    <Link href={`/court/${m.courtId}`} className="block">
      <Card className="border-primary/40 transition-colors hover:border-primary">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {m.courtId} · {m.scheduledTime}
            </span>
            <Badge variant="default" className="bg-red-500 hover:bg-red-500">
              LIVE
            </Badge>
          </div>
          <CardTitle className="text-base">
            {m.teamAName ?? "TBD"} vs {m.teamBName ?? "TBD"}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 text-sm text-muted-foreground">
          {m.categoryId} · {m.groupId ?? m.roundLabel}
        </CardContent>
      </Card>
    </Link>
  );
}

function MatchRow({ m }: { m: MatchListRow }) {
  return (
    <Link
      href={`/court/${m.courtId}`}
      className="flex items-center justify-between rounded border border-border px-3 py-2 text-sm hover:bg-muted"
    >
      <span className="flex-1 truncate">
        <span className="font-medium">{m.teamAName ?? "TBD"}</span>
        <span className="px-2 text-muted-foreground">vs</span>
        <span className="font-medium">{m.teamBName ?? "TBD"}</span>
      </span>
      <span className="ml-3 shrink-0 text-xs text-muted-foreground">
        {m.scheduledTime} · {m.courtId}
      </span>
    </Link>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-24 animate-pulse rounded border border-border bg-muted/40"
        />
      ))}
    </div>
  );
}
