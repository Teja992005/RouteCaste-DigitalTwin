/**
 * POST /api/event/simulate
 *
 * Accepts one event (`event`) or several (`events`, up to MAX_EVENTS) and
 * returns:
 *  - Per-route ETA and congestion predictions with the events running
 *  - A time-series forecast across the combined event window
 *  - The hotspot centroid and peak congestion time
 *
 * Route ETA and congestion come from the trained ONNX models. Their inputs are
 * built by lib/event-model-inputs.ts, which reproduces the training-time
 * feature formulas. Each route is predicted twice with the same models:
 *   - baseline: normal traffic at the evaluated hour (no event features)
 *   - event:    the same hour with the events' proximity, severity and load
 * so the reported delay is the model's own baseline-vs-event difference.
 *
 * The models were trained on one event at a time; with several events the
 * features are combined (see buildMultiEventScenarioInputs), which is an
 * extrapolation and is stated in the response note.
 *
 * If a model cannot be loaded the route falls back to a heuristic, and the
 * response says so: `source` is "model" only when every prediction for every
 * route came from a model. The congestion forecast curve and hotspot are
 * parametric (not model output) and the note says that.
 */

import { NextResponse } from "next/server"
import type { ScheduledEvent, EventSimulationResponse, EventImpactRoute, EventType } from "@/lib/types"
import { explainEtaDelay } from "@/lib/explain"
import {
  APPROXIMATED_INPUTS,
  EVENT_CONGESTION_BOOST,
  MAX_EVENTS,
  buildMultiEventScenarioInputs,
  eventIntensityAtHour,
  eventIntensityAtTime,
  trainedEventLoad,
  trainingDayOfWeek,
} from "@/lib/event-model-inputs"

// ---------------------------------------------------------------------------
// Event demand model
// ---------------------------------------------------------------------------

/**
 * Compute the UI event_load from attendance and city area density. Returns 0..1.
 * This drives the forecast curve, heatmap, isochrone and emergency panels.
 * (The ONNX models use a separate load, trainedEventLoad(), that matches their
 * training data.)
 *
 * Calibration (for research paper):
 *   - 1,000 attendees in a dense urban area  → ~0.2 load
 *   - 10,000 attendees                        → ~0.5 load
 *   - 50,000 attendees (festival)             → ~0.85 load
 */
function computeEventLoad(attendance: number, areaDensity = 0.7): number {
  const base = attendance / 50000
  return Math.min(1, base * (0.4 + areaDensity * 0.6))
}

/**
 * Impact radius in metres based on attendance, capped at 1,500 m (the largest
 * radius in the training data).
 *   100 attendees    → ~260 m
 *   5,000 attendees  → ~610 m
 *   50,000 attendees → ~1,500 m
 */
function computeImpactRadius(attendance: number): number {
  return Math.round(Math.min(1500, 200 + Math.sqrt(Math.max(0, attendance)) * 5.8))
}

// ---------------------------------------------------------------------------
// Request body type
// ---------------------------------------------------------------------------

type EventInput = {
  name: string
  type: string
  lat: number
  lng: number
  locationName: string
  startTime: string
  endTime: string
  attendance: number
}

type SimulateRequest = {
  /** A single event. Ignored when `events` is a non-empty array. */
  event?: EventInput
  /** Several events to combine (at most MAX_EVENTS). */
  events?: EventInput[]
  /** Optional: routes to score (from OSRM). If absent, only forecast is returned. */
  routes?: {
    id: string
    label: string
    distanceMeters: number
    durationSeconds: number
    /** Representative lat/lng points along the route for proximity calculation */
    samplePoints: { lat: number; lng: number }[]
  }[]
  /**
   * Optional decimal hour of day (0..24). When set, route predictions are made
   * for that hour and each event's phase at that hour instead of the event peak.
   */
  hourOverride?: number
}

// ---------------------------------------------------------------------------
// Haversine distance (km) between two points
// ---------------------------------------------------------------------------

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** Closest approach (metres) of a route's sample points to the event pin. */
function minDistanceToEventM(
  eventLat: number,
  eventLng: number,
  samplePoints: { lat: number; lng: number }[],
): number {
  if (samplePoints.length === 0) return Number.POSITIVE_INFINITY
  let best = Number.POSITIVE_INFINITY
  for (const p of samplePoints) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue
    best = Math.min(best, haversineKm(eventLat, eventLng, p.lat, p.lng))
  }
  return best * 1000
}

