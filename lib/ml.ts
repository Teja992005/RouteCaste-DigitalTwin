// ---------------------------------------------------------------------------
// Server-side ONNX inference — ETA regression + congestion classification.
//
// Feature vectors match ml/schema.py exactly. See lib/ml-contracts.ts for
// the typed input contracts and the approved proxy values.
//
// ETA model output:    scalar log-ratio  →  decoded to minutes via exp()
// Congestion output:   5-class logits    →  decoded via softmax + argmax
//
// Every public function returns a { source } tag so callers can label
// predictions truthfully ("model" | "heuristic").
// ---------------------------------------------------------------------------

import path from "node:path"
import fs from "node:fs"
import type { InferenceSession, Tensor as OrtTensor } from "onnxruntime-node"
import {
  CONGESTION_CLASSES,
  type EtaModelInput,
  type CongestionModelInput,
  type EtaPrediction,
  type CongestionPrediction,
} from "@/lib/ml-contracts"

// Re-export contracts so callers import from a single place.
export type { EtaModelInput, CongestionModelInput, EtaPrediction, CongestionPrediction }
export { CONGESTION_CLASSES }
export type { CongestionClass } from "@/lib/ml-contracts"

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

type SessionState = {
  session: InferenceSession | null
  /** True after the first load attempt, regardless of outcome. */
  tried: boolean
  /**
   * The in-flight (or finished) load. Concurrent callers share this promise so
   * that a cold start never hands a not-yet-created session out as `null`.
   */
  loading: Promise<InferenceSession | null> | null
  /** True after a complete, finite model output was successfully decoded. */
  inferenceSucceeded: boolean
  path: string
}

const state: Record<"eta" | "congestion", SessionState> = {
  eta: {
    session: null,
    tried: false,
    loading: null,
    inferenceSucceeded: false,
    path: resolvePath("eta", "ETA_MODEL_PATH"),
  },
  congestion: {
    session: null,
    tried: false,
    loading: null,
    inferenceSucceeded: false,
    path: resolvePath("congestion", "CONGESTION_MODEL_PATH"),
  },
}

function resolvePath(name: "eta" | "congestion", envKey: string): string {
  const fromEnv = process.env[envKey]
  if (fromEnv?.trim()) return fromEnv.trim()
  return path.join(process.cwd(), "models", `${name}.onnx`)
}

/** Lazily load and cache an ONNX session; null when unavailable. */
function getSession(name: "eta" | "congestion"): Promise<InferenceSession | null> {
  const s = state[name]
  if (!s.loading) {
    s.tried = true
    s.loading = loadSession(name)
  }
  return s.loading
}

async function loadSession(name: "eta" | "congestion"): Promise<InferenceSession | null> {
  const s = state[name]
  if (!fs.existsSync(/*turbopackIgnore: true*/ s.path)) return null
  try {
    const ort = await import("onnxruntime-node")
    s.session = await ort.InferenceSession.create(s.path)
    console.log(`[routecast] ML model loaded: ${name} <- ${s.path}`)
  } catch (err) {
    console.warn(`[routecast] ML model load failed for ${name}:`, (err as Error).message)
    s.session = null
  }
  return s.session
}

/** Run inference; returns the raw output Float32Array or null on any failure. */
async function runRaw(name: "eta" | "congestion", features: number[]): Promise<Float32Array | null> {
  const session = await getSession(name)
  if (!session) return null
  try {
    const ort = await import("onnxruntime-node")
    const input = new ort.Tensor("float32", Float32Array.from(features), [1, features.length])
    const feeds: Record<string, OrtTensor> = { [session.inputNames[0]]: input }
    const out = await session.run(feeds)
    return out[session.outputNames[0]].data as Float32Array
  } catch (err) {
    console.warn(`[routecast] ML inference error for ${name}:`, (err as Error).message)
    return null
  }
}

// ---------------------------------------------------------------------------
// Feature encoders — exported for unit testing
// ---------------------------------------------------------------------------

export function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

/**
 * Cyclical hour encoding matching ml/schema.py hour_cyclical().
 * Returns [sin, cos] for a decimal hour in 0..24.
 */
export function hourCyclical(hour: number): [number, number] {
  const rad = (2 * Math.PI * hour) / 24
  return [Math.sin(rad), Math.cos(rad)]
}

/**
 * Build the 9-feature ETA vector in exact schema.py order.
 *
 * Returns null when any required source value is non-finite or invalid,
 * which causes the caller to fall back to its heuristic.
 */
