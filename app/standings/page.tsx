import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { getStandings, listAllGroups, listCategories } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function StandingsPage() {
  const [categories, groups] = await Promise.all([
    listCategories(),
    listAllGroups(),
  ]);

  const groupsByCat = new Map<string, typeof groups>();
  for (const g of groups) {
    if (!groupsByCat.has(g.categoryId)) groupsByCat.set(g.categoryId, []);
    groupsByCat.get(g.categoryId)!.push(g);
  }

  // Pre-fetch all standings in parallel.
  const allStandings = await Promise.all(
    groups.map((g) => getStandings(g.id)),
  );
  const standingsById = new Map<string, NonNullable<(typeof allStandings)[number]>>();
  for (const s of allStandings) if (s) standingsById.set(s.groupId, s);

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-bold">Standings</h1>
        <p className="text-sm text-muted-foreground">
          Top 2 per group qualify (badge: Q).
        </p>
      </header>

      <Tabs defaultValue={categories[0]?.id ?? "MB"}>
        <TabsList>
          {categories.map((c) => (
            <TabsTrigger key={c.id} value={c.id}>
              {c.name}
            </TabsTrigger>
          ))}
        </TabsList>

        {categories.map((c) => {
          const cgroups = groupsByCat.get(c.id) ?? [];
          return (
            <TabsContent key={c.id} value={c.id} className="pt-4">
              <Tabs defaultValue={cgroups[0]?.id}>
                <TabsList>
                  {cgroups.map((g) => (
                    <TabsTrigger key={g.id} value={g.id}>
                      {g.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
                {cgroups.map((g) => {
                  const s = standingsById.get(g.id);
                  return (
                    <TabsContent key={g.id} value={g.id} className="pt-3">
                      {s ? <StandingsTable s={s} /> : <p>Loading…</p>}
                    </TabsContent>
                  );
                })}
              </Tabs>
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}

type StandingsViewT = NonNullable<Awaited<ReturnType<typeof getStandings>>>;

function StandingsTable({ s }: { s: StandingsViewT }) {
  return (
    <div className="overflow-x-auto rounded border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">#</TableHead>
            <TableHead>Team</TableHead>
            <TableHead className="text-right">P</TableHead>
            <TableHead className="text-right">W</TableHead>
            <TableHead className="text-right">L</TableHead>
            <TableHead className="text-right">Pts</TableHead>
            <TableHead className="text-right">Set Diff</TableHead>
            <TableHead className="text-right">Pts Diff</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {s.rows.map((r) => (
            <TableRow key={r.teamId} className={r.isQualifier ? "bg-primary/5" : ""}>
              <TableCell className="font-medium">{r.rank}</TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{r.teamName}</span>
                  {r.isQualifier && (
                    <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-600">
                      Q
                    </Badge>
                  )}
                  {s.overrideApplied && r.isQualifier && (
                    <Badge variant="outline">TD override</Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">{r.players}</div>
              </TableCell>
              <TableCell className="text-right">{r.played}</TableCell>
              <TableCell className="text-right">{r.wins}</TableCell>
              <TableCell className="text-right">{r.losses}</TableCell>
              <TableCell className="text-right font-semibold">{r.points}</TableCell>
              <TableCell className="text-right">
                {r.setsWon - r.setsLost > 0 && "+"}
                {r.setsWon - r.setsLost}
              </TableCell>
              <TableCell className="text-right">
                {r.ptsScored - r.ptsConceded > 0 && "+"}
                {r.ptsScored - r.ptsConceded}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
