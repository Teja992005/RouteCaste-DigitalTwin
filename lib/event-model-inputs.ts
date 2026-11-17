/**
 * Training-compatible model inputs for event traffic simulation.
 *
 * The ONNX models were trained on data produced by
 * `scripts/generate_synthetic_dataset.py` and featurised by `ml/data.py`.
 * This module reproduces those exact formulas so the models receive inputs in
 * the same shape and scale they were trained on. Notable details:
 *
 *   - The "current_congestion" feature is NOT the congestion level `c`; it is
 *     `1 - speed_ratio` where `speed_ratio = 1 - 0.85·c²` (BPR-style), i.e.
 *     `0.85·c²`.
 *   - `current_travel_time` is the CONGESTED travel time (length / speed), not
 *     the free-flow time.
 *   - `scenario_severity` equals the continuous distance weight
 *     `1 - d / impactRadius`, and `event_proximity` is
 *     `max(distance tier, distance weight)`.
 *   - `event_load` is a weighted blend of attendance, size, duration, arrival
 *     and departure rates (NOT attendance / 50,000).
 *
 * What is still approximated (and is reported as such by the caller):
 *   - Road-level speed is unavailable for an OSRM route, so current congestion
 *     is derived from the same hour-of-day / day-of-week profile that generated
 *     the training data.
 *   - Road capacity is unavailable for a route, so the training-set mean is used.
 */

import type { CongestionModelInput, EtaModelInput } from "@/lib/ml-contracts"
import type { EventType } from "@/lib/types"

// ---------------------------------------------------------------------------
// Tables copied from scripts/generate_synthetic_dataset.py
// ---------------------------------------------------------------------------

/** Base congestion by hour 0-23 (Guntur rush-hour profile used for training). */
export const HOURLY_BASE_CONGESTION = [
  0.08, 0.06, 0.05, 0.05, 0.07, 0.14, 0.28, 0.52, 0.78, 0.82, 0.65, 0.48,
  0.44, 0.50, 0.42, 0.46, 0.60, 0.80, 0.85, 0.72, 0.52, 0.36, 0.22, 0.12,
] as const

/** Day-of-week multiplier, index 0 = Monday ... 6 = Sunday. */
export const DOW_MULTIPLIER = [1.0, 1.0, 1.0, 1.05, 1.18, 0.85, 0.72] as const

/** Peak congestion boost per event type (EVENT_TYPES[...]["congestion_boost"]). */
export const EVENT_CONGESTION_BOOST: Record<EventType, number> = {
  festival: 0.45,
  sports: 0.35,
  concert: 0.30,
  protest: 0.50,
  construction: 0.40,
  vip_visit: 0.60,
  public_gathering: 0.28,
  other: 0.20,
}

/**
 * Typical attendance per event type: the midpoint of that type's range in the
 * synthetic training generator. Types whose attendance is not what drives them
 * (construction, VIP visit) are absent and are not scaled.
 */
export const TYPICAL_ATTENDANCE: Partial<Record<EventType, number>> = {
  festival: 42500,
  sports: 16000,
  concert: 10500,
  protest: 2600,
  public_gathering: 5250,
  other: 2550,
}

/**
 * Scale (0.25..1) applied to an event's congestion boost by its size.
 *
 * The synthetic generator sets the boost by event TYPE only, so a 500-person
 * gathering would get nearly the full effect of a 10,000-person one. Here the
 * boost is scaled by attendance relative to the type's typical size, so small
 * events disturb traffic less. Retraining on attendance-scaled data would be the
 * proper fix; this is an inference-time correction and is stated in the docs.
 */
export function attendanceBoostScale(eventType: EventType, attendance: number): number {
  const typical = TYPICAL_ATTENDANCE[eventType]
  if (!typical) return 1
  return clamp(0.25 + (0.75 * Math.max(0, attendance)) / typical, 0.25, 1)
}

/**
 * Mean of capacity / (7200 × lanes) over the training road mix
 * (30% arterial, 30% collector, 20% local, 10% highway, 10% residential).
 * Used only because an OSRM route carries no road capacity.
 */
export const TYPICAL_ROAD_CAPACITY_PROXY = 0.2

