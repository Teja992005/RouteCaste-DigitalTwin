import { NextResponse } from "next/server"
import { buildOrganizerPlan } from "@/lib/guntur-plan"
import { loadGunturGraph } from "@/lib/guntur-graph"

export const runtime = "nodejs"

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v)
}

/**
 * POST /api/event/plan
 * { lat, lng, attendance, startTime }  ->  organizer plan on the Guntur road graph:
 * staggered-arrival options, diversions, marshalling points, before/after.
 */
export async function POST(request: Request) {
  let body: { lat?: unknown; lng?: unknown; attendance?: unknown; startTime?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 })
  }
  const { lat, lng, attendance, startTime } = body
  if (!finite(lat) || Math.abs(lat) > 90 || !finite(lng) || Math.abs(lng) > 180) {
    return NextResponse.json({ error: "lat and lng are required" }, { status: 400 })
  }
  if (!finite(attendance) || attendance <= 0 || attendance > 1_000_000) {
    return NextResponse.json({ error: "attendance must be a positive number" }, { status: 400 })
  }
  if (typeof startTime !== "string" || Number.isNaN(new Date(startTime).getTime())) {
    return NextResponse.json({ error: "startTime must be an ISO date-time" }, { status: 400 })
  }
  if (!loadGunturGraph()) {
    return NextResponse.json({ error: "Guntur road dataset is not available on this server" }, { status: 503 })
  }
  const plan = buildOrganizerPlan({ venue: { lat, lng, attendance }, startTime })
  if (!plan) {
    return NextResponse.json({ error: "This venue is outside the Guntur road graph (must be within 1.5 km of it)" }, { status: 422 })
  }
  return NextResponse.json({
    source: "guntur-graph",
    note: "Modeled on OpenStreetMap roads with documented traffic assumptions, not measured traffic.",
    plan,
  })
}
