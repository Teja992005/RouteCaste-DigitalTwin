import {
  MAX_VENUE_SNAP_M,
  PEAK_HOUR_SHARE,
  VEHICLES_PER_ATTENDEE,
  baselineVolumeVph,
  bprTime,
  eventDemandVph,
  haversineM,
  loadGunturGraph,
  nearestNode,
  parseWkt,
  shortestPathBy,
  shortestRoadPath,
  type GunturGraph,
} from "@/lib/guntur-graph"

/**
 * Organizer plan for one event on the Guntur road graph.
 *
 * Three levers, all evaluated with the same BPR model so "before" and "after"
 * are like for like:
 *   1. Staggered arrivals: split attendees into k waves, one per hour, so the
 *      busiest hour carries 1/k of the vehicles (unmanaged: 2/3, as in the dataset).
 *   2. Diversions: for each city zone, the route that is fastest under the
 *      event's load, where it beats the normal route.
 *   3. Marshalling points: a node on each approach corridor about 1.2 km before
 *      the venue, to stage marshals, signage or shuttles.
 *
 * Everything is MODELED from documented assumptions, not measured traffic.
 */

export const PLAN_RADIUS_M = 2500
export const WAVE_OPTIONS = [1, 2, 3, 4] as const
export const MARSHAL_DISTANCE_M = 1200
/** A diversion must beat the normal route by at least this much to be suggested. */
export const MIN_DIVERSION_SAVING_SEC = 30
/** Staggering is only recommended if it saves at least this many vehicle-hours per hour (or clears an over-capacity road). */
export const MIN_MATERIAL_SAVING_VEH_H = 1

export type PlanInput = {
  venue: { lat: number; lng: number; attendance: number }
  /** Event start (ISO). Arrivals peak about an hour before it. */
  startTime: string
}

export type PlanMetrics = {
  /** Directed roads within the plan radius loaded above capacity (volume/capacity > 1). */
  overCapacityRoads: number
  /** Extra vehicle-hours lost per hour on roads in the radius because of the event. */
  delayVehicleHours: number
  /** Largest single-road event delay, in seconds. */
  worstRoadDelaySec: number
}

export type WaveOption = PlanMetrics & {
  waves: number
  /** Share of all event vehicles arriving in the busiest hour. */
  peakHourShare: number
  peakHourVehicles: number
}

export type Diversion = {
  zoneId: string
  zoneName: string
  normalRoads: string[]
  divertedRoads: string[]
  savedSec: number
  normalMin: number
  divertedMin: number
  latLngs: [number, number][]
}

export type MarshalPoint = {
  zoneId: string
  zoneName: string
  lat: number
  lng: number
  roadName: string
  /** Event vehicles per hour that pass this point in the busiest (unmanaged) hour. */
  vehiclesPerHour: number
}

export type OrganizerPlan = {
  evaluatedHour: number
  weekend: boolean
  radiusM: number
  options: WaveOption[]
  recommendedWaves: number
  waveReason: string
  diversions: Diversion[]
  marshalPoints: MarshalPoint[]
  /** Unmanaged vs the full plan (recommended waves + diversions), same model. */
  before: PlanMetrics
  /** Recommended waves without diversions. */
  wavesOnly: PlanMetrics
  after: PlanMetrics
  assumptions: string[]
}

function metricsFor(graph: GunturGraph, venue: { lat: number; lng: number }, demand: Float64Array, hour: number, weekend: boolean): PlanMetrics {
  let over = 0
  let delayVehSec = 0
  let worst = 0
  for (let i = 0; i < graph.roads.length; i++) {
    const road = graph.roads[i]
    if (haversineM(venue.lat, venue.lng, road.midLat, road.midLng) > PLAN_RADIUS_M) continue
    const base = baselineVolumeVph(road, hour, weekend)
    const total = base + demand[i]
    if (total / road.capacityVph > 1) over++
    const delay = bprTime(road.freeFlowSec, total, road.capacityVph) - bprTime(road.freeFlowSec, base, road.capacityVph)
    if (delay > worst) worst = delay
    delayVehSec += delay * total // seconds lost per vehicle x vehicles per hour
  }
  return { overCapacityRoads: over, delayVehicleHours: delayVehSec / 3600, worstRoadDelaySec: worst }
}

