"use client"

import type { ForecastPoint } from "@/lib/types"

type Props = { forecast: ForecastPoint[]; source?: "model" | "heuristic" }

function barColor(c: number): string {
  if (c < 0.4) return "#22d3ee"
  if (c < 0.65) return "#facc15"
  return "#f43f5e"
}

// Dataset 2 prediction horizons in minutes
const HORIZON_MINUTES = [5, 10, 15, 30, 45, 60]

export function ForecastStrip({ forecast, source = "heuristic" }: Props) {
  const isModel = source === "model"
  const max = Math.max(0.6, ...forecast.map((f) => f.congestion))
  const trend =
    forecast.length >= 2 ? forecast[forecast.length - 1].congestion - forecast[0].congestion : 0

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2">
          <h2 className="font-mono text-xs uppercase tracking-widest text-primary">Traffic forecast</h2>
          <span
            className="flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[8px] uppercase tracking-wider"
            style={{
              borderColor: isModel ? "#10b981" : "var(--color-border)",
              backgroundColor: isModel ? "rgba(16, 185, 129, 0.12)" : "transparent",
              color: isModel ? "#10b981" : "var(--color-muted-foreground)",
            }}
          >
            {isModel && <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />}
            {isModel ? "ONNX Active" : "Heuristic"}
          </span>
        </span>
        <span
          className="font-mono text-[10px] uppercase tracking-wider"
          style={{ color: trend > 0.02 ? "#f43f5e" : trend < -0.02 ? "#22d3ee" : "var(--color-muted-foreground)" }}
        >
          {trend > 0.02 ? "Surging" : trend < -0.02 ? "Clearing" : "Stable"}
        </span>
      </div>

      <div className="flex items-end gap-1.5" style={{ height: 76 }}>
        {forecast.map((f, idx) => {
          const horizonLabel = HORIZON_MINUTES[idx] ?? HORIZON_MINUTES[f.step - 1] ?? (f.step * 10)
          const pct = Math.round(f.congestion * 100)
          return (
            <div key={f.step} className="group relative flex h-full flex-1 flex-col items-center gap-1">
              <span className="font-mono text-[8px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                {pct}%
              </span>
              <div className="relative w-full flex-1">
                <div
                  className="absolute bottom-0 w-full rounded-sm transition-all shadow-sm"
                  style={{
                    height: `${Math.max(6, (f.congestion / max) * 100)}%`,
                    backgroundColor: barColor(f.congestion),
                    opacity: 0.9,
                  }}
                  title={`Horizon: +${horizonLabel}m | Congestion: ${pct}%`}
                />
              </div>
              <span className="font-mono text-[9px] text-muted-foreground">+{horizonLabel}m</span>
            </div>
          )
        })}
      </div>

      <p className="text-[10px] text-muted-foreground text-pretty">
        {isModel
          ? `Multi-horizon AI forecast trained on Dataset 2 (SUMO Guntur digital twin) predicting traffic states up to 60 minutes ahead.`
          : `Heuristic projection of city congestion. Trained models in /models will automatically upgrade this to AI multi-horizon forecasting.`}
      </p>
    </section>
  )
}
