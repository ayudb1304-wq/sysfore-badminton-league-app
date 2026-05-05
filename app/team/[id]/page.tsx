import { notFound } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getTeam, listMatches } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function TeamPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const team = await getTeam(id);
  if (!team) notFound();

  const allMatches = await listMatches();
  const teamMatches = allMatches.filter(
    (m) => m.teamAId === id || m.teamBId === id,
  );

  return (
    <div className="flex flex-col gap-6">
      <header>
        <Link
          href="/standings"
          className="text-xs text-muted-foreground hover:underline"
        >
          ← Standings
        </Link>
        <h1 className="text-2xl font-bold">{team.name}</h1>
        <p className="text-sm text-muted-foreground">{team.players}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Badge variant="outline">{team.categoryId}</Badge>
          <Badge variant="outline">{team.groupLabel}</Badge>
          <Badge variant="outline">Seed {team.seed}</Badge>
          {team.companyName && (
            <Badge variant="outline">{team.companyName}</Badge>
          )}
        </div>
      </header>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Matches</h2>
        {teamMatches.length === 0 ? (
          <p className="text-sm text-muted-foreground">No matches scheduled.</p>
        ) : (
          <div className="overflow-x-auto rounded border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Court</TableHead>
                  <TableHead>Opponent</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {teamMatches.map((m) => {
                  const isA = m.teamAId === id;
                  const opponent = isA
                    ? m.teamBName ?? "TBD"
                    : m.teamAName ?? "TBD";
                  const games = (m.games as Array<{ a: number; b: number }>) ?? [];
                  const score = games
                    .map((g) => (isA ? `${g.a}-${g.b}` : `${g.b}-${g.a}`))
                    .join(" ");
                  return (
                    <TableRow key={m.id}>
                      <TableCell>{m.scheduledTime}</TableCell>
                      <TableCell>
                        <Link href={`/court/${m.courtId}`} className="hover:underline">
                          {m.courtId}
                        </Link>
                      </TableCell>
                      <TableCell>{opponent}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {m.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {score || "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
