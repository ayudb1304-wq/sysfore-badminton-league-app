import { NextResponse } from "next/server";
import { listCategories } from "@/lib/queries";

export async function GET() {
  const data = await listCategories();
  return NextResponse.json(data);
}