/** Smallest wave count that captures at least 80% of the achievable delay reduction. */
export function pickWaves(options: WaveOption[]): { waves: number; reason: string } {
  const first = options[0]
  const best = options.reduce((a, b) => (b.delayVehicleHours < a.delayVehicleHours ? b : a), first)
  const achievable = first.delayVehicleHours - best.delayVehicleHours
  const clearedRoads = first.overCapacityRoads - Math.min(...options.map((o) => o.overCapacityRoads))
  // Not worth recommending unless it saves a meaningful amount of vehicle-time or clears an overloaded road.
  if (achievable < MIN_MATERIAL_SAVING_VEH_H && clearedRoads < 1) {
    return { waves: 1, reason: "Arrivals barely disturb the roads around the venue, so staggering adds little." }
  }
  const pick = options.find((o) => first.delayVehicleHours - o.delayVehicleHours >= 0.8 * achievable) ?? best
  const cut = Math.round((1 - pick.delayVehicleHours / first.delayVehicleHours) * 100)
  return {
    waves: pick.waves,
    reason:
      pick.waves === 1
        ? "Arrivals do not overload the roads around the venue, so staggering adds little."
        : `${pick.waves} waves is the smallest split that captures at least 80% of the best achievable delay reduction (${cut}% less lost vehicle-time).`,
  }
}

