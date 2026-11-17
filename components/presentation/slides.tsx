import type { ReactNode } from "react"

export type Slide = {
  id: string
  kicker: string
  title: string
  body: ReactNode
}

function Bullet({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary shadow-[0_0_8px_var(--color-primary)]" />
      <span className="text-pretty leading-relaxed">{children}</span>
    </li>
  )
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card/50 p-5">
      <h3 className="mb-2 font-mono text-xs uppercase tracking-widest text-primary">{title}</h3>
      <div className="text-sm leading-relaxed text-muted-foreground">{children}</div>
    </div>
  )
}

// A lightweight flow box used to draw the block / architecture diagrams.
function Node({ label, sub, accent }: { label: string; sub?: string; accent?: boolean }) {
  return (
    <div
      className={`flex min-w-[8rem] flex-col items-center gap-0.5 rounded-lg border px-4 py-3 text-center ${
        accent ? "border-primary bg-primary/10" : "border-border bg-card"
      }`}
    >
      <span className={`font-mono text-xs uppercase tracking-wider ${accent ? "text-primary" : "text-foreground"}`}>
        {label}
      </span>
      {sub && <span className="text-[10px] text-muted-foreground">{sub}</span>}
    </div>
  )
}

function Arrow() {
  return <span className="font-mono text-primary">{"->"}</span>
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3 text-center">
      <p className="font-mono text-2xl font-semibold text-primary">{value}</p>
      <p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
    </div>
  )
}

