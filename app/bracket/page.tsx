import Link from "next/link";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getBracket, knownBracketCategories } from "@/lib/queries";
import type { BracketCard } from "@/lib/queries";
import type { CategoryId } from "@/lib/brackets";

export const dynamic = "force-dynamic";

const CATEGORY_LABEL: Record<CategoryId, string> = {
  MB: "Men's Beginner",
  MI: "Men's Intermediate",
  W: "Women's",
};

export default async function BracketPage() {
  const cats = knownBracketCategories();
  const allBrackets = await Promise.all(cats.map((c) => getBracket(c)));

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-bold">Knockout Bracket</h1>
        <p className="text-sm text-muted-foreground">
          Cards populate automatically once group winners are decided.
        </p>
      </header>

      <Tabs defaultValue={cats[0]}>
        <TabsList>
          {cats.map((c) => (
            <TabsTrigger key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </TabsTrigger>
          ))}
        </TabsList>
        {cats.map((c, i) => (
          <TabsContent key={c} value={c} className="pt-4">
            <BracketTree cards={allBrackets[i]} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function BracketTree({ cards }: { cards: BracketCard[] }) {
  const qfs = cards.filter((c) => c.stage === "qf");
  const sfs = cards.filter((c) => c.stage === "sf");
  const finals = cards.filter((c) => c.stage === "final");

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
      {qfs.length > 0 && (
        <Column title="Quarterfinals" cards={qfs} />
      )}
      <Column title="Semifinals" cards={sfs} />
      <Column title="Final" cards={finals} />
    </div>
  );
}

function Column({ title, cards }: { title: string; cards: BracketCard[] }) {
  if (cards.length === 0) return null;
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
        {title}
      </h2>
      <div className="flex flex-col gap-3">
        {cards.map((c) => (
          <BracketCardView key={c.id} card={c} />
        ))}
      </div>
    </div>
  );
}

function BracketCardView({ card }: { card: BracketCard }) {
  const isComplete = card.status === "completed";
  const aWon = isComplete && card.winnerTeamId === card.teamAId;
  const bWon = isComplete && card.winnerTeamId === card.teamBId;

  return (
    <Link href={`/match/${card.id}`} className="block">
      <Card className="transition-colors hover:border-primary">
        <CardHeader className="pb-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {card.code} · {card.scheduledTime} · {card.courtId}
            </span>
            <Badge variant="outline" className="text-xs capitalize">
              {card.status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <Side label={card.teamALabel} games={card.games.map((g) => g.a)} won={aWon} placeholder={!card.teamAId} />
          <div className="my-1 border-t border-border/60" />
          <Side label={card.teamBLabel} games={card.games.map((g) => g.b)} won={bWon} placeholder={!card.teamBId} />
        </CardContent>
      </Card>
    </Link>
  );
}

function Side(props: {
  label: string;
  games: number[];
  won: boolean;
  placeholder: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span
        className={
          props.won
            ? "font-semibold text-foreground"
            : props.placeholder
            ? "italic text-muted-foreground"
            : ""
        }
      >
        {props.label}
      </span>
      <span className="ml-2 font-mono text-sm tabular-nums">
        {props.games.length === 0 ? "—" : props.games.join(" ")}
      </span>
    </div>
  );
}
