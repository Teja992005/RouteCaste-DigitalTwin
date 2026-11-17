import type { OrganizerPlan } from "@/lib/guntur-plan"

const esc = (v: string | number) =>
  String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
const n = (v: number, d = 0) => v.toLocaleString("en-IN", { maximumFractionDigits: d })

function clock(d: Date) {
  return d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })
}

/** One arrival slot per wave, ending at the event start. */
export function waveSlots(start: Date, waves: number): string[] {
  return Array.from({ length: waves }, (_, i) => {
    const from = new Date(start.getTime() - (waves - i) * 3600_000)
    const to = new Date(start.getTime() - (waves - i - 1) * 3600_000)
    return `${clock(from)} – ${clock(to)}`
  })
}

/** A self-contained, printable HTML page for marshals and organizers. */
export function planToHtml(plan: OrganizerPlan, event: { name: string; locationName?: string; attendance: number; startTime: string }): string {
  const start = new Date(event.startTime)
  const slots = plan.recommendedWaves > 1 ? waveSlots(start, plan.recommendedWaves) : []
  const row = (cells: (string | number)[]) => `<tr>${cells.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`
  const metric = (label: string, before: number, after: number, d = 0) => row([label, n(before, d), n(after, d)])
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Organizer plan – ${esc(event.name)}</title>
<style>body{font:14px/1.5 system-ui,sans-serif;max-width:760px;margin:2rem auto;padding:0 1rem;color:#111}h1{font-size:22px;margin:0}h2{font-size:15px;margin:1.5rem 0 .4rem;border-bottom:1px solid #ccc;padding-bottom:.2rem}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:.3rem .5rem;text-align:left}small,.muted{color:#555}</style></head><body>
<h1>Organizer plan: ${esc(event.name)}</h1>
<p class="muted">${esc(event.locationName ?? "")} · ${esc(n(event.attendance))} attendees · starts ${esc(start.toLocaleString("en-IN"))}<br>Guntur road graph model (OpenStreetMap roads, BPR travel times). Modeled estimates, not measured traffic.</p>
<h2>Expected effect (busiest arrival hour, ${esc(plan.evaluatedHour.toFixed(0))}:00, ${plan.weekend ? "weekend" : "weekday"}, within ${plan.radiusM / 1000} km of the venue)</h2>
<table><tr><th></th><th>Unmanaged</th><th>With this plan</th></tr>
${metric("Overloaded roads", plan.before.overCapacityRoads, plan.after.overCapacityRoads)}
${metric("Lost vehicle-hours per hour", plan.before.delayVehicleHours, plan.after.delayVehicleHours, 1)}
${metric("Worst single-road delay (s)", plan.before.worstRoadDelaySec, plan.after.worstRoadDelaySec)}</table>
<h2>1. Staggered arrivals</h2>
<p>${plan.recommendedWaves === 1 ? "No staggering needed." : `Open entry in <b>${plan.recommendedWaves} waves</b>: ${slots.map(esc).join(", ")}.`} ${esc(plan.waveReason)}</p>
<h2>2. Diversions</h2>
${plan.diversions.length === 0 ? "<p>No diversion beats the normal approach by enough to recommend.</p>" : `<ul>${plan.diversions.map((d) => `<li><b>${esc(d.zoneName)}:</b> via ${esc(d.divertedRoads.join(" → ") || "marked route")}, about ${esc(n(d.divertedMin))} min instead of ${esc(n(d.normalMin))} min on ${esc(d.normalRoads.join(" / ") || "the normal route")}.</li>`).join("")}</ul>`}
<h2>3. Marshalling points</h2>
<table><tr><th>Approach</th><th>Road</th><th>Location</th><th>Veh/h (unmanaged peak)</th></tr>
${plan.marshalPoints.map((m) => row([m.zoneName, m.roadName, `${m.lat.toFixed(5)}, ${m.lng.toFixed(5)}`, n(m.vehiclesPerHour)])).join("\n")}</table>
<h2>Assumptions</h2><ul>${plan.assumptions.map((a) => `<li><small>${esc(a)}</small></li>`).join("")}</ul>
</body></html>`
}
