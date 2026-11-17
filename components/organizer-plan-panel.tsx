"use client"

import { useEffect, useState } from "react"
import type { OrganizerPlan } from "@/lib/guntur-plan"
import { planToHtml, waveSlots } from "@/lib/plan-export"
import type { ScheduledEvent } from "@/lib/types"

export type PlanOverlay = {
  diversions: { id: string; label: string; latLngs: [number, number][] }[]
  staging: { id: string; label: string; lat: number; lng: number }[]
}

type Props = {
  event: ScheduledEvent | null
  onOverlay: (overlay: PlanOverlay | null) => void
}

const fmt = (n: number, digits = 0) => n.toLocaleString(undefined, { maximumFractionDigits: digits })

export function OrganizerPlanPanel({ event, onOverlay }: Props) {
  const [plan, setPlan] = useState<OrganizerPlan | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [forKey, setForKey] = useState<string | null>(null)

  const key = event ? `${event.lat},${event.lng},${event.attendance},${event.startTime}` : null

  // A plan belongs to the event it was computed for: clear it when the event changes.
  useEffect(() => {
    if (forKey !== null && forKey !== key) {
      setPlan(null)
      setError(null)
      setForKey(null)
      onOverlay(null)
    }
  }, [key, forKey, onOverlay])

  useEffect(() => () => onOverlay(null), [onOverlay])

  async function generate() {
    if (!event) return
    setLoading(true)
    setError(null)
    try {
      const response = await fetch("/api/event/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat: event.lat, lng: event.lng, attendance: event.attendance, startTime: event.startTime }),
      })
      const data = (await response.json()) as { plan?: OrganizerPlan; error?: string }
      if (!response.ok || !data.plan) throw new Error(data.error ?? "Could not build a plan")
      setPlan(data.plan)
      setForKey(key)
      onOverlay({
        diversions: data.plan.diversions.map((d) => ({ id: d.zoneId, label: `${d.zoneName}: ${d.divertedRoads.slice(0, 2).join(" / ") || "diversion"}`, latLngs: d.latLngs })),
        staging: data.plan.marshalPoints.map((m) => ({ id: m.zoneId, label: `${m.zoneName} — marshalling point on ${m.roadName}`, lat: m.lat, lng: m.lng })),
      })
    } catch (cause) {
      setPlan(null)
      onOverlay(null)
      setError(cause instanceof Error ? cause.message : "Could not build a plan")
    } finally {
      setLoading(false)
    }
  }

  const start = event ? new Date(event.startTime) : null

  function exportPlan() {
    if (!plan || !event) return
    const html = planToHtml(plan, event)
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }))
    const link = document.createElement("a")
    link.href = url
    link.download = `organizer-plan-${event.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "event"}.html`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section className="rounded-xl border border-border bg-card/50 p-3">
      <h2 className="font-mono text-xs uppercase tracking-widest text-primary">Organizer Plan</h2>
      {!event ? (
        <p className="mt-2 font-mono text-[10px] text-muted-foreground">Simulate an event first, then build a plan to reduce its traffic impact.</p>
      ) : (
        <>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Staggered arrivals, diversions and marshalling points for <span className="text-foreground">{event.name}</span>, tested on the Guntur road graph.
          </p>
          <button
            type="button"
            onClick={generate}
            disabled={loading}
            className="mt-2 w-full rounded-md border border-primary/50 bg-primary/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-primary hover:bg-primary/20 disabled:opacity-50"
          >
            {loading ? "Building plan…" : plan ? "Rebuild plan" : "Build organizer plan"}
          </button>
        </>
      )}

      {error && <p className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-400">{error}</p>}

      {plan && start && (
        <div className="mt-3 flex flex-col gap-3 text-[11px]">
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { label: "Overloaded roads", before: plan.before.overCapacityRoads, after: plan.after.overCapacityRoads, digits: 0 },
              { label: "Lost veh-hours / h", before: plan.before.delayVehicleHours, after: plan.after.delayVehicleHours, digits: 1 },
              { label: "Worst road delay (s)", before: plan.before.worstRoadDelaySec, after: plan.after.worstRoadDelaySec, digits: 0 },
            ].map((m) => (
              <div key={m.label} className="rounded-md border border-border bg-card px-1 py-2">
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{m.label}</p>
                <p className="mt-1 font-mono text-xs text-muted-foreground line-through">{fmt(m.before, m.digits)}</p>
                <p className="font-mono text-sm text-primary">{fmt(m.after, m.digits)}</p>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground">
            Unmanaged vs plan, same model, busiest arrival hour ({plan.evaluatedHour.toFixed(0)}:00, {plan.weekend ? "weekend" : "weekday"}), within {plan.radiusM / 1000} km of the venue.
          </p>

          <div>
            <h3 className="font-mono text-[10px] uppercase tracking-widest text-primary">1 · Stagger arrivals</h3>
            <p className="mt-1 text-muted-foreground">
              {plan.recommendedWaves === 1 ? "No staggering needed." : <>Open entry in <span className="text-foreground">{plan.recommendedWaves} waves</span>: {waveSlots(start, plan.recommendedWaves).join(", ")}.</>}{" "}
              {plan.waveReason}
            </p>
            <table className="mt-1 w-full text-left font-mono text-[10px]">
              <thead className="text-muted-foreground">
                <tr><th>Waves</th><th>Peak veh/h</th><th>Overloaded</th><th>Lost veh-h</th></tr>
              </thead>
              <tbody>
                {plan.options.map((o) => (
                  <tr key={o.waves} className={o.waves === plan.recommendedWaves ? "text-primary" : "text-foreground"}>
                    <td>{o.waves === 1 ? "1 (none)" : o.waves}{o.waves === plan.recommendedWaves ? " ★" : ""}</td>
                    <td>{fmt(o.peakHourVehicles)}</td>
                    <td>{o.overCapacityRoads}</td>
                    <td>{fmt(o.delayVehicleHours, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <h3 className="font-mono text-[10px] uppercase tracking-widest text-primary">2 · Diversions</h3>
            {plan.diversions.length === 0 ? (
              <p className="mt-1 text-muted-foreground">No diversion beats the normal approach by enough to recommend.</p>
            ) : (
              <ul className="mt-1 flex flex-col gap-1">
                {plan.diversions.map((d) => (
                  <li key={d.zoneId} className="text-muted-foreground">
                    <span className="text-foreground">{d.zoneName}:</span> send via {d.divertedRoads.slice(0, 3).join(" → ") || "the marked route"}, about {fmt(d.divertedMin, 0)} min instead of {fmt(d.normalMin, 0)} min on {d.normalRoads.slice(0, 2).join(" / ") || "the normal route"}.
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="font-mono text-[10px] uppercase tracking-widest text-primary">3 · Marshalling points</h3>
            <ul className="mt-1 flex flex-col gap-1">
              {plan.marshalPoints.map((m) => (
                <li key={m.zoneId} className="text-muted-foreground">
                  <span className="text-foreground">{m.zoneName}</span> — {m.roadName}, about {fmt(m.vehiclesPerHour)} veh/h in the busiest unmanaged hour.
                </li>
              ))}
            </ul>
          </div>

          <button
            type="button"
            onClick={exportPlan}
            className="w-full rounded-md border border-border bg-card px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
          >
            Download printable plan
          </button>

          <details className="text-[10px] text-muted-foreground">
            <summary className="cursor-pointer font-mono uppercase tracking-wider">Assumptions</summary>
            <ul className="mt-1 list-disc pl-4">
              {plan.assumptions.map((a) => <li key={a}>{a}</li>)}
            </ul>
          </details>
        </div>
      )}
    </section>
  )
}
