import { NextRequest, NextResponse } from "next/server";
import { getStandings } from "@/lib/queries";

export async function GET(req: NextRequest) {
  const group = req.nextUrl.searchParams.get("group");
  if (!group) {
    return NextResponse.json({ error: "group param required" }, { status: 400 });
  }
  const data = await getStandings(group);
  if (!data) {
    return NextResponse.json({ error: "group not found" }, { status: 404 });
  }
  return NextResponse.json(data);
}
