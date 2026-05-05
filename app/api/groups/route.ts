import { NextRequest, NextResponse } from "next/server";
import { listAllGroups, listGroupsByCategory } from "@/lib/queries";

export async function GET(req: NextRequest) {
  const category = req.nextUrl.searchParams.get("category");
  const data = category
    ? await listGroupsByCategory(category)
    : await listAllGroups();
  return NextResponse.json(data);
}