/** Training horizons were 5, 10, 15, 20 or 30 minutes; 15 is the midpoint. */
export const DEFAULT_HORIZON_MINUTES = 15

/** Names of inputs that are approximated rather than measured. */
export const APPROXIMATED_INPUTS = ["currentCongestion", "roadCapacity"] as const

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** JS getDay() is 0 = Sunday; the training tables use 0 = Monday. */
export function trainingDayOfWeek(date: Date): number {
  return (date.getDay() + 6) % 7
}

/** Mirrors hour_congestion_base() in the dataset generator (linear in the hour). */
export function baselineCongestion(hour: number, dayOfWeek: number): number {
  const h = ((hour % 24) + 24) % 24
  const h0 = Math.floor(h)
  const h1 = (h0 + 1) % 24
  const frac = h - h0
  const base = HOURLY_BASE_CONGESTION[h0] * (1 - frac) + HOURLY_BASE_CONGESTION[h1] * frac
  const dow = DOW_MULTIPLIER[((dayOfWeek % 7) + 7) % 7]
  return clamp(base * dow, 0, 1)
}

/** speed_ratio = clamp(1 - 0.85·c², 0.05, 1) as in the generator. */
export function speedRatio(congestion: number): number {
  return clamp(1 - 0.85 * congestion ** 2, 0.05, 1)
}

/** The value of the `current_congestion` feature: 1 - speed_ratio. */
export function congestionFeature(congestion: number): number {
  return 1 - speedRatio(congestion)
}

/** Mirrors calculate_event_load() in ml/data.py for an event row. */
export function trainedEventLoad(attendance: number, durationMin: number): number {
  const att = Math.max(0, attendance)
  const dur = Math.max(0, durationMin)
  const eventSize = clamp(att / 10000, 0, 5)
  const arrivalRate = att / Math.max(dur * 0.3, 1)
  const departureRate = att / Math.max(dur * 0.2, 1)
  const load =
    0.35 * clamp(att / 5000, 0, 1) +
    0.2 * clamp(eventSize / 5, 0, 1) +
    0.15 * clamp(dur / 180, 0, 1) +
    0.15 * clamp(arrivalRate / 1000, 0, 1) +
    0.15 * clamp(departureRate / 1000, 0, 1)
  return clamp(load, 0, 1)
}

/**
 * Mirrors calculate_event_proximity() / calculate_scenario_severity().
 * `distanceM` is the closest approach of the route to the event venue.
 */
export function eventProximityFeatures(
  distanceM: number,
  impactRadiusM: number,
): { proximity: number; distanceWeight: number } {
  if (!Number.isFinite(distanceM) || distanceM < 0) return { proximity: 0, distanceWeight: 0 }
  const distanceWeight =
    impactRadiusM > 0 && distanceM <= impactRadiusM ? clamp(1 - distanceM / impactRadiusM, 0, 1) : 0
  const tier = distanceM <= 250 ? 1 : distanceM <= 500 ? 0.75 : distanceM <= 1000 ? 0.5 : 0
  return { proximity: clamp(Math.max(tier, distanceWeight), 0, 1), distanceWeight }
}

/**
 * Event phase at a time of day: 0 outside the event window, rising to 1 at the
 * event midpoint (the same peak the forecast curve uses), following the
 * generator's Gaussian bell with sigma = 30% of the event duration.
 *
 * `hour` is a decimal hour of day. Events that cross midnight are handled by
 * also trying the hour on the neighbouring days. `at` is the matching
 * timestamp (used for the day of week); outside the window it falls back to
 * that hour on the start day.
 */
export function eventIntensityAtHour(hour: number, start: Date, end: Date): { intensity: number; at: Date } {
  const dayStart = new Date(start)
  dayStart.setHours(0, 0, 0, 0)
  const fallback = new Date(dayStart.getTime() + (Number.isFinite(hour) ? hour : 0) * 3600_000)
  if (!Number.isFinite(hour)) return { intensity: 0, at: fallback }

  let best = { intensity: 0, at: fallback }
  for (const dayOffset of [-1, 0, 1]) {
    const tMs = dayStart.getTime() + (dayOffset * 24 + hour) * 3600_000
    const intensity = eventIntensityAtTime(tMs, start, end)
    if (intensity > best.intensity) best = { intensity, at: new Date(tMs) }
  }
  return best
}

