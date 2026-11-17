"use client"

import { aqiCategory } from "@/lib/air-quality"
import type { MetricSource, RouteMetrics } from "@/lib/route-metrics"

type Props = { metrics: RouteMetrics }

const SOURCE_LABEL: Record<MetricSource, { tag: string; hint: string }> = {
  model: { tag: "ONNX model", hint: "Predicted by the trained ONNX models (synthetic training data)." },
  osrm: { tag: "OSRM free-flow", hint: "From the OSRM route: free-flow time, no traffic." },
  intel: { tag: "route intel", hint: "From the route-intelligence scoring layer." },
  estimate: { tag: "estimate", hint: "A formula or heuristic, not a measurement." },
  cams: { tag: "CAMS model", hint: "Ambient air quality from the Copernicus CAMS model via Open-Meteo. Regional background data; it does not react to simulated events." },
}

// AQI category color (US AQI)
function aqiColor(aqi: number): string {
  if (aqi <= 50) return "#22d3ee"
  if (aqi <= 100) return "#facc15"
  return "#f43f5e"
}
function congColor(c: number): string {
  if (c < 0.4) return "#22d3ee"
  if (c < 0.65) return "#facc15"
  return "#f43f5e"
}
function delayColor(minutes: number): string {
  if (minutes < 3) return "#22d3ee"
  if (minutes < 10) return "#facc15"
  return "#f43f5e"
}

type Card = { label: string; value: string; unit: string; color: string; source: MetricSource; note?: string }

export function MetricsDashboard({ metrics }: Props) {
  const cards: Card[] = [
    { label: "Avg speed", value: `${metrics.avgSpeedKmh}`, unit: "km/h", color: "#67e8f9", source: metrics.sources.speed },
    {
      label: "Congestion",
      value: `${Math.round(metrics.congestionIndex * 100)}`,
      unit: "%",
      color: congColor(metrics.congestionIndex),
      source: metrics.sources.congestion,
    },
    { label: "Avg arrival", value: `${metrics.avgArrivalMin}`, unit: "min", color: "#67e8f9", source: metrics.sources.arrival },
    metrics.eventDelayMin === null
      ? { label: "Event delay", value: "—", unit: "no event", color: "#67e8f9", source: metrics.sources.delay }
      : {
          label: "Event delay",
          value: `${metrics.eventDelayMin > 0 ? "+" : ""}${metrics.eventDelayMin}`,
          unit: "min",
          color: delayColor(metrics.eventDelayMin),
          source: metrics.sources.delay,
        },
    metrics.aqi === null
      ? { label: "Air quality", value: "—", unit: "no data", color: "#67e8f9", source: metrics.sources.aqi }
      : {
          label: "Air quality",
          value: `${metrics.aqi}`,
          unit: "AQI",
          color: aqiColor(metrics.aqi),
          source: metrics.sources.aqi,
          note: aqiCategory(metrics.aqi),
        },
    {
      label: "Incidents",
      value: `${metrics.activeIncidents}`,
      unit: "active",
      color: metrics.activeIncidents ? "#f43f5e" : "#67e8f9",
      source: metrics.sources.incidents,
    },
    { label: "CO2", value: `${metrics.co2Kg}`, unit: "kg", color: "#67e8f9", source: metrics.sources.co2 },
    { label: "Fuel", value: `${metrics.fuelL}`, unit: "L", color: "#67e8f9", source: metrics.sources.fuel },
  ]

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-mono text-xs uppercase tracking-widest text-primary">Route metrics</h2>
      <div className="grid grid-cols-2 gap-2">
        {cards.map((c) => {
          const source = SOURCE_LABEL[c.source]
          return (
            <div key={c.label} className="rounded-lg border border-border bg-card p-2.5" title={source.hint}>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{c.label}</p>
              <p className="mt-1 flex items-baseline gap-1 font-mono">
                <span className="text-lg font-semibold" style={{ color: c.color }}>
                  {c.value}
                </span>
                <span className="text-[10px] text-muted-foreground">{c.unit}</span>
              </p>
              {c.note && <p className="font-mono text-[9px] text-muted-foreground">{c.note}</p>}
              <p
                className={`mt-0.5 font-mono text-[8px] uppercase tracking-wider ${
                  c.source === "model" ? "text-amber-300/80" : "text-muted-foreground/70"
                }`}
              >
                {source.tag}
              </p>
            </div>
          )
        })}
      </div>
      <p className="font-mono text-[9px] leading-relaxed text-muted-foreground">
        For the selected route. Speed, congestion, arrival and delay come from the ONNX models once an event is simulated;
        otherwise from OSRM. CO₂ and fuel are estimates (0.21 kg/km and 0.08 L/km, raised by congestion). Air quality: Copernicus
        CAMS via Open-Meteo, ambient background data.
      </p>
    </section>
  )
}
