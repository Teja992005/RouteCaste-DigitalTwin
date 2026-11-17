import fs from "node:fs"
import path from "node:path"
import { compareRoutesUnderEvent, loadGunturGraph, parseCsv } from "@/lib/guntur-graph"
import { eventIntensityAtTime } from "@/lib/event-model-inputs"

/**
 * Thin service layer over the Guntur graph engine for /api/guntur.
 * Event traffic is computed on demand (see lib/guntur-graph.ts); no pre-built
 * per-timestamp shards are required.
 */
const root = () => path.join(process.cwd(), "data", "processed")

function readCsv(name: string) {
  try {
    return parseCsv(fs.readFileSync(path.join(root(), name), "utf8"))
  } catch {
    return []
  }
}

const DISCLAIMER = "Modeled baseline/event traffic and BPR travel times — not measured road-sensor data. Road geometry is OpenStreetMap-sourced."

export function gunturInfo() {
  return { available: loadGunturGraph() !== null, events: readCsv("events.csv"), zones: readCsv("zones.csv"), disclaimer: DISCLAIMER }
}

export type GunturRouteQuery = {
  eventId: string
  timestamp: string
  from: { lat: number; lon: number }
  to: { lat: number; lon: number }
}

/** Normal route vs best route under the event at `timestamp`, timed with the same BPR model. */
export function routeGuntur(q: GunturRouteQuery) {
  const events = readCsv("events.csv")
  const event = events.find((e) => e.event_id === q.eventId) ?? events[0]
  if (!event) throw new Error("No Guntur event dataset is available")
  const at = new Date(q.timestamp)
  if (Number.isNaN(at.getTime())) throw new Error("timestamp must be an ISO date-time")
  const start = new Date(event.start_timestamp)
  const end = new Date(event.end_timestamp)
  const phase = eventIntensityAtTime(at.getTime(), start, end)
  const result = compareRoutesUnderEvent({
    from: q.from,
    to: q.to,
    venue: { lat: Number(event.latitude), lng: Number(event.longitude), attendance: Number(event.expected_attendance) },
    phase,
    hour: at.getHours() + at.getMinutes() / 60,
    weekend: at.getDay() === 0 || at.getDay() === 6,
  })
  if (!result) throw new Error("Both points must be within 1.5 km of the Guntur road graph and connected by road")
  return { event, timestamp: q.timestamp, eventPhase: phase, ...result, disclaimer: DISCLAIMER }
}
