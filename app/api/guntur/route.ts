import { NextResponse } from "next/server"
import { gunturInfo, routeGuntur } from "@/lib/guntur"

export const runtime = "nodejs"

/**
 * GET /api/guntur                       -> dataset status, events, zones
 * GET /api/guntur?route=1&eventId=..&timestamp=ISO&fromLat=..&fromLon=..&toLat=..&toLon=..
 *   -> normal (free-flow) route vs best route under that event's load
 */
export async function GET(request: Request) {
  const p = new URL(request.url).searchParams
  try {
    if (!p.get("route")) return NextResponse.json(gunturInfo())
    const num = (key: string) => {
      const value = Number(p.get(key))
      if (!p.get(key) || !Number.isFinite(value)) throw new Error(`${key} is required`)
      return value
    }
    return NextResponse.json(
      routeGuntur({
        eventId: p.get("eventId") ?? "gtr_evt_004",
        timestamp: p.get("timestamp") ?? "2026-09-11T17:30:00",
        from: { lat: num("fromLat"), lon: num("fromLon") },
        to: { lat: num("toLat"), lon: num("toLon") },
      }),
    )
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Guntur route failed" }, { status: 400 })
  }
}
