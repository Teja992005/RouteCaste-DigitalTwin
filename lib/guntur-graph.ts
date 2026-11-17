import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

/**
 * Local engine over the real Guntur OpenStreetMap drive graph
 * (data/processed/guntur_roads.csv + guntur_nodes.csv + zones.csv).
 *
 * Event traffic is computed on demand instead of read from pre-built shards:
 *   1. attendance -> motorised vehicles (modal split / occupancy, as in config/guntur.yaml)
 *   2. vehicles are split across the five city zones and routed to the venue
 *      over the DIRECTED graph by free-flow Dijkstra
 *   3. baseline volume per road comes from the same hour-of-day profile the
 *      dataset generator used (without its random noise)
 *   4. BPR: t = t0 * (1 + 0.15 * min(v/c, 4)^4)
 *
 * Everything here is MODELED. Geometry is OpenStreetMap; volumes, capacities
 * and mode shares are documented assumptions, not sensor measurements.
 */

// Mirrors config/guntur.yaml (bpr, modal_split, occupancy).
export const BPR = { alpha: 0.15, beta: 4, vcCap: 4 } as const
const MODAL_SPLIT = { car: 0.3, bike: 0.4, bus: 0.15, auto_rickshaw: 0.1 } as const
const OCCUPANCY = { car: 2.2, bike: 1.3, bus: 35, auto_rickshaw: 2 } as const
/** Motorised vehicles per attendee. */
export const VEHICLES_PER_ATTENDEE =
  MODAL_SPLIT.car / OCCUPANCY.car +
  MODAL_SPLIT.bike / OCCUPANCY.bike +
  MODAL_SPLIT.bus / OCCUPANCY.bus +
  MODAL_SPLIT.auto_rickshaw / OCCUPANCY.auto_rickshaw
/** The generator splits arrivals over two hours weighted 2:1, so the peak hour carries 2/3. */
export const PEAK_HOUR_SHARE = 2 / 3
/** A venue farther than this from any graph node is outside the Guntur graph. */
export const MAX_VENUE_SNAP_M = 1500

export type GraphRoad = {
  id: string
  name: string
  from: string
  to: string
  lengthM: number
  roadType: string
  freeFlowSec: number
  capacityVph: number
  wkt: string
  midLat: number
  midLng: number
}
export type GraphNode = { id: string; lat: number; lng: number }
export type GraphZone = { id: string; name: string; nearestNodeId: string; vehicleShare: number }
export type GunturGraph = {
  roads: GraphRoad[]
  nodes: Map<string, GraphNode>
  out: Map<string, number[]> // node -> indices of roads leaving it
  zones: GraphZone[]
}

// ---------- CSV ----------

export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return []
  const split = (line: string) => {
    const out: string[] = []
    let value = ""
    let quoted = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (c === '"') {
        if (quoted && line[i + 1] === '"') {
          value += '"'
          i++
        } else quoted = !quoted
      } else if (c === "," && !quoted) {
        out.push(value)
        value = ""
      } else value += c
    }
    out.push(value)
    return out
  }
  const headers = split(lines[0])
  return lines.slice(1).map((line) => {
    const cells = split(line) // split once per line
    const row: Record<string, string> = {}
    headers.forEach((h, i) => (row[h] = cells[i] ?? ""))
    return row
  })
}

function num(value: string | undefined, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

// ---------- geometry ----------

export function haversineM(aLat: number, aLng: number, bLat: number, bLng: number) {
  const r = 6371000
  const p = Math.PI / 180
  const dLat = (bLat - aLat) * p
  const dLng = (bLng - aLng) * p
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * p) * Math.cos(bLat * p) * Math.sin(dLng / 2) ** 2
  return 2 * r * Math.asin(Math.sqrt(x))
}

