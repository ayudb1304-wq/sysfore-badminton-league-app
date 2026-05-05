import { NextRequest, NextResponse } from "next/server";
import { listMatches } from "@/lib/queries";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const data = await listMatches({
    status: sp.get("status") ?? undefined,
    courtId: sp.get("court") ?? undefined,
    categoryId: sp.get("category") ?? undefined,
    groupId: sp.get("group") ?? undefined,
  });
  return NextResponse.json(data);
}