export function buildEtaFeatures(input: EtaModelInput, hour: number): number[] | null {
  const {
    distanceKm,
    currentTravelTimeSec,
    congestionProxy,
    eventProximity,
    scenarioSeverity,
    eventLoad,
  } = input

  // Guard: currentTravelTimeSec must be positive (used for log and inverse-transform).
  if (!Number.isFinite(currentTravelTimeSec) || currentTravelTimeSec <= 0) return null
  if (!Number.isFinite(distanceKm)) return null

  const [hs, hc] = hourCyclical(hour)

  const feats: number[] = [
    // 1. distance_km_over_10
    clamp01(distanceKm / 10),
    // 2. current_travel_time_log = clamp(log1p(tt_sec) / log1p(3600), 0, 1)
    clamp01(Math.log1p(currentTravelTimeSec) / Math.log1p(3600)),
    // 3. current_congestion  (proxy)
    clamp01(congestionProxy),
    // 4. current_speed_normalized = 1 − congestion  (proxy complement)
    clamp01(1 - congestionProxy),
    // 5. hour_sin
    hs,
    // 6. hour_cos
    hc,
    // 7. event_proximity  (0 in Directions mode)
    clamp01(eventProximity),
    // 8. scenario_severity
    clamp01(scenarioSeverity),
    // 9. event_load  (0 in Directions mode)
    clamp01(eventLoad),
  ]

  if (!feats.every(Number.isFinite)) return null
  return feats
}

/**
 * Build the 9-feature congestion vector in exact schema.py order.
 *
 * Returns null when any value is non-finite.
 */
export function buildCongestionFeatures(input: CongestionModelInput, hour: number): number[] | null {
  const {
    congestionProxy,
    horizonMinutes,
    roadCapacityProxy,
    incidentLoad,
    scenarioSeverity,
    eventProximity,
  } = input

  // Guard: horizonMinutes must be finite (Infinity would clamp to 1 silently)
  if (!Number.isFinite(horizonMinutes)) return null

  const [hs, hc] = hourCyclical(hour)

  const feats: number[] = [
    // 1. current_congestion  (proxy)
    clamp01(congestionProxy),
    // 2. step_over_6 = clamp(horizon_minutes / 60, 0, 1)
    //    Note: the schema name is misleading; the formula is /60, not /6.
    clamp01(horizonMinutes / 60),
    // 3. current_speed_normalized = 1 − congestion  (proxy complement)
    clamp01(1 - congestionProxy),
    // 4. road_capacity_normalized  (neutral prior 0.5 when unavailable)
    clamp01(roadCapacityProxy),
    // 5. hour_sin
    hs,
    // 6. hour_cos
    hc,
    // 7. incident_load
    clamp01(incidentLoad),
    // 8. scenario_severity
    clamp01(scenarioSeverity),
    // 9. event_proximity  (0 in Directions mode)
    clamp01(eventProximity),
  ]

  if (!feats.every(Number.isFinite)) return null
  return feats
}

// ---------------------------------------------------------------------------
// Output decoders — exported for unit testing
// ---------------------------------------------------------------------------

/**
 * Decode the ETA model's scalar log-ratio output back into minutes.
 *
 * Training target: log(future_tt / current_tt)
 * Inverse:         future_tt_sec = current_tt_sec × exp(pred)
 *                  etaMin        = future_tt_sec / 60
 *
 * Returns null when pred or currentTravelTimeSec are invalid.
 */
export function decodeEtaOutput(pred: number, currentTravelTimeSec: number): number | null {
  if (!Number.isFinite(pred)) return null
  if (!Number.isFinite(currentTravelTimeSec) || currentTravelTimeSec <= 0) return null

  const factor = Math.exp(pred)
  const etaMin = (currentTravelTimeSec * factor) / 60

  if (!Number.isFinite(etaMin)) return null
  return Math.max(0.2, etaMin)
}

/**
 * Decode the congestion model's 5-class logit output.
 *
 * Applies numerically stable softmax, then argmax.
 * Returns null when the output array has the wrong shape or contains
 * non-finite values.
 *
 * Class order: 0=free · 1=light · 2=moderate · 3=heavy · 4=severe
 * Score:       classIndex / 4  →  0..1
 */
export function decodeCongestionOutput(
  logits: Float32Array | number[],
): CongestionPrediction | null {
  if (!logits || logits.length !== 5) return null

  const arr = Array.from(logits)
  if (!arr.every(Number.isFinite)) return null

  // Numerically stable softmax: subtract max before exponentiation.
  const maxL = Math.max(...arr)
  const exps = arr.map((l) => Math.exp(l - maxL))
  const sum = exps.reduce((a, b) => a + b, 0)
  if (sum === 0 || !Number.isFinite(sum)) return null

  const probs = exps.map((e) => e / sum)
  const classIndex = probs.indexOf(Math.max(...probs)) as 0 | 1 | 2 | 3 | 4

  return {
    score: classIndex / 4,
    classIndex,
    className: CONGESTION_CLASSES[classIndex],
    source: "model",
  }
}

// ---------------------------------------------------------------------------
// Heuristic fallback helpers
// ---------------------------------------------------------------------------