/** "LINESTRING (lng lat, lng lat)" -> [[lat, lng], ...] */
export function parseWkt(wkt: string): [number, number][] {
  const inner = wkt.slice(wkt.indexOf("(") + 1, wkt.lastIndexOf(")"))
  return inner
    .split(",")
    .map((pair) => pair.trim().split(/\s+/).map(Number))
    .filter((p) => p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .map((p): [number, number] => [p[1], p[0]])
}

// ---------- graph ----------

export function buildGraph(
  roadRows: Record<string, string>[],
  nodeRows: Record<string, string>[],
  zoneRows: Record<string, string>[],
): GunturGraph {
  const nodes = new Map<string, GraphNode>()
  for (const n of nodeRows) nodes.set(n.node_id, { id: n.node_id, lat: num(n.latitude), lng: num(n.longitude) })

  const roads: GraphRoad[] = []
  const out = new Map<string, number[]>()
  for (const r of roadRows) {
    const a = nodes.get(r.from_node)
    const b = nodes.get(r.to_node)
    if (!a || !b) continue
    const idx = roads.length
    roads.push({
      id: r.road_id,
      name: r.road_name && r.road_name !== "nan" ? r.road_name : "",
      from: r.from_node,
      to: r.to_node,
      lengthM: num(r.length_m),
      roadType: r.road_type || "unclassified",
      freeFlowSec: Math.max(0.1, num(r.free_flow_time_sec, 1)),
      capacityVph: Math.max(1, num(r.capacity_vph, 700)),
      wkt: r.geometry_wkt,
      midLat: (a.lat + b.lat) / 2,
      midLng: (a.lng + b.lng) / 2,
    })
    const list = out.get(r.from_node)
    if (list) list.push(idx)
    else out.set(r.from_node, [idx])
  }
  const zones = zoneRows.map((z) => ({ id: z.zone_id, name: z.zone_name || z.zone_id, nearestNodeId: z.nearest_node_id, vehicleShare: num(z.vehicle_share) }))
  return { roads, nodes, out, zones }
}

export function nearestNode(graph: GunturGraph, lat: number, lng: number): { id: string; distM: number } | null {
  let best: { id: string; distM: number } | null = null
  let bestScore = Infinity
  const cos = Math.cos((lat * Math.PI) / 180)
  for (const n of graph.nodes.values()) {
    const score = (n.lat - lat) ** 2 + ((n.lng - lng) * cos) ** 2 // cheap pre-filter
    if (score < bestScore) {
      bestScore = score
      best = { id: n.id, distM: 0 }
    }
  }
  if (!best) return null
  const n = graph.nodes.get(best.id)!
  return { id: best.id, distM: haversineM(lat, lng, n.lat, n.lng) }
}

// ---------- shortest path (binary heap) ----------

type HeapItem = [number, string]
function heapPush(q: HeapItem[], item: HeapItem) {
  q.push(item)
  let i = q.length - 1
  while (i > 0) {
    const p = (i - 1) >> 1
    if (q[p][0] <= item[0]) break
    q[i] = q[p]
    i = p
  }
  q[i] = item
}
function heapPop(q: HeapItem[]): HeapItem {
  const top = q[0]
  const last = q.pop()!
  if (q.length) {
    let i = 0
    for (;;) {
      const l = i * 2 + 1
      if (l >= q.length) break
      const r = l + 1
      const s = r < q.length && q[r][0] < q[l][0] ? r : l
      if (q[s][0] >= last[0]) break
      q[i] = q[s]
      i = s
    }
    q[i] = last
  }
  return top
}

/** Dijkstra over directed roads with a custom per-road cost. Returns road indices start -> goal, or [] when unreachable. */
export function shortestPathBy(graph: GunturGraph, start: string, goal: string, cost: (roadIndex: number) => number): number[] {
  if (start === goal) return []
  const dist = new Map<string, number>([[start, 0]])
  const prev = new Map<string, number>() // node -> road index used to reach it
  const queue: HeapItem[] = [[0, start]]
  while (queue.length) {
    const [d, u] = heapPop(queue)
    if (d > (dist.get(u) ?? Infinity)) continue
    if (u === goal) break
    for (const ri of graph.out.get(u) ?? []) {
      const road = graph.roads[ri]
      const nd = d + cost(ri)
      if (nd < (dist.get(road.to) ?? Infinity)) {
        dist.set(road.to, nd)
        prev.set(road.to, ri)
        heapPush(queue, [nd, road.to])
      }
    }
  }
  if (!prev.has(goal)) return []
  const path: number[] = []
  let cur = goal
  while (cur !== start) {
    const ri = prev.get(cur)!
    path.push(ri)
    cur = graph.roads[ri].from
  }
  return path.reverse()
}

/** Free-flow Dijkstra over directed roads. */
export function shortestRoadPath(graph: GunturGraph, start: string, goal: string): number[] {
  return shortestPathBy(graph, start, goal, (ri) => graph.roads[ri].freeFlowSec)
}

// ---------- traffic model ----------

/** Hour-of-day demand profile used by scripts/generate_baseline_traffic.py (noise excluded). */
export function baselineProfile(hour: number, weekend: boolean, roadType: string) {
  const morning = Math.exp(-(((hour - 8) / 2.0) ** 2))
  const evening = Math.exp(-(((hour - 18) / 2.4) ** 2))
  const midday = Math.exp(-(((hour - 13) / 3.0) ** 2))
  const arterial = roadType === "primary" || roadType === "trunk" || roadType === "secondary" ? 1.15 : 0.85
  return 0.1 + arterial * ((weekend ? 0.3 : 0.48) * morning + (weekend ? 0.4 : 0.6) * evening + 0.2 * midday)
}

/** Deterministic per-road offset in about [-0.06, 0.06], as in the generator. */
export function roadOffset(roadId: string) {
  const hex = crypto.createHash("sha256").update(roadId).digest("hex").slice(0, 4)
  return (parseInt(hex, 16) / 65535 - 0.5) * 0.12
}

export function baselineVolumeVph(road: GraphRoad, hour: number, weekend: boolean) {
  return Math.max(0, road.capacityVph * Math.min(1.15, baselineProfile(hour, weekend, road.roadType) + roadOffset(road.id)))
}

export function bprTime(t0: number, volume: number, capacity: number) {
  return t0 * (1 + BPR.alpha * Math.min(volume / capacity, BPR.vcCap) ** BPR.beta)
}

/**
 * Event vehicles per road (veh/h), indexed like graph.roads. Each zone's share
 * of attendees is routed to the venue node. `peakShare` is the fraction of all
 * vehicles arriving in the busiest hour; `pathsByZone` lets a plan supply its
 * own (for example diverted) routes instead of the free-flow shortest path.
 */
export function eventDemandVph(
  graph: GunturGraph,
  venueNodeId: string,
  attendance: number,
  peakShare: number = PEAK_HOUR_SHARE,
  pathsByZone?: Map<string, number[]>,
): Float64Array {
  const demand = new Float64Array(graph.roads.length)
  const vehicles = Math.max(0, attendance) * VEHICLES_PER_ATTENDEE * peakShare
  for (const zone of graph.zones) {
    const share = vehicles * zone.vehicleShare
    if (share <= 0) continue
    const path = pathsByZone?.get(zone.id) ?? shortestRoadPath(graph, zone.nearestNodeId, venueNodeId)
    for (const ri of path) demand[ri] += share
  }
  return demand
}

// ---------- loading ----------

const root = () => path.join(process.cwd(), "data", "processed")
let cached: GunturGraph | null | undefined

/** Loads and caches the graph; null when the dataset files are not present. */
export function loadGunturGraph(): GunturGraph | null {
  if (cached !== undefined) return cached
  try {
    const read = (name: string) => fs.readFileSync(path.join(root(), name), "utf8")
    const graph = buildGraph(parseCsv(read("guntur_roads.csv")), parseCsv(read("guntur_nodes.csv")), parseCsv(read("zones.csv")))
    cached = graph.roads.length > 0 ? graph : null
  } catch {
    cached = null
  }
  return cached
}

// ---------- event segments for the map ----------

export type GraphSegment = {
  points: [number, number][]
  congestion: number // 0..1 (volume/capacity, clamped)
  highway: string
  vcr: number
  delaySec: number // BPR delay caused by the event on this road
  /** Volume/capacity with normal traffic only (no event), clamped 0..1. */
  baseCongestion: number
}

const demandCache = new Map<string, Float64Array>()
function cachedDemand(graph: GunturGraph, venueNodeId: string, attendance: number) {
  const key = `${venueNodeId}|${Math.round(attendance)}`
  let demand = demandCache.get(key)
  if (!demand) {
    demand = eventDemandVph(graph, venueNodeId, attendance)
    if (demandCache.size >= 24) demandCache.delete(demandCache.keys().next().value as string)
    demandCache.set(key, demand)
  }
  return demand
}

export type EventSegmentsArgs = {
  lat: number
  lng: number
  attendance: number
  /** 0..1: how strongly the event is loading the roads right now (bell phase). */
  phase: number
  hour: number
  weekend: boolean
  radiusM: number
}
export type EventSegmentsResult = { segments: GraphSegment[]; venueSnapM: number; venueNodeId: string }

/** Per-road congestion around a venue, or null if the venue is outside the loaded graph. */
export function gunturEventSegments(args: EventSegmentsArgs, graph: GunturGraph | null = loadGunturGraph()): EventSegmentsResult | null {
  if (!graph) return null
  const venue = nearestNode(graph, args.lat, args.lng)
  if (!venue || venue.distM > MAX_VENUE_SNAP_M) return null

  const phase = Math.max(0, Math.min(1, args.phase))
  const demand = cachedDemand(graph, venue.id, args.attendance)
  const merged = new Map<string, GraphSegment>() // one segment per two-way pair

  for (let i = 0; i < graph.roads.length; i++) {
    const road = graph.roads[i]
    if (haversineM(args.lat, args.lng, road.midLat, road.midLng) > args.radiusM) continue
    const base = baselineVolumeVph(road, args.hour, args.weekend)
    const event = demand[i] * phase
    const vcr = (base + event) / road.capacityVph
    const delaySec = bprTime(road.freeFlowSec, base + event, road.capacityVph) - bprTime(road.freeFlowSec, base, road.capacityVph)
    const key = road.from < road.to ? `${road.from}|${road.to}` : `${road.to}|${road.from}`
    const existing = merged.get(key)
    if (existing && existing.vcr >= vcr) continue
    const points = parseWkt(road.wkt)
    if (points.length < 2) continue
    merged.set(key, { points, congestion: Math.max(0, Math.min(1, vcr)), highway: road.roadType, vcr, delaySec, baseCongestion: Math.max(0, Math.min(1, base / road.capacityVph)) })
  }
  return { segments: [...merged.values()], venueSnapM: venue.distM, venueNodeId: venue.id }
}

// ---------- point-to-point routing on the graph (offline fallback) ----------

export type GraphRouteStep = { name: string; distanceM: number; durationSec: number }
export type GraphRoute = {
  latLngs: [number, number][]
  distanceM: number
  durationSec: number
  steps: GraphRouteStep[]
  /** Distance from each requested endpoint to the graph node it snapped to. */
  snapM: { origin: number; destination: number }
}

/**
 * Free-flow shortest route between two coordinates over the directed Guntur
 * graph. Returns null when either end is farther than MAX_VENUE_SNAP_M from the
 * graph or no directed path exists. Free-flow only: no traffic is applied.
 */
export function routeOnGraph(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
  graph: GunturGraph | null = loadGunturGraph(),
): GraphRoute | null {
  if (!graph) return null
  const a = nearestNode(graph, from.lat, from.lon)
  const b = nearestNode(graph, to.lat, to.lon)
  if (!a || !b || a.distM > MAX_VENUE_SNAP_M || b.distM > MAX_VENUE_SNAP_M) return null
  const path = shortestRoadPath(graph, a.id, b.id)
  if (path.length === 0 && a.id !== b.id) return null

  const latLngs: [number, number][] = [[from.lat, from.lon]]
  const steps: GraphRouteStep[] = []
  let distanceM = 0
  let durationSec = 0
  for (const ri of path) {
    const road = graph.roads[ri]
    for (const point of parseWkt(road.wkt)) {
      const last = latLngs[latLngs.length - 1]
      if (last[0] !== point[0] || last[1] !== point[1]) latLngs.push(point)
    }
    distanceM += road.lengthM
    durationSec += road.freeFlowSec
    const prev = steps[steps.length - 1]
    if (prev && prev.name === road.name) {
      prev.distanceM += road.lengthM
      prev.durationSec += road.freeFlowSec
    } else steps.push({ name: road.name, distanceM: road.lengthM, durationSec: road.freeFlowSec })
  }
  latLngs.push([to.lat, to.lon])
  // The straight hops from the real endpoints to their snapped nodes count too (about 30 km/h).
  distanceM += a.distM + b.distM
  durationSec += (a.distM + b.distM) / 8.3
  return { latLngs, distanceM, durationSec, steps, snapM: { origin: a.distM, destination: b.distM } }
}

// ---------- event-aware routing (normal route vs re-route) ----------

export type PathSummary = {
  latLngs: [number, number][]
  roadNames: string[]
  distanceM: number
  freeFlowSec: number
  /** Travel time on this path with baseline + event traffic (BPR). */
  underEventSec: number
}

function summarisePath(graph: GunturGraph, path: number[], cost: (ri: number) => number): PathSummary {
  const latLngs: [number, number][] = []
  const names: string[] = []
  let distanceM = 0
  let freeFlowSec = 0
  let underEventSec = 0
  for (const ri of path) {
    const road = graph.roads[ri]
    for (const point of parseWkt(road.wkt)) {
      const last = latLngs[latLngs.length - 1]
      if (!last || last[0] !== point[0] || last[1] !== point[1]) latLngs.push(point)
    }
    if (road.name && names[names.length - 1] !== road.name) names.push(road.name)
    distanceM += road.lengthM
    freeFlowSec += road.freeFlowSec
    underEventSec += cost(ri)
  }
  return { latLngs, roadNames: names, distanceM, freeFlowSec, underEventSec }
}

export type EventRouteArgs = {
  from: { lat: number; lon: number }
  to: { lat: number; lon: number }
  venue: { lat: number; lng: number; attendance: number }
  phase: number
  hour: number
  weekend: boolean
}
export type EventRouteComparison = {
  /** The route you would take without knowing about the event (free-flow shortest). */
  normal: PathSummary
  /** The route that minimises travel time under the event load. */
  rerouted: PathSummary
  /** Seconds saved by re-routing (>= 0). */
  savedSec: number
  samePath: boolean
}

/**
 * Compares the normal free-flow route with the best route under event load.
 * Both are timed with the same BPR model, so the saving is like for like.
 */
export function compareRoutesUnderEvent(args: EventRouteArgs, graph: GunturGraph | null = loadGunturGraph()): EventRouteComparison | null {
  if (!graph) return null
  const a = nearestNode(graph, args.from.lat, args.from.lon)
  const b = nearestNode(graph, args.to.lat, args.to.lon)
  const venue = nearestNode(graph, args.venue.lat, args.venue.lng)
  if (!a || !b || !venue || a.distM > MAX_VENUE_SNAP_M || b.distM > MAX_VENUE_SNAP_M || venue.distM > MAX_VENUE_SNAP_M) return null

  const demand = cachedDemand(graph, venue.id, args.venue.attendance)
  const phase = Math.max(0, Math.min(1, args.phase))
  const eventCost = (ri: number) => {
    const road = graph.roads[ri]
    return bprTime(road.freeFlowSec, baselineVolumeVph(road, args.hour, args.weekend) + demand[ri] * phase, road.capacityVph)
  }
  const normalPath = shortestRoadPath(graph, a.id, b.id)
  if (normalPath.length === 0 && a.id !== b.id) return null
  const reroutedPath = shortestPathBy(graph, a.id, b.id, eventCost)
  const normal = summarisePath(graph, normalPath, eventCost)
  const rerouted = summarisePath(graph, reroutedPath, eventCost)
  const samePath = normalPath.length === reroutedPath.length && normalPath.every((ri, i) => ri === reroutedPath[i])
  return { normal, rerouted, savedSec: Math.max(0, normal.underEventSec - rerouted.underEventSec), samePath }
}
