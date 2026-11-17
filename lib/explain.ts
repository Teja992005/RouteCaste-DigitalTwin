/**
 * Explainability for event delay: which inputs drove a route's extra minutes.
 *
 * Uses exact Shapley attribution on the SAME ETA model that produced the delay.
 * The model's event-scenario inputs are split into four groups; each group is
 * switched from its normal-traffic value to its event value in every possible
 * combination (16 model runs), and each group's average marginal effect is its
 * share. The shares add up exactly to the model's event-minus-baseline ETA.
 */
import type { EtaModelInput } from "@/lib/ml-contracts"

export type DelayDriverId = "congestion" | "proximity" | "severity" | "load"

export type DelayDriver = {
  id: DelayDriverId
  label: string
  /** Minutes of delay attributed to this input group (can be slightly negative). */
  minutes: number
  /** Share of the total delay, 0..1 (0 when there is no delay). */
  share: number
}

export const DRIVER_LABELS: Record<DelayDriverId, string> = {
  congestion: "Extra congestion on the road",
  proximity: "Route passes close to the venue",
  severity: "Event impact strength at the route",
  load: "Crowd size (attendance and duration)",
}

const IDS: DelayDriverId[] = ["congestion", "proximity", "severity", "load"]

function blend(base: EtaModelInput, event: EtaModelInput, on: Set<DelayDriverId>): EtaModelInput {
  return {
    ...base,
    currentTravelTimeSec: on.has("congestion") ? event.currentTravelTimeSec : base.currentTravelTimeSec,
    congestionProxy: on.has("congestion") ? event.congestionProxy : base.congestionProxy,
    eventProximity: on.has("proximity") ? event.eventProximity : base.eventProximity,
    scenarioSeverity: on.has("severity") ? event.scenarioSeverity : base.scenarioSeverity,
    eventLoad: on.has("load") ? event.eventLoad : base.eventLoad,
  }
}

function factorial(n: number): number {
  return n <= 1 ? 1 : n * factorial(n - 1)
}

/**
 * @param base   ETA input for normal traffic
 * @param event  ETA input with the event
 * @param etaMin returns the model ETA in minutes for an input
 * Returns drivers sorted by minutes, largest first.
 */
export async function explainEtaDelay(
  base: EtaModelInput,
  event: EtaModelInput,
  etaMin: (input: EtaModelInput) => Promise<number>,
): Promise<{ totalMin: number; drivers: DelayDriver[] }> {
  const value = new Map<number, number>()
  const subsets: number[] = Array.from({ length: 16 }, (_, i) => i)
  await Promise.all(
    subsets.map(async (mask) => {
      const on = new Set(IDS.filter((_, bit) => (mask >> bit) & 1))
      value.set(mask, await etaMin(blend(base, event, on)))
    }),
  )
  const n = IDS.length
  const total = value.get(15)! - value.get(0)!
  const drivers = IDS.map((id, bit) => {
    let phi = 0
    for (const mask of subsets) {
      if ((mask >> bit) & 1) continue
      const size = IDS.filter((_, b) => (mask >> b) & 1).length
      const weight = (factorial(size) * factorial(n - size - 1)) / factorial(n)
      phi += weight * (value.get(mask | (1 << bit))! - value.get(mask)!)
    }
    return { id, label: DRIVER_LABELS[id], minutes: phi, share: 0 }
  })
  const denom = Math.abs(total) > 1e-6 ? total : 0
  for (const d of drivers) d.share = denom ? d.minutes / denom : 0
  drivers.sort((a, b) => b.minutes - a.minutes)
  return { totalMin: total, drivers }
}
