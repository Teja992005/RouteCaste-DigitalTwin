import { NextResponse } from "next/server"
import { decodePolyline } from "@/lib/geo/routing"
import { routeOnGraph } from "@/lib/guntur-graph"

type EmergencyRequest = {
  originLat?: unknown
  originLng?: unknown
  destLat?: unknown
  destLng?: unknown
  eventLat?: unknown
  eventLng?: unknown
  eventLoad?: unknown
  impactRadiusMeters?: unknown
  hourOverride?: unknown
}

type Severity = "minimal" | "moderate" | "severe" | "critical"

function validCoordinate(lat: unknown, lng: unknown) {
  return typeof lat === "number" && Number.isFinite(lat) && Math.abs(lat) <= 90 &&
    typeof lng === "number" && Number.isFinite(lng) && Math.abs(lng) <= 180
}

function trafficMultiplier(hour: number) {
  if (hour < 6) return 1.0
  if (hour < 10) return 1.35
  if (hour < 12) return 1.1
  if (hour < 14) return 1.15
  if (hour < 17) return 1.05
  if (hour < 20) return 1.4
  return 1.1
}

function haversineKm(a: [number, number], b: [number, number]) {
  const dLat = ((b[0] - a[0]) * Math.PI) / 180
  const dLng = ((b[1] - a[1]) * Math.PI) / 180
  const lat1 = (a[0] * Math.PI) / 180
  const lat2 = (b[0] * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

function degradation(degradationPct: number): { severity: Severity; recommendation: string } {
  if (degradationPct < 10) return { severity: "minimal", recommendation: "Route is viable. No pre-positioning required." }
  if (degradationPct < 25) return { severity: "moderate", recommendation: "Consider pre-positioning one unit near the event zone before it begins." }
  if (degradationPct < 50) return { severity: "severe", recommendation: "Pre-position emergency units within 500m of the event. Alert traffic control." }
  return { severity: "critical", recommendation: "CRITICAL: Designate an emergency-only corridor on this route. Pre-position units inside the impact zone." }
}

function failure(error: string, status: number) {
  return NextResponse.json({ error, latLngs: [] }, { status })
}

export async function POST(request: Request) {
  try {
    return await handlePost(request)
  } catch (err) {
    console.error("[emergency/route] unhandled error:", err)
    return failure("Internal server error", 500)
  }
}

async function handlePost(request: Request) {
  let body: EmergencyRequest
  try {
    body = await request.json()
  } catch {
    return failure("Invalid JSON body", 400)
  }

  const { originLat, originLng, destLat, destLng } = body
  if (!validCoordinate(originLat, originLng) || !validCoordinate(destLat, destLng)) {
    return failure("Valid origin and destination coordinates are required", 400)
  }

  const hasEvent = body.eventLat !== undefined || body.eventLng !== undefined || body.eventLoad !== undefined
  if (hasEvent && (
    !validCoordinate(body.eventLat, body.eventLng) ||
    typeof body.eventLoad !== "number" || !Number.isFinite(body.eventLoad) || body.eventLoad < 0 || body.eventLoad > 1
  )) {
    return failure("Valid event coordinates and eventLoad are required together", 400)
  }

  const now = new Date()
  const requestedHour = body.hourOverride
  const hour = typeof requestedHour === "number" && Number.isFinite(requestedHour) && requestedHour >= 0 && requestedHour <= 24
    ? Math.min(23 + 59 / 60, requestedHour)
    : now.getHours() + now.getMinutes() / 60
  const multiplier = trafficMultiplier(hour)
  type Found = { distance: number; duration: number; latLngs: [number, number][]; summary: string; degraded: boolean }

  async function viaOsrm(): Promise<Found | null> {
    const baseUrl = (process.env.ROUTING_URL || "https://router.project-osrm.org").replace(/\/$/, "")
    const coords = `${originLng},${originLat};${destLng},${destLat}`
    const url = `${baseUrl}/route/v1/driving/${coords}?overview=full&geometries=polyline&steps=false&alternatives=false`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8_000)
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } })
      if (!response.ok) return null
      const data = (await response.json()) as { code?: string; routes?: { distance?: number; duration?: number; geometry?: string; legs?: { summary?: string }[] }[] }
      const route = data.code === "Ok" ? data.routes?.[0] : undefined
      if (!route || !Number.isFinite(route.duration) || !Number.isFinite(route.distance) || !route.geometry) return null
      const latLngs = decodePolyline(route.geometry)
      if (latLngs.length < 2) return null
      return {
        distance: route.distance!,
        duration: route.duration!,
        latLngs,
        summary: route.legs?.map((leg) => leg.summary).filter(Boolean).join(", ") || "Fastest OSRM driving route",
        degraded: false,
      }
    } catch {
      return null
    } finally {
      clearTimeout(timeout)
    }
  }

  // Routing engine first; if it is down, the local Guntur road graph (free-flow, labelled degraded).
  let found = await viaOsrm()
  if (!found) {
    const local = routeOnGraph({ lat: originLat as number, lon: originLng as number }, { lat: destLat as number, lon: destLng as number })
    if (local && local.latLngs.length >= 2) {
      found = {
        distance: local.distanceM,
        duration: local.durationSec,
        latLngs: local.latLngs,
        summary: Array.from(new Set(local.steps.map((step) => step.name).filter(Boolean))).slice(0, 3).join(", ") || "Local Guntur road graph",
        degraded: true,
      }
    }
  }
  if (!found) return failure("Routing service unavailable", 500)

  const baseEtaMin = found.duration / 60
  const normalEtaMin = baseEtaMin * multiplier
  let eventFactor = 1
  if (hasEvent) {
    const midpoint = found.latLngs[Math.floor(found.latLngs.length / 2)]
    const eventDistanceKm = haversineKm(midpoint, [body.eventLat as number, body.eventLng as number])
    const proximity = Math.exp(-eventDistanceKm / 1.0)
    eventFactor = Math.min(2.0, 1 + ((body.eventLoad as number) * proximity * 1.2))
  }

  const eventEtaMin = normalEtaMin * eventFactor
  // Event impact is measured against normal traffic at the same hour. Measuring
  // against free-flow would count ordinary rush-hour traffic as event delay.
  const delayMin = eventEtaMin - normalEtaMin
  const degradationPct = normalEtaMin > 0 ? Math.round((delayMin / normalEtaMin) * 100) : 0
  const verdict = degradation(degradationPct)

  return NextResponse.json({
    latLngs: found.latLngs,
    distanceMeters: found.distance,
    baseEtaMin,
    normalEtaMin,
    eventEtaMin,
    delayMin,
    degradationPct,
    ...verdict,
    routeSummary: found.summary,
    degraded: found.degraded,
  })
}