/**
 * Event phase at an absolute time (ms): 0 outside the event window, 1 at its
 * midpoint, Gaussian with sigma = 30% of the duration in between.
 */
export function eventIntensityAtTime(tMs: number, start: Date, end: Date): number {
  const startMs = start.getTime()
  const durationMs = end.getTime() - startMs
  if (!(durationMs > 0) || !Number.isFinite(tMs) || tMs < startMs || tMs > startMs + durationMs) return 0
  const z = (tMs - (startMs + durationMs / 2)) / Math.max(durationMs * 0.3, 1)
  return Math.exp(-0.5 * z * z)
}

/** Most events the app will combine in one simulation. */
export const MAX_EVENTS = 3

/** Below this phase the event is treated as not running (baseline inputs). */
export const MIN_EVENT_INTENSITY = 0.05

// ---------------------------------------------------------------------------
// Scenario builder
// ---------------------------------------------------------------------------

export type ScenarioModelInputs = {
  /** Underlying congestion level c (0..1) before the BPR-style feature transform. */
  congestion: number
  /** Congested travel time in seconds, the model's `current_travel_time`. */
  currentTravelTimeSec: number
  /** Same quantity in minutes; the heuristic ETA when no model is available. */
  heuristicEtaMin: number
  eta: EtaModelInput
  congestionInput: CongestionModelInput
}

export type EventScenarioInputs = {
  /** Normal traffic at the same hour, no event features. */
  baseline: ScenarioModelInputs
  /** The event at its peak, with the route's proximity and the event's load. */
  event: ScenarioModelInputs
  proximity: number
  distanceWeight: number
  /** Training-formula event load (not the UI `eventLoad`). */
  modelEventLoad: number
  /** Event phase used for this scenario, 0..1. */
  eventIntensity: number
  /** False when no event is running at the evaluated time. */
  eventActive: boolean
  /** Indexes (into the events passed in) that load this route right now. */
  affectingEvents: number[]
}

export type EventScenarioArgs = {
  distanceMeters: number
  /** Engine (OSRM) travel time, treated as free-flow. */
  freeFlowSec: number
  /** Decimal hour of the observation (the event peak). */
  hour: number
  /** 0 = Monday ... 6 = Sunday. */
  dayOfWeek: number
  eventType: EventType
  attendance: number
  durationMin: number
  /** Closest approach of the route to the venue; Infinity when unknown. */
  minDistanceToEventM: number
  impactRadiusM: number
  horizonMinutes?: number
  /**
   * Event phase at the evaluated time, 0..1 (see eventIntensityAtHour).
   * Defaults to 1, the event peak.
   */
  eventIntensity?: number
}

function scenarioInputs(
  args: Pick<EventScenarioArgs, "distanceMeters" | "freeFlowSec" | "horizonMinutes">,
  congestion: number,
  proximity: number,
  severity: number,
  eventLoad: number,
): ScenarioModelInputs {
  const horizon = args.horizonMinutes ?? DEFAULT_HORIZON_MINUTES
  const proxy = congestionFeature(congestion)
  const currentTravelTimeSec = clamp(args.freeFlowSec / speedRatio(congestion), 10, 3600)
  return {
    congestion,
    currentTravelTimeSec,
    heuristicEtaMin: currentTravelTimeSec / 60,
    eta: {
      distanceKm: args.distanceMeters / 1000,
      currentTravelTimeSec,
      congestionProxy: proxy,
      eventProximity: proximity,
      scenarioSeverity: severity,
      eventLoad,
    },
    congestionInput: {
      congestionProxy: proxy,
      horizonMinutes: horizon,
      roadCapacityProxy: TYPICAL_ROAD_CAPACITY_PROXY,
      // In training, incident_load is the same value as event_load.
      incidentLoad: eventLoad,
      scenarioSeverity: severity,
      eventProximity: proximity,
    },
  }
}

