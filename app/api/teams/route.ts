import { NextRequest, NextResponse } from "next/server";
import { listTeamsByGroup } from "@/lib/queries";

export async function GET(req: NextRequest) {
  const group = req.nextUrl.searchParams.get("group");
  if (!group) {
    return NextResponse.json({ error: "group param required" }, { status: 400 });
  }
  const data = await listTeamsByGroup(group);
  return NextResponse.json(data);
}
