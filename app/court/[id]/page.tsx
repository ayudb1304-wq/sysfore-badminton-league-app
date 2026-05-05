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
import { getCourt, listMatches } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function CourtPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const court = await getCourt(id);
  if (!court) notFound();

  const matches = await listMatches({ courtId: id });

  return (
    <div className="flex flex-col gap-6">
      <header>
        <Link
          href="/"
          className="text-xs text-muted-foreground hover:underline"
        >
          ← Live
        </Link>
        <h1 className="text-2xl font-bold">{court.name}</h1>
        <p className="text-sm text-muted-foreground">
          {matches.length} match{matches.length === 1 ? "" : "es"} today
        </p>
      </header>

      {matches.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No matches scheduled on this court.
        </p>
      ) : (
        <div className="overflow-x-auto rounded border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">Slot</TableHead>
                <TableHead>Time</TableHead>
                <TableHead>Cat / Stage</TableHead>
                <TableHead>Match</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {matches.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>{m.slotNumber ?? "—"}</TableCell>
                  <TableCell>{m.scheduledTime}</TableCell>
                  <TableCell className="text-xs">
                    {m.categoryId} ·{" "}
                    {m.stage === "group" ? m.groupId : m.roundLabel}
                  </TableCell>
                  <TableCell>
                    {m.teamAName ? (
                      <Link
                        href={`/team/${m.teamAId}`}
                        className="hover:underline"
                      >
                        {m.teamAName}
                      </Link>
                    ) : (
                      <span className="italic text-muted-foreground">TBD</span>
                    )}{" "}
                    <span className="text-muted-foreground">vs</span>{" "}
                    {m.teamBName ? (
                      <Link
                        href={`/team/${m.teamBId}`}
                        className="hover:underline"
                      >
                        {m.teamBName}
                      </Link>
                    ) : (
                      <span className="italic text-muted-foreground">TBD</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant="outline" className="capitalize">
                      {m.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