/** One event's contribution to a route's scenario. */
export type EventContribution = {
  eventType: EventType
  attendance: number
  durationMin: number
  /** Closest approach of the route to this venue; Infinity when unknown. */
  minDistanceToEventM: number
  impactRadiusM: number
  /** Event phase at the evaluated time, 0..1. Defaults to 1. */
  eventIntensity?: number
}

export type MultiEventScenarioArgs = Omit<
  EventScenarioArgs,
  "eventType" | "attendance" | "durationMin" | "minDistanceToEventM" | "impactRadiusM" | "eventIntensity"
> & { events: EventContribution[] }

/**
 * Builds baseline and event model inputs for a route given one or more events.
 *
 * Congestion is the normal hour-of-day level plus each event's type boost,
 * scaled by that event's distance weight and phase (the generator's
 * `base + boost × intensity × distance_weight`, summed over events). Events
 * that are not running (phase below MIN_EVENT_INTENSITY) contribute nothing; if
 * none is running the event scenario equals the baseline.
 *
 * The models were trained on one event at a time, so for several events the
 * per-event features are combined: proximity and severity take the strongest
 * event, and load is 1 - Π(1 - load_i) over the events that reach the route. A route no event reaches is unaffected. With a single event this reduces
 * exactly to the training formulas. Several overlapping events are therefore an
 * extrapolation beyond the training distribution.
 */
export function buildMultiEventScenarioInputs(args: MultiEventScenarioArgs): EventScenarioInputs {
  const c0 = clamp(baselineCongestion(args.hour, args.dayOfWeek), 0.02, 0.98)
  const baseline = scenarioInputs(args, c0, 0, 0, 0)

  let boostSum = 0
  let proximity = 0
  let distanceWeight = 0
  let reachingRemainder = 1
    let maxIntensity = 0
  const affectingEvents: number[] = []

  args.events.forEach((ev, index) => {
    const intensity = clamp(ev.eventIntensity ?? 1, 0, 1)
    if (intensity < MIN_EVENT_INTENSITY) return
    const p = eventProximityFeatures(ev.minDistanceToEventM, ev.impactRadiusM)
    boostSum += EVENT_CONGESTION_BOOST[ev.eventType] * attendanceBoostScale(ev.eventType, ev.attendance) * p.distanceWeight * intensity
    proximity = Math.max(proximity, p.proximity)
    distanceWeight = Math.max(distanceWeight, p.distanceWeight)
    const load = trainedEventLoad(ev.attendance, ev.durationMin)
    maxIntensity = Math.max(maxIntensity, intensity)
    if (p.proximity > 0 || p.distanceWeight > 0) {
      affectingEvents.push(index)
      reachingRemainder *= 1 - load
    }
  })

  const eventActive = maxIntensity >= MIN_EVENT_INTENSITY
  if (!eventActive) {
    return { baseline, event: baseline, proximity: 0, distanceWeight: 0, modelEventLoad: 0, eventIntensity: maxIntensity, eventActive, affectingEvents: [] }
  }

  // An event that does not reach the route cannot slow it. Without this gate
  // the ETA model, which saw event load only alongside nearby roads, adds a
  // large spurious delay to distant routes when the hour is already congested.
  if (affectingEvents.length === 0) {
    return { baseline, event: baseline, proximity: 0, distanceWeight: 0, modelEventLoad: 0, eventIntensity: maxIntensity, eventActive, affectingEvents }
  }

  // Only events that reach the route add to its load.
  const modelEventLoad = 1 - reachingRemainder
  const c1 = clamp(c0 + boostSum, 0.02, 0.98)
  return {
    baseline,
    event: scenarioInputs(args, c1, proximity, distanceWeight, modelEventLoad),
    proximity,
    distanceWeight,
    modelEventLoad,
    eventIntensity: maxIntensity,
    eventActive,
    affectingEvents,
  }
}

/** Single-event convenience wrapper around buildMultiEventScenarioInputs. */
export function buildEventScenarioInputs(args: EventScenarioArgs): EventScenarioInputs {
  const { eventType, attendance, durationMin, minDistanceToEventM, impactRadiusM, eventIntensity, ...route } = args
  return buildMultiEventScenarioInputs({
    ...route,
    events: [{ eventType, attendance, durationMin, minDistanceToEventM, impactRadiusM, eventIntensity }],
  })
}
