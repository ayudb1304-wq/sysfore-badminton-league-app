import { NextRequest, NextResponse } from "next/server";
import { listMatches } from "@/lib/queries";

export async function GET(req: NextRequest) {
  const slot = req.nextUrl.searchParams.get("slot");
  const slotNumber = slot ? parseInt(slot, 10) : undefined;
  if (slot && Number.isNaN(slotNumber)) {
    return NextResponse.json({ error: "slot must be an integer" }, { status: 400 });
  }
  const data = await listMatches({ slotNumber });
  return NextResponse.json(data);
}
