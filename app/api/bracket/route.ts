import { NextRequest, NextResponse } from "next/server";
import { getBracket } from "@/lib/queries";
import type { CategoryId } from "@/lib/brackets";

const VALID = new Set(["MB", "MI", "W"]);

export async function GET(req: NextRequest) {
  const category = req.nextUrl.searchParams.get("category");
  if (!category || !VALID.has(category)) {
    return NextResponse.json(
      { error: "category param required (MB | MI | W)" },
      { status: 400 },
    );
  }
  const data = await getBracket(category as CategoryId);
  return NextResponse.json(data);
}
