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
import { listMatches } from "@/lib/queries";

type SP = { [k: string]: string | string[] | undefined };

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const status = pickString(sp.status);
  const categoryId = pickString(sp.category);
  const groupId = pickString(sp.group);
  const courtId = pickString(sp.court);

  const matches = await listMatches({ status, categoryId, groupId, courtId });

  const filters = [
    {
      label: "Category",
      param: "category",
      current: categoryId,
      options: [
        ["MB", "Men's Beginner"],
        ["MI", "Men's Intermediate"],
        ["W", "Women's"],
      ] as const,
    },
    {
      label: "Court",
      param: "court",
      current: courtId,
      options: [
        ["C1", "Court 1"],
        ["C2", "Court 2"],
        ["C3", "Court 3"],
        ["C4", "Court 4"],
        ["C5", "Court 5"],
        ["C6", "Court 6"],
      ] as const,
    },
    {
      label: "Status",
      param: "status",
      current: status,
      options: [
        ["scheduled", "Scheduled"],
        ["live", "Live"],
        ["completed", "Completed"],
      ] as const,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold">Schedule</h1>
        <p className="text-sm text-muted-foreground">
          {matches.length} match{matches.length === 1 ? "" : "es"} found
        </p>
      </header>

      <section className="flex flex-wrap gap-4 rounded border border-border p-3">
        {filters.map((f) => (
          <FilterPills key={f.param} {...f} />
        ))}
      </section>

      {matches.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No matches match those filters.
        </p>
      ) : (
        <div className="overflow-x-auto rounded border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Slot</TableHead>
                <TableHead>Time</TableHead>
                <TableHead>Court</TableHead>
                <TableHead>Cat / Stage</TableHead>
                <TableHead>Match</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {matches.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>{m.slotNumber ?? "-"}</TableCell>
                  <TableCell>{m.scheduledTime}</TableCell>
                  <TableCell>
                    <Link
                      href={`/court/${m.courtId}`}
                      className="hover:underline"
                    >
                      {m.courtId}
                    </Link>
                  </TableCell>
                  <TableCell className="text-xs">
                    {m.categoryId} · {m.stage === "group" ? m.groupId : m.roundLabel}
                  </TableCell>
                  <TableCell>
                    {m.teamAName ?? labelFromSource(m.teamASource)} <span className="text-muted-foreground">vs</span> {m.teamBName ?? labelFromSource(m.teamBSource)}
                  </TableCell>
                  <TableCell className="text-right">
                    <StatusBadge status={m.status} />
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

function pickString(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

function labelFromSource(s: string | null): string {
  if (!s) return "TBD";
  const [kind, value] = s.split(":");
  if (kind === "group_winner") return `${formatGroup(value)} Winner`;
  if (kind === "group_runner") return `${formatGroup(value)} Runner-up`;
  if (kind === "match_winner") return `${value} Winner`;
  return s;
}
function formatGroup(code: string): string {
  return `${code.slice(0, -1)}-${code.slice(-1)}`;
}

function StatusBadge({ status }: { status: string }) {
  const variant: Record<string, { label: string; className: string }> = {
    scheduled: { label: "Scheduled", className: "" },
    live: { label: "LIVE", className: "bg-red-500 hover:bg-red-500 text-white" },
    completed: { label: "Done", className: "bg-green-600 hover:bg-green-600 text-white" },
    walkover: { label: "WO", className: "" },
    void: { label: "Void", className: "" },
  };
  const { label, className } = variant[status] ?? { label: status, className: "" };
  return <Badge className={className}>{label}</Badge>;
}

function FilterPills(props: {
  label: string;
  param: string;
  current: string | undefined;
  options: ReadonlyArray<readonly [string, string]>;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-semibold uppercase text-muted-foreground">
        {props.label}
      </span>
      <Pill
        href={withoutParam()}
        active={!props.current}
        label="All"
      />
      {props.options.map(([value, label]) => (
        <Pill
          key={value}
          href={withParam(props.param, value)}
          active={props.current === value}
          label={label}
        />
      ))}
    </div>
  );
}

function Pill({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={
        active
          ? "rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground"
          : "rounded-full border border-border px-3 py-1 text-xs hover:bg-muted"
      }
    >
      {label}
    </Link>
  );
}

function withParam(param: string, value: string): string {
  // Build URL preserving other query params is tricky from a server component
  // without `usePathname`. The schedule page is the only consumer — link to itself.
  const usp = new URLSearchParams();
  usp.set(param, value);
  return `/schedule?${usp.toString()}`;
}
function withoutParam(): string {
  return `/schedule`;
}
