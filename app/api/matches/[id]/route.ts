import { NextRequest, NextResponse } from "next/server";
import { getMatch } from "@/lib/queries";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const m = await getMatch(id);
  if (!m) {
    return NextResponse.json({ error: "match not found" }, { status: 404 });
  }
  return NextResponse.json(m);
}