function heuristicEta(heuristicMin: number): EtaPrediction {
  return { etaMin: Math.max(0.2, heuristicMin), source: "heuristic" }
}

function heuristicCongestion(heuristic: number): CongestionPrediction {
  const score = clamp01(heuristic)
  const classIndex = Math.min(4, Math.round(score * 4)) as 0 | 1 | 2 | 3 | 4
  return {
    score,
    classIndex,
    className: CONGESTION_CLASSES[classIndex],
    source: "heuristic",
  }
}

// ---------------------------------------------------------------------------
// Context (kept for caller backward-compat)
// ---------------------------------------------------------------------------

/**
 * Prediction context shared by both models.
 *
 * Only `hour` and `scenarioSeverity` map to training features.
 * `isWeekend`, `areaDensity`, and `rain` are NOT training features and are
 * not forwarded to any model input; they are preserved for caller compat only.
 */
export type PredictContext = {
  hour: number
  /** Not a training feature — preserved for backward compatibility. */
  isWeekend: boolean
  /** Not a training feature — preserved for backward compatibility. */
  areaDensity: number
  scenarioSeverity: number
  /** Not a training feature — preserved for backward compatibility. */
  rain: number
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Predict ETA in minutes using the ONNX model with correct feature encoding. */
export async function predictEta(
  input: EtaModelInput | null,
  ctx: PredictContext,
  heuristicMin: number,
): Promise<EtaPrediction> {
  if (!input) return heuristicEta(heuristicMin)
  const feats = buildEtaFeatures(input, ctx.hour)
  if (!feats) return heuristicEta(heuristicMin)

  const raw = await runRaw("eta", feats)
  if (!raw || raw.length === 0) return heuristicEta(heuristicMin)

  const etaMin = decodeEtaOutput(raw[0], input.currentTravelTimeSec)
  if (etaMin === null) return heuristicEta(heuristicMin)

  state.eta.inferenceSucceeded = true
  return { etaMin, source: "model" }
}

/** Predict next-interval congestion using the 5-class ONNX model. */
export async function predictCongestion(
  input: CongestionModelInput | null,
  ctx: PredictContext,
  heuristic: number,
): Promise<CongestionPrediction> {
  if (!input) return heuristicCongestion(heuristic)
  const feats = buildCongestionFeatures(input, ctx.hour)
  if (!feats) return heuristicCongestion(heuristic)

  const raw = await runRaw("congestion", feats)
  if (!raw || raw.length !== 5) return heuristicCongestion(heuristic)

  const result = decodeCongestionOutput(raw)
  if (!result) return heuristicCongestion(heuristic)

  state.congestion.inferenceSucceeded = true
  return result
}

/**
 * Re-rank candidate routes by ML-predicted ETA (lowest first).
 * Falls back to heuristic (route.totalTimeMin) when the model is unavailable.
 */
type EtaRerankRoute = { totalDistanceKm: number; totalTimeMin: number; mlEtaMin?: number }

export async function rerankRoutesByEta<T extends EtaRerankRoute>(
  routes: T[],
  ctx: PredictContext,
  inputForRoute?: (route: T) => EtaModelInput | null,
): Promise<{ routes: T[]; source: "model" | "heuristic"; rerouted: boolean }> {
  if (routes.length === 0) return { routes, source: "heuristic", rerouted: false }

  let usedModel = false
  const scored = await Promise.all(
    routes.map(async (r) => {
      // Route summaries do not carry the road-level speed, event, or event
      // load fields required by training. Do not manufacture them from route
      // averages; callers with complete source data may provide an encoder.
      const input = inputForRoute?.(r) ?? null
      const pred = await predictEta(input, ctx, r.totalTimeMin)
      if (pred.source === "model") usedModel = true
      r.mlEtaMin = Math.round(pred.etaMin * 10) / 10
      return { route: r, eta: pred.etaMin }
    }),
  )

  const originalTop = scored[0].route
  scored.sort((a, b) => a.eta - b.eta)
  const rerouted = scored[0].route !== originalTop

  return {
    routes: scored.map((s) => s.route),
    source: usedModel ? "model" : "heuristic",
    rerouted,
  }
}

/** True only after at least one inference produced a valid decoded result. */
export function modelStatus(): { eta: boolean; congestion: boolean } {
  return {
    eta: state.eta.inferenceSucceeded,
    congestion: state.congestion.inferenceSucceeded,
  }
}

export type ModelSessionStatus = "not-attempted" | "ready" | "unavailable"

/** Session initialization is reported separately from successful inference. */
export function modelSessionStatus(): { eta: ModelSessionStatus; congestion: ModelSessionStatus } {
  return {
    eta: !state.eta.tried ? "not-attempted" : state.eta.session ? "ready" : "unavailable",
    congestion: !state.congestion.tried
      ? "not-attempted"
      : state.congestion.session
        ? "ready"
        : "unavailable",
  }
}