export function buildOrganizerPlan(input: PlanInput, graph: GunturGraph | null = loadGunturGraph()): OrganizerPlan | null {
  if (!graph || graph.zones.length === 0) return null
  const venue = nearestNode(graph, input.venue.lat, input.venue.lng)
  if (!venue || venue.distM > MAX_VENUE_SNAP_M) return null

  const start = new Date(input.startTime)
  if (Number.isNaN(start.getTime())) return null
  const hour = (start.getHours() + start.getMinutes() / 60 + 23) % 24 // busiest arrival hour: one hour before the start
  const weekend = start.getDay() === 0 || start.getDay() === 6
  const attendance = Math.max(0, input.venue.attendance)

  // Normal (free-flow) approach path for each zone.
  const normalPaths = new Map<string, number[]>()
  for (const zone of graph.zones) normalPaths.set(zone.id, shortestRoadPath(graph, zone.nearestNodeId, venue.id))

  const demandFor = (share: number, paths?: Map<string, number[]>) => eventDemandVph(graph, venue.id, attendance, share, paths ?? normalPaths)
  const evaluate = (demand: Float64Array) => metricsFor(graph, input.venue, demand, hour, weekend)

  // 1. Waves.
  const options: WaveOption[] = WAVE_OPTIONS.map((waves) => {
    const peakHourShare = waves === 1 ? PEAK_HOUR_SHARE : 1 / waves
    return {
      waves,
      peakHourShare,
      peakHourVehicles: Math.round(attendance * VEHICLES_PER_ATTENDEE * peakHourShare),
      ...evaluate(demandFor(peakHourShare)),
    }
  })
  const { waves: recommendedWaves, reason: waveReason } = pickWaves(options)
  const chosen = options.find((o) => o.waves === recommendedWaves)!

  // 2. Diversions, timed under the PLANNED (staggered) load and kept only when
  //    they measurably cut total delay. Timing them against the unmanaged load
  //    and then applying them with waves can herd traffic onto the alternative.
  const unmanaged = demandFor(PEAK_HOUR_SHARE)
  const wavesOnlyDemand = demandFor(chosen.peakHourShare)
  const wavesOnly = evaluate(wavesOnlyDemand)
  const cost = (ri: number) => {
    const road = graph.roads[ri]
    return bprTime(road.freeFlowSec, baselineVolumeVph(road, hour, weekend) + wavesOnlyDemand[ri], road.capacityVph)
  }
  const names = (path: number[]) => Array.from(new Set(path.map((ri) => graph.roads[ri].name).filter(Boolean)))
  const candidates: { zoneId: string; zoneName: string; normal: number[]; alt: number[]; normalSec: number; altSec: number }[] = []
  for (const zone of graph.zones) {
    const normal = normalPaths.get(zone.id) ?? []
    if (normal.length === 0) continue
    const alt = shortestPathBy(graph, zone.nearestNodeId, venue.id, cost)
    if (alt.length === 0 || (alt.length === normal.length && alt.every((ri, i) => ri === normal[i]))) continue
    const normalSec = normal.reduce((sum, ri) => sum + cost(ri), 0)
    const altSec = alt.reduce((sum, ri) => sum + cost(ri), 0)
    if (normalSec - altSec >= MIN_DIVERSION_SAVING_SEC) candidates.push({ zoneId: zone.id, zoneName: zone.name, normal, alt, normalSec, altSec })
  }
  candidates.sort((x, y) => y.normalSec - y.altSec - (x.normalSec - x.altSec))

  const planned = new Map(normalPaths)
  let current = wavesOnly
  const diversions: Diversion[] = []
  for (const c of candidates) {
    const trial = new Map(planned)
    trial.set(c.zoneId, c.alt)
    const metrics = evaluate(demandFor(chosen.peakHourShare, trial))
    if (metrics.delayVehicleHours >= current.delayVehicleHours * 0.99) continue // no real gain: skip it
    planned.set(c.zoneId, c.alt)
    current = metrics
    const latLngs: [number, number][] = []
    for (const ri of c.alt) {
      for (const point of parseWkt(graph.roads[ri].wkt)) {
        const last = latLngs[latLngs.length - 1]
        if (!last || last[0] !== point[0] || last[1] !== point[1]) latLngs.push(point)
      }
    }
    diversions.push({
      zoneId: c.zoneId,
      zoneName: c.zoneName,
      normalRoads: names(c.normal),
      divertedRoads: names(c.alt),
      savedSec: c.normalSec - c.altSec,
      normalMin: c.normalSec / 60,
      divertedMin: c.altSec / 60,
      latLngs,
    })
  }

  // 3. Marshalling points about 1.2 km before the venue on each normal approach.
  const peakVehicles = attendance * VEHICLES_PER_ATTENDEE * PEAK_HOUR_SHARE
  const marshalByNode = new Map<string, MarshalPoint>()
  for (const zone of graph.zones) {
    const path = normalPaths.get(zone.id) ?? []
    let walked = 0
    let pick: number | null = null
    for (let i = path.length - 1; i >= 0; i--) {
      walked += graph.roads[path[i]].lengthM
      if (walked >= MARSHAL_DISTANCE_M) {
        pick = path[i]
        break
      }
    }
    if (pick === null && path.length > 0) pick = path[0] // short approach: use its start
    if (pick === null) continue
    const road = graph.roads[pick]
    const from = graph.nodes.get(road.from)!
    const vehiclesPerHour = Math.round(peakVehicles * zone.vehicleShare)
    const existing = marshalByNode.get(road.from)
    if (existing) {
      // Two approaches share this node: one point serves both.
      existing.zoneName = `${existing.zoneName} + ${zone.name}`
      existing.zoneId = `${existing.zoneId}+${zone.id}`
      existing.vehiclesPerHour += vehiclesPerHour
    } else {
      marshalByNode.set(road.from, { zoneId: zone.id, zoneName: zone.name, lat: from.lat, lng: from.lng, roadName: road.name || "unnamed road", vehiclesPerHour })
    }
  }
  const marshalPoints = [...marshalByNode.values()]

  // Before / after with the same model: unmanaged vs recommended waves + diversions.
  const before = evaluate(unmanaged)
  const after = current

  return {
    evaluatedHour: hour,
    weekend,
    radiusM: PLAN_RADIUS_M,
    options,
    recommendedWaves,
    waveReason,
    diversions,
    marshalPoints,
    before,
    wavesOnly,
    after,
    assumptions: [
      "Modeled on the OpenStreetMap-derived Guntur road graph; volumes, capacities and mode shares are documented assumptions, not measured traffic.",
      "Unmanaged arrivals put 2/3 of vehicles in the busiest hour (as in the dataset); k waves put 1/k.",
      "Diversions are timed under the staggered load and kept only if re-running the model shows they cut total delay; each applies to every vehicle of that zone.",
      "Marshalling points are suggested positions about 1.2 km before the venue on each approach, not surveyed sites.",
      `Evaluated at hour ${hour.toFixed(1)}, ${weekend ? "weekend" : "weekday"}, within ${PLAN_RADIUS_M} m of the venue.`,
    ],
  }
}