function isEventType(value: unknown): value is EventType {
  return typeof value === "string" && value in EVENT_CONGESTION_BOOST
}

type PreparedEvent = {
  scheduled: ScheduledEvent
  start: Date
  end: Date
  durationMin: number
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: Request): Promise<NextResponse> {
  let body: SimulateRequest
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const routes = body.routes ?? []
  const inputs: EventInput[] = Array.isArray(body.events) && body.events.length > 0 ? body.events : body.event ? [body.event] : []

  if (inputs.length === 0) {
    return NextResponse.json({ error: "event (or events) is required" }, { status: 400 })
  }
  if (inputs.length > MAX_EVENTS) {
    return NextResponse.json({ error: `At most ${MAX_EVENTS} events can be combined` }, { status: 400 })
  }
  for (const ev of inputs) {
    if (!ev || !Number.isFinite(ev.lat) || !Number.isFinite(ev.lng)) {
      return NextResponse.json({ error: "event.lat and event.lng are required" }, { status: 400 })
    }
    if (!Number.isFinite(ev.attendance) || ev.attendance < 0) {
      return NextResponse.json({ error: "event.attendance must be a non-negative number" }, { status: 400 })
    }
  }

  const now = new Date()
  const stamp = Date.now()
  const prepared: PreparedEvent[] = inputs.map((ev, index) => {
    const start = ev.startTime ? new Date(ev.startTime) : now
    const end = ev.endTime ? new Date(ev.endTime) : new Date(start.getTime() + 3 * 3600_000)
    const eventLoad = computeEventLoad(ev.attendance)
    const impactRadiusMeters = computeImpactRadius(ev.attendance)
    return {
      start,
      end,
      durationMin: Math.max(0, (end.getTime() - start.getTime()) / 60_000),
      scheduled: {
        id: `evt_${stamp}_${index}`,
        name: ev.name || "Unnamed Event",
        type: isEventType(ev.type) ? ev.type : "other",
        lat: ev.lat,
        lng: ev.lng,
        locationName: ev.locationName || `${ev.lat.toFixed(4)}, ${ev.lng.toFixed(4)}`,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        attendance: ev.attendance,
        eventLoad,
        impactRadiusMeters,
      },
    }
  })
  const scheduledEvents = prepared.map((p) => p.scheduled)
  const primary = prepared[0]

  // --------------------------------------------------------------------------
  // Evaluation time
  // --------------------------------------------------------------------------

  // With an hour override: that hour and each event's phase at that hour.
  // Otherwise: the moment of greatest combined load, chosen among the events'
  // own midpoints (for one event, exactly its midpoint).
  const requestedHour =
    typeof body.hourOverride === "number" && Number.isFinite(body.hourOverride) &&
    body.hourOverride >= 0 && body.hourOverride <= 24
      ? Math.min(23.99, body.hourOverride)
      : null

  let evalHour: number
  let evalDow: number
  let phases: number[]

  if (requestedHour !== null) {
    const perEvent = prepared.map((p) => eventIntensityAtHour(requestedHour, p.start, p.end))
    phases = perEvent.map((p) => p.intensity)
    const lead = perEvent.reduce((best, cur) => (cur.intensity > best.intensity ? cur : best), perEvent[0])
    evalHour = requestedHour
    evalDow = trainingDayOfWeek(lead.at)
  } else {
    let bestTime = new Date((primary.start.getTime() + primary.end.getTime()) / 2)
    let bestScore = -1
    for (const candidate of prepared) {
      const t = new Date((candidate.start.getTime() + candidate.end.getTime()) / 2)
      const score = prepared.reduce(
        (sum, p) => sum + trainedEventLoad(p.scheduled.attendance, p.durationMin) * eventIntensityAtTime(t.getTime(), p.start, p.end),
        0,
      )
      if (score > bestScore) {
        bestScore = score
        bestTime = t
      }
    }
    evalHour = bestTime.getHours() + bestTime.getMinutes() / 60
    evalDow = trainingDayOfWeek(bestTime)
    phases = prepared.map((p) => eventIntensityAtTime(bestTime.getTime(), p.start, p.end))
  }

  // --------------------------------------------------------------------------
  // ML inference for each route (baseline vs events, same models)
  // --------------------------------------------------------------------------

  const { predictEta, predictCongestion } = await import("@/lib/ml")
  const strongestLoad = Math.max(...scheduledEvents.map((e) => e.eventLoad))

  // Only `hour` is forwarded to the models; the rest is kept for API compatibility.
  const ctx = {
    hour: evalHour,
    isWeekend: evalDow >= 5,
    areaDensity: 0.75, // Guntur urban density estimate
    scenarioSeverity: Math.min(1, strongestLoad * 1.2),
    rain: 0,
  }

  const scoredRoutes = await Promise.all(
    routes.map(async (r) => {
      const scenario = buildMultiEventScenarioInputs({
        distanceMeters: r.distanceMeters,
        freeFlowSec: r.durationSeconds,
        hour: evalHour,
        dayOfWeek: evalDow,
        events: prepared.map((p, index) => ({
          eventType: p.scheduled.type,
          attendance: p.scheduled.attendance,
          durationMin: p.durationMin,
          minDistanceToEventM: minDistanceToEventM(p.scheduled.lat, p.scheduled.lng, r.samplePoints ?? []),
          impactRadiusM: p.scheduled.impactRadiusMeters,
          eventIntensity: phases[index],
        })),
      })

      const [baseCong, baseEta, eventCong, eventEta] = await Promise.all([
        predictCongestion(scenario.baseline.congestionInput, ctx, scenario.baseline.congestion),
        predictEta(scenario.baseline.eta, ctx, scenario.baseline.heuristicEtaMin),
        predictCongestion(scenario.event.congestionInput, ctx, scenario.event.congestion),
        predictEta(scenario.event.eta, ctx, scenario.event.heuristicEtaMin),
      ])

      // An event cannot make a route faster than normal traffic at the same
      // hour; clamp model noise at zero delay.
      const baseEtaMin = baseEta.etaMin
      const eventEtaMin = Math.max(baseEtaMin, eventEta.etaMin)
      const etaDelta = eventEtaMin - baseEtaMin
      const affected = scenario.proximity >= 0.5 || etaDelta >= Math.max(1, baseEtaMin * 0.1)
      const usedModel = [baseCong, baseEta, eventCong, eventEta].every((p) => p.source === "model")

      // Why is this route slower? Shapley attribution on the same ETA model.
      // Only for model predictions, and only when the event changes the inputs.
      let explanation: EventImpactRoute["explanation"]
      if (usedModel && scenario.eventActive && scenario.affectingEvents.length > 0 && scenario.baseline.eta && scenario.event.eta) {
        const attribution = await explainEtaDelay(scenario.baseline.eta, scenario.event.eta, async (input) => {
          const p = await predictEta(input, ctx, scenario.baseline.heuristicEtaMin)
          return p.etaMin
        })
        explanation = {
          freeFlowMin: Math.round((r.durationSeconds / 60) * 10) / 10,
          normalTrafficMin: Math.round(baseEtaMin * 10) / 10,
          totalDelayMin: Math.round(attribution.totalMin * 10) / 10,
          drivers: attribution.drivers.map((d) => ({ id: d.id, label: d.label, minutes: Math.round(d.minutes * 10) / 10, share: Math.round(d.share * 100) / 100 })),
        }
      }

      return {
        routeId: r.id,
        label: r.label,
        baseEtaMin: Math.round(baseEtaMin * 10) / 10,
        eventEtaMin: Math.round(eventEtaMin * 10) / 10,
        etaDeltaMin: Math.round(etaDelta * 10) / 10,
        congestionBefore: Math.round(baseCong.score * 100) / 100,
        congestionDuring: Math.round(eventCong.score * 100) / 100,
        congestionClass: eventCong.className,
        affected,
        recommended: false, // set after sorting
        reason: "",
        source: usedModel ? ("model" as const) : ("heuristic" as const),
        affectedBy: scenario.affectingEvents.map((i) => scheduledEvents[i].name),
        explanation,
      }
    }),
  )

  // Recommend the route with lowest eventEtaMin
  const eventLabel = scheduledEvents.length === 1 ? `the ${scheduledEvents[0].name} event` : `these ${scheduledEvents.length} events`
  if (scoredRoutes.length > 0) {
    scoredRoutes.sort((a, b) => a.eventEtaMin - b.eventEtaMin)
    scoredRoutes[0].recommended = true
    scoredRoutes[0].reason = `Least affected by ${eventLabel} — ${scoredRoutes[0].etaDeltaMin > 0 ? `+${scoredRoutes[0].etaDeltaMin} min delay` : "minimal delay expected"}`
    for (let i = 1; i < scoredRoutes.length; i++) {
      const extra = scoredRoutes[i].eventEtaMin - scoredRoutes[0].eventEtaMin
      scoredRoutes[i].reason = `${extra.toFixed(0)} min slower than recommended at this time`
    }
  }

  // --------------------------------------------------------------------------
  // Time-series forecast across the combined event window (parametric, not model output)
  // --------------------------------------------------------------------------

  const windowStart = Math.min(...prepared.map((p) => p.start.getTime()))
  const windowEnd = Math.max(...prepared.map((p) => p.end.getTime()))
  const durationMs = windowEnd - windowStart
  const steps = Math.min(12, Math.max(4, Math.round(durationMs / (30 * 60_000)))) // 30-min intervals
  const forecast: EventSimulationResponse["forecast"] = []

  for (let i = 0; i <= steps; i++) {
    const tMs = windowStart + (i / steps) * durationMs
    // Each event adds a bell curve over its own window: rises to a peak at 50%
    // of its duration, then falls.
    let added = 0
    for (const p of prepared) {
      const span = p.end.getTime() - p.start.getTime()
      const pct = span > 0 ? (tMs - p.start.getTime()) / span : 0
      if (pct < 0 || pct > 1) continue
      added += p.scheduled.eventLoad * 0.65 * Math.sin(pct * Math.PI)
    }
    const congestion = Math.min(1, 0.25 + added)
    forecast.push({
      minutesFromStart: Math.round((i / steps) * (durationMs / 60_000)),
      congestion: Math.round(congestion * 100) / 100,
      label: congestion < 0.35 ? "Free" : congestion < 0.6 ? "Moderate" : congestion < 0.8 ? "Heavy" : "Severe",
    })
  }

  const peakForecast = forecast.reduce((a, b) => (b.congestion > a.congestion ? b : a))
  const peakIso = new Date(windowStart + peakForecast.minutesFromStart * 60_000).toISOString()

  // --------------------------------------------------------------------------
  // Hotspot (the venue of the highest-load event is the centroid)
  // --------------------------------------------------------------------------

  const hotspotEvent = scheduledEvents.reduce((a, b) => (b.eventLoad > a.eventLoad ? b : a))
  const peakCongestion = peakForecast.congestion
  const hotspot: EventSimulationResponse["hotspot"] = {
    lat: hotspotEvent.lat,
    lng: hotspotEvent.lng,
    severityLabel: peakCongestion < 0.35 ? "Low" : peakCongestion < 0.6 ? "Moderate" : peakCongestion < 0.8 ? "High" : "Severe",
  }

  // "model" only if every prediction for every route came from an ONNX model.
  const allModel = scoredRoutes.length > 0 && scoredRoutes.every((r) => r.source === "model")
  const anyModel = scoredRoutes.some((r) => r.source === "model")

  const routeSource = allModel
    ? "ONNX models (trained on synthetic data)"
    : anyModel
      ? "ONNX models for some routes, heuristic for others"
      : routes.length === 0
        ? "none (no routes supplied)"
        : "heuristic fallback (ONNX model unavailable)"

  const response: EventSimulationResponse = {
    event: primary.scheduled,
    events: scheduledEvents,
    routes: scoredRoutes,
    forecast,
    hotspot,
    peakAt: peakIso,
    simulatedAt: now.toISOString(),
    source: allModel ? "model" : "heuristic",
    note:
      `Route ETA & congestion: ${routeSource}. Forecast curve: parametric. ` +
      "Simulated estimates, not measurements. " +
      `Approximated model inputs: ${APPROXIMATED_INPUTS.join(", ")} (no road-level data for OSRM routes).` +
      (scheduledEvents.length > 1
        ? ` ${scheduledEvents.length} events combined; the models were trained on single events, so the combination is an extrapolation.`
        : ""),
    evaluation: {
      hour: Math.round(evalHour * 100) / 100,
      eventIntensity: Math.round(Math.max(...phases) * 100) / 100,
      basis: requestedHour === null ? "event-peak" : "time-slider",
    },
  }

  return NextResponse.json(response)
}