export const slides: Slide[] = [
  // 1 — Title
  {
    id: "title",
    kicker: "Capstone Project",
    title: "RouteCast",
    body: (
      <div className="flex flex-col gap-6">
        <p className="max-w-2xl text-balance text-lg leading-relaxed text-muted-foreground">
          An AI-powered digital twin of Guntur City for event traffic. Schedule an event on the map and RouteCast
          predicts how it loads the surrounding roads, how much each route slows down, and which route to take.
        </p>
        <div className="flex flex-wrap gap-2 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          <span className="rounded-full border border-primary/50 px-3 py-1 text-primary">Full-Stack</span>
          <span className="rounded-full border border-border px-3 py-1">Deep Learning (ONNX)</span>
          <span className="rounded-full border border-border px-3 py-1">Geospatial</span>
          <span className="rounded-full border border-border px-3 py-1">Traffic Simulation</span>
        </div>
      </div>
    ),
  },

  // 2 — Introduction
  {
    id: "introduction",
    kicker: "01 — Introduction",
    title: "What is RouteCast?",
    body: (
      <div className="grid gap-8 md:grid-cols-2">
        <ul className="flex flex-col gap-4 text-sm text-muted-foreground">
          <Bullet>
            Navigation apps optimize a route for <em>one</em> trip and react to traffic after it forms. RouteCast looks
            ahead: it simulates the traffic an event will create before the event happens.
          </Bullet>
          <Bullet>
            You place an event on a map of Guntur, set its type, time window and expected attendance, and get predicted
            delays for the routes people would take.
          </Bullet>
          <Bullet>
            Two trained neural networks (ONNX) predict travel time and congestion level. Where a model cannot run, the
            app falls back to a heuristic and says so on screen.
          </Bullet>
          <Bullet>Up to three events can be simulated together to see how overlapping events add up.</Bullet>
        </ul>
        <div className="flex flex-col gap-3">
          <Card title="Two Modes">
            <span className="text-foreground">Event mode</span> — simulate scheduled events and their route impact.
            <br />
            <span className="text-foreground">Directions mode</span> — point-to-point routes scored with weather,
            incidents and closures.
          </Card>
          <Card title="On the Map">
            Real routes from OpenStreetMap, per-road congestion heatmap, reachable-area (isochrone) view, emergency
            access route, and a what-if road-closure test.
          </Card>
        </div>
      </div>
    ),
  },

  // 3 — Problem statement
  {
    id: "problem",
    kicker: "02 — Problem Statement",
    title: "The Problem",
    body: (
      <div className="grid gap-8 md:grid-cols-2">
        <ul className="flex flex-col gap-4 text-sm text-muted-foreground">
          <Bullet>
            When a festival, match or rally is scheduled, thousands of people travel to one place at the same time,
            overloading specific roads around the venue.
          </Bullet>
          <Bullet>
            Existing tools show traffic that already exists. They cannot answer &quot;what will happen on the evening of
            the event?&quot; and they do not model the venue as a source of demand.
          </Bullet>
          <Bullet>
            Organizers and traffic planners have no quick way to test a time slot, an attendance level or a road closure
            before committing to a plan.
          </Bullet>
        </ul>
        <Card title="Core Question">
          <p className="text-base text-foreground text-pretty">
            &quot;If this event happens here, at this time, with this many people — which roads slow down, by how much,
            and what should travelers and responders do?&quot;
          </p>
        </Card>
      </div>
    ),
  },

  // 4 — Purpose / objectives
  {
    id: "purpose",
    kicker: "03 — Purpose & Objectives",
    title: "Purpose",
    body: (
      <div className="grid gap-4 md:grid-cols-3">
        <Card title="Simulate">
          Model an event&apos;s attendance, type and time window, and measure its effect against normal traffic at the
          same hour.
        </Card>
        <Card title="Predict">
          Use trained neural networks to forecast per-route travel time and congestion class, before and during the
          event.
        </Card>
        <Card title="Advise">
          Rank routes by predicted event-time ETA and recommend the least affected one, or test a road closure.
        </Card>
        <Card title="Visualize">
          Show impact zones, per-road congestion, reachable area and route colouring on a real map of Guntur.
        </Card>
        <Card title="Prepare">
          Check emergency-vehicle access through the impact zone and see how a closure interacts with the event.
        </Card>
        <Card title="Stay honest">
          Every result is labelled: model or heuristic, measured or estimated. Nothing simulated is presented as a
          measurement.
        </Card>
      </div>
    ),
  },

  // 5 — Architecture blueprint
  {
    id: "architecture",
    kicker: "04 — Blueprint / Architecture",
    title: "System Architecture",
    body: (
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Node label="Browser" sub="React 19 + Leaflet" accent />
          <Arrow />
          <Node label="Next.js" sub="App Router" />
          <Arrow />
          <Node label="Route Handlers" sub="/api/event/simulate · heatmap · isochrone · emergency · intelligence" />
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Node label="Input Builder" sub="training-compatible features" />
          <Arrow />
          <Node label="ONNX Runtime" sub="onnxruntime-node" accent />
          <Arrow />
          <Node label="ONNX Models" sub="ETA + congestion" />
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Node label="Routing" sub="OSRM" />
          <Node label="Road data" sub="OpenStreetMap / Overpass" />
          <Node label="Geocoding" sub="Nominatim" />
          <Node label="Weather & air" sub="Open-Meteo · CAMS" />
        </div>
        <p className="text-center text-xs text-muted-foreground">
          The browser only talks to API route handlers. Model inputs are built on the server by one module that mirrors
          the feature formulas used in training.
        </p>
      </div>
    ),
  },

  // 6 — Block diagram (data flow)
  {
    id: "block-diagram",
    kicker: "05 — Block Diagram",
    title: "Data Flow",
    body: (
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
          <Node label="Pick Route" sub="A → B, real roads" accent />
          <Arrow />
          <Node label="Place Event" sub="map click / place search" />
          <Arrow />
          <Node label="Set Details" sub="type · time · attendance" />
        </div>
        <div className="flex justify-center">
          <span className="font-mono text-primary">{"|"}</span>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
          <Node label="Build Inputs" sub="baseline vs with-event" />
          <Arrow />
          <Node label="ONNX Predict" sub="ETA + congestion class" accent />
          <Arrow />
          <Node label="Compare" sub="delay = event − baseline" />
        </div>
        <div className="flex justify-center">
          <span className="font-mono text-primary">{"|"}</span>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
          <Node label="Rank Routes" sub="least affected first" />
          <Arrow />
          <Node label="Render" sub="table · heatmap · zones · metrics" accent />
          <Arrow />
          <Node label="Time Slider" sub="re-run at any hour" />
        </div>
      </div>
    ),
  },

  // 7 — Features
  {
    id: "features",
    kicker: "06 — Features",
    title: "Key Features",
    body: (
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Event Scheduler">
          Place up to three events, each with type, time window and attendance. Routes are scored against all of them
          together.
        </Card>
        <Card title="Traffic Time Slider">
          Drag through the day: an event only loads the roads while it is running, and builds to a peak at its midpoint.
        </Card>
        <Card title="Impact Dashboard & Heatmap">
          Per-route baseline vs event ETA, congestion class and delay, plus a per-road congestion heatmap around each
          venue.
        </Card>
        <Card title="Reachability & Emergency">
          Isochrone view of how far you can get in a set time, and an emergency route check through the impact zone.
        </Card>
        <Card title="Organizer Plan">
          Staggered arrival waves, diversion routes and marshalling points, tested on the real Guntur road graph with
          before-and-after numbers.
        </Card>
        <Card title="What-If Closures">
          Close a road segment and see whether it collides with the event&apos;s impact zone.
        </Card>
        <Card title="Directions with Route Intelligence">
          Point-to-point routes scored with weather, incidents and closures, shown with their data sources.
        </Card>
      </div>
    ),
  },

  // 8 — ML models
  {
    id: "ml",
    kicker: "07 — ML / Deep Learning",
    title: "The AI Models",
    body: (
      <div className="grid gap-8 md:grid-cols-2">
        <div className="flex flex-col gap-3">
          <Card title="Model Type">
            Multi-layer perceptrons trained in <span className="text-foreground">PyTorch</span>, exported to{" "}
            <span className="text-foreground">ONNX</span> and run in Node with{" "}
            <span className="text-foreground">onnxruntime</span>.
          </Card>
          <Card title="Two Heads">
            <span className="text-foreground">ETA model</span> — predicts how much a route&apos;s travel time grows.
            <br />
            <span className="text-foreground">Congestion model</span> — classifies free / light / moderate / heavy /
            severe.
          </Card>
          <Card title="9 Inputs Each">
            distance or capacity · current congestion · speed · hour (sin, cos) · event proximity · scenario severity ·
            event or incident load
          </Card>
        </div>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Stat value="0.94" label="ETA R²" />
            <Stat value="80%" label="Congestion accuracy" />
            <Stat value="0.81" label="Macro-F1" />
            <Stat value="~100%" label="Within one class" />
          </div>
          <Card title="Read these numbers carefully">
            Measured on held-out <span className="text-foreground">synthetic</span> data from our own generator, not on
            real Guntur traffic. They show the models learned the simulator, so this is a proof of concept to be
            calibrated with observed counts.
          </Card>
        </div>
      </div>
    ),
  },

  // 9 — Honesty / provenance
  {
    id: "integration",
    kicker: "08 — Reliability & Honesty",
    title: "Every Number Says Where It Came From",
    body: (
      <div className="flex flex-col gap-6">
        <div className="grid gap-4 md:grid-cols-3">
          <Card title="Model vs heuristic">
            A result is badged &quot;ONNX model&quot; only if every prediction for every route came from a model. If a
            model file fails to load, the app falls back to a heuristic and labels it.
          </Card>
          <Card title="Estimates are labelled">
            Route metrics carry a source tag: ONNX model, OSRM free-flow, route intel or estimate. CO₂ and fuel are
            marked as estimates.
          </Card>
          <Card title="Known approximations">
            Current congestion comes from the training data&apos;s hour-of-day profile and road capacity uses the
            training mean, because OSRM routes carry no road-level data. The response says so.
          </Card>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Card title="When services fail">
            Routing retries once, then uses the local Guntur road graph. Search falls back to a Guntur landmark list, and
            the heatmap is computed locally. Each fallback is labelled.
          </Card>
          <Card title="Single-event training">
            The models learned one event at a time. Combining several events is an extrapolation and is flagged as such.
          </Card>
          <Card title="Ambient air quality">
            Air quality comes from the Copernicus CAMS model via Open-Meteo. It is background data and deliberately does
            not react to simulated events.
          </Card>
        </div>
      </div>
    ),
  },

  // 10 — Software / tech stack
  {
    id: "stack",
    kicker: "09 — Software & Tools",
    title: "Technology Stack",
    body: (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card title="Frontend">Next.js 16 · React 19 · TypeScript · Tailwind CSS · SWR · Lucide</Card>
        <Card title="Mapping">Leaflet · React-Leaflet · Esri World Imagery · OpenStreetMap</Card>
        <Card title="Machine Learning">PyTorch · ONNX · onnxruntime-node · NumPy · synthetic dataset generator</Card>
        <Card title="Backend">Next.js Route Handlers · OSRM routing · Overpass road data</Card>
        <Card title="External data">Nominatim geocoding · Open-Meteo weather · Copernicus CAMS air quality</Card>
        <Card title="Quality">Vitest unit tests for the feature encoders, decoders and event-input builder · Git / GitHub</Card>
      </div>
    ),
  },

  // 11 — Simulation method
  {
    id: "algorithm",
    kicker: "10 — Core Method",
    title: "How the Simulation Works",
    body: (
      <div className="grid gap-8 md:grid-cols-2">
        <ul className="flex flex-col gap-4 text-sm text-muted-foreground">
          <Bullet>
            For each route, normal traffic at the chosen hour and day is the baseline (an hour-of-day profile with
            weekday adjustments).
          </Bullet>
          <Bullet>
            The event adds congestion that grows with the event type, falls off with the route&apos;s distance from the
            venue, and follows a bell curve over the event window.
          </Bullet>
          <Bullet>
            The ONNX models predict the route&apos;s ETA and congestion class for both scenarios. The delay is the
            difference, so the same model explains both sides of the comparison.
          </Bullet>
          <Bullet>
            A route that no event reaches stays exactly at baseline. Routes are ranked by predicted event-time ETA.
          </Bullet>
        </ul>
        <Card title="Congestion with events">
          <p className="font-mono text-sm text-foreground">
            c = base(hour, day) + Σ boost<sub>type</sub> · reach<sub>distance</sub> · phase<sub>time</sub>
          </p>
          <p className="mt-3 text-xs">
            Reach is 1 at the venue and falls to 0 at the impact radius, which grows with attendance (capped at 1.5
            km, the largest radius seen in training). Phase is 0 outside the event window and 1 at its midpoint.
          </p>
        </Card>
      </div>
    ),
  },

  // 12 — Limits, future scope + close
  {
    id: "future",
    kicker: "11 — Limits & Future Scope",
    title: "What's Next",
    body: (
      <div className="grid gap-8 md:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Card title="Current limits">
            Models are trained on synthetic data and not yet validated against observed Guntur traffic. Road-level inputs
            are approximated for OSRM routes.
          </Card>
          <ul className="flex flex-col gap-4 text-sm text-muted-foreground">
            <Bullet>Calibrate the models with observed Guntur traffic counts and the OpenStreetMap road graph.</Bullet>
            <Bullet>Integrate a live traffic API for real congestion in place of the hour-of-day profile.</Bullet>
            <Bullet>Compare plans side by side and export the organizer plan for marshals.</Bullet>
            <Bullet>Explain each prediction: which inputs drove a route&apos;s delay.</Bullet>
          </ul>
        </div>
        <div className="flex flex-col justify-center gap-3 rounded-xl border border-primary/40 bg-primary/5 p-6">
          <h3 className="font-mono text-xs uppercase tracking-widest text-primary">Summary</h3>
          <p className="text-pretty text-base leading-relaxed text-foreground">
            RouteCast turns a scheduled event into a predicted, explainable traffic impact on real Guntur roads — with
            trained models, a transparent method, and honest labels on every number.
          </p>
          <p className="font-mono text-sm text-primary">Thank you — Questions?</p>
        </div>
      </div>
    ),
  },
]
