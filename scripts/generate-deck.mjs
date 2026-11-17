// Generates a professional RouteCast capstone deck as a .pptx file.
// Run: node scripts/generate-deck.mjs  ->  public/RouteCast-Capstone-Deck.pptx
import pptxgen from "pptxgenjs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dirname, "..", "public", "RouteCast-Capstone-Deck.pptx")

// ---- Theme ----------------------------------------------------------------
const BG = "0A1420" // deep navy
const PANEL = "0F1D2E" // card
const CYAN = "22D3EE" // primary accent
const CYAN_DK = "0E7490"
const TEXT = "E6F1F5" // near-white
const MUTED = "7C93A3" // muted slate
const LINE = "1E3345"

const FONT = "Arial"
const MONO = "Consolas"

const pptx = new pptxgen()
pptx.defineLayout({ name: "WIDE", width: 13.333, height: 7.5 })
pptx.layout = "WIDE"
pptx.author = "RouteCast"
pptx.company = "Capstone Project"
pptx.title = "RouteCast — AI Digital Twin of Guntur for Event Traffic"

const W = 13.333
const H = 7.5

// ---- Helpers --------------------------------------------------------------
function base(slide) {
  slide.background = { color: BG }
  // top accent bar
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.08, fill: { color: CYAN } })
}

function kicker(slide, text, num) {
  slide.addText(text.toUpperCase(), {
    x: 0.6,
    y: 0.5,
    w: 9,
    h: 0.4,
    fontFace: MONO,
    fontSize: 12,
    color: CYAN,
    charSpacing: 2,
    bold: true,
  })
  if (num) {
    slide.addText(num, {
      x: W - 1.6,
      y: 0.45,
      w: 1,
      h: 0.4,
      align: "right",
      fontFace: MONO,
      fontSize: 12,
      color: MUTED,
    })
  }
}

function title(slide, text) {
  slide.addText(text, {
    x: 0.6,
    y: 0.95,
    w: 12.1,
    h: 0.9,
    fontFace: FONT,
    fontSize: 30,
    color: TEXT,
    bold: true,
  })
}

// bullet list block
function bullets(slide, items, opts = {}) {
  const x = opts.x ?? 0.7
  const y = opts.y ?? 2.1
  const w = opts.w ?? 11.9
  const h = opts.h ?? 4.8
  const fontSize = opts.fontSize ?? 16
  slide.addText(
    items.map((t) => ({
      text: t,
      options: {
        bullet: { characterCode: "25AA", indent: 18 },
        color: TEXT,
        fontSize,
        fontFace: FONT,
        paraSpaceAfter: 10,
      },
    })),
    { x, y, w, h, valign: "top" },
  )
}

// a rounded card with heading + lines
function card(slide, x, y, w, h, heading, lines, accent = CYAN) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x,
    y,
    w,
    h,
    rectRadius: 0.08,
    fill: { color: PANEL },
    line: { color: LINE, width: 1 },
  })
  slide.addShape(pptx.ShapeType.rect, { x, y, w: 0.06, h, fill: { color: accent } })
  slide.addText(heading, {
    x: x + 0.2,
    y: y + 0.12,
    w: w - 0.35,
    h: 0.45,
    fontFace: MONO,
    fontSize: 13,
    color: accent,
    bold: true,
  })
  slide.addText(
    lines.map((t) => ({
      text: t,
      options: { color: TEXT, fontSize: 12, fontFace: FONT, paraSpaceAfter: 5, breakLine: true },
    })),
    { x: x + 0.2, y: y + 0.62, w: w - 0.4, h: h - 0.75, valign: "top" },
  )
}

// ---- Slide 1: Title -------------------------------------------------------
{
  const s = pptx.addSlide()
  s.background = { color: BG }
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.08, fill: { color: CYAN } })
  s.addShape(pptx.ShapeType.rect, { x: 0, y: H - 0.08, w: W, h: 0.08, fill: { color: CYAN } })
  s.addText("ROUTECAST", { x: 0.6, y: 2.35, w: 12, h: 1.2, fontFace: FONT, fontSize: 60, color: TEXT, bold: true, charSpacing: 2 })
  s.addText("AI Digital Twin of Guntur City for Event Traffic", { x: 0.65, y: 3.55, w: 12, h: 0.6, fontFace: FONT, fontSize: 22, color: CYAN })
  s.addText("Schedule an event on the map and predict how it slows the roads around it.", {
    x: 0.65, y: 4.2, w: 12, h: 0.5, fontFace: FONT, fontSize: 15, color: MUTED,
  })
  s.addText("Next.js  •  React  •  TypeScript  •  Leaflet  •  PyTorch  →  ONNX  •  OpenStreetMap", {
    x: 0.65, y: 5.5, w: 12, h: 0.4, fontFace: MONO, fontSize: 13, color: MUTED,
  })
  s.addText("Capstone Project  |  Name • College • Guide", { x: 0.65, y: 6.4, w: 12, h: 0.4, fontFace: MONO, fontSize: 12, color: MUTED })
}

// ---- Slide 2: Overview ----------------------------------------------------
{
  const s = pptx.addSlide()
  base(s)
  kicker(s, "Introduction", "02 / 15")
  title(s, "What is RouteCast?")
  bullets(s, [
    "Navigation apps optimize one trip and react to traffic after it forms. RouteCast looks ahead: it simulates the traffic an event will create before it happens.",
    "Place an event on a map of Guntur, set its type, time window and attendance, and get predicted delays for the routes people would take.",
    "Two trained neural networks (ONNX) predict travel time and congestion level. If a model cannot run, the app falls back to a heuristic and says so on screen.",
    "Up to three events can be simulated together to see how overlapping events add up.",
    "Two modes: Event (simulate impact) and Directions (point-to-point routes scored with weather, incidents and closures).",
  ], { y: 2.0 })
}

// ---- Slide 3: Problem -----------------------------------------------------
{
  const s = pptx.addSlide()
  base(s)
  kicker(s, "Problem Statement", "03 / 15")
  title(s, "The Gap in Existing Tools")
  card(s, 0.7, 2.1, 5.9, 2.3, "TODAY'S TOOLS", [
    "Show traffic that already exists",
    "Cannot answer \"what happens on the evening of the event?\"",
    "Do not treat a venue as a source of demand",
    "No quick way to test a time slot or closure",
  ], MUTED)
  card(s, 6.75, 2.1, 5.9, 2.3, "WHAT'S NEEDED", [
    "Predict an event's effect on nearby roads",
    "Compare each route with and without the event",
    "Test attendance, timing and road closures in advance",
    "Show where every number came from",
  ], CYAN)
  s.addText(
    "Core question: If this event happens here, at this time, with this many people — which roads slow down, by how much, and what should travelers and responders do?",
    { x: 0.7, y: 4.8, w: 11.9, h: 0.9, fontFace: FONT, fontSize: 16, color: TEXT, italic: true },
  )
}

// ---- Slide 4: Objectives --------------------------------------------------
{
  const s = pptx.addSlide()
  base(s)
  kicker(s, "Objectives", "04 / 15")
  title(s, "Project Objectives")
  const objs = [
    ["01", "Simulate an event's attendance, type and time window against normal traffic at the same hour."],
    ["02", "Predict per-route travel time and congestion class with trained ONNX models."],
    ["03", "Rank routes by predicted event-time ETA and recommend the least affected one."],
    ["04", "Visualize impact zones, per-road congestion and reachable area on a real map."],
    ["05", "Check emergency access and road-closure impact near the venue."],
    ["06", "Label every result: model or heuristic, measured or estimated."],
  ]
  objs.forEach((o, i) => {
    card(s, 0.7 + (i % 2) * 6.05, 2.1 + Math.floor(i / 2) * 1.5, 5.9, 1.3, o[0], [o[1]], CYAN)
  })
}

// ---- Slide 5: Proposed Solution -------------------------------------------
{
  const s = pptx.addSlide()
  base(s)
  kicker(s, "Proposed Solution", "05 / 15")
  title(s, "How RouteCast Works")
  const steps = [
    ["Place", "Pick a route on the Guntur map, then place an event: type, time window, attendance."],
    ["Build inputs", "One module rebuilds the exact feature formulas used in training: baseline and with-event."],
    ["Predict", "The same ONNX models predict ETA and congestion class for both scenarios. Delay = difference."],
    ["Advise", "Rank routes, show the heatmap and impact zone, re-run at any hour with the time slider."],
  ]
  steps.forEach((st, i) => {
    const x = 0.7 + i * 3.05
    card(s, x, 2.3, 2.85, 3.0, st[0].toUpperCase(), [st[1]], CYAN)
    if (i < 3) s.addText("→", { x: x + 2.82, y: 3.5, w: 0.35, h: 0.6, align: "center", fontFace: FONT, fontSize: 24, color: CYAN, bold: true })
  })
  s.addText("If a model file cannot be loaded, the result falls back to a heuristic and is labelled as one.", {
    x: 0.7, y: 5.7, w: 11.9, h: 0.5, fontFace: MONO, fontSize: 12, color: MUTED, italic: true,
  })
}

// ---- Slide 6: Architecture ------------------------------------------------
{
  const s = pptx.addSlide()
  base(s)
  kicker(s, "System Architecture", "06 / 15")
  title(s, "Architecture Blueprint")
  card(s, 0.7, 2.05, 3.85, 4.6, "FRONTEND", [
    "Next.js 16 App Router",
    "React 19 + TypeScript",
    "Tailwind CSS v4",
    "Leaflet map",
    "SWR (fetch / cache)",
  ], CYAN)
  card(s, 4.75, 2.05, 3.85, 4.6, "BACKEND / LOGIC", [
    "Route handlers: /api/event/simulate,",
    "  heatmap, isochrone, emergency,",
    "  intelligence, navigation, geocode",
    "lib/event-model-inputs: feature builder",
    "lib/ml: ONNX inference",
    "lib/guntur-graph: road-graph engine",
  ], CYAN)
  card(s, 8.8, 2.05, 3.85, 4.6, "ML + EXTERNAL", [
    "PyTorch (offline training) → ONNX",
    "onnxruntime-node (serving)",
    "OSRM routing",
    "OpenStreetMap / Overpass roads",
    "Nominatim geocoding",
    "Open-Meteo weather + CAMS air quality",
  ], CYAN)
}

// ---- Slide 7: Block Diagram / Data Flow -----------------------------------
{
  const s = pptx.addSlide()
  base(s)
  kicker(s, "Block Diagram", "07 / 15")
  title(s, "End-to-End Data Flow")
  const flow = [
    "Pick route A → B\nreal roads via OSRM",
    "Place event\nmap click or place search",
    "Set details\ntype • time window • attendance",
    "Build inputs\nbaseline vs with-event features",
    "ONNX predict\nETA + congestion class",
    "Compare + render\ndelay • ranking • heatmap • metrics",
  ]
  flow.forEach((f, i) => {
    const col = i % 3
    const row = Math.floor(i / 3)
    const x = 0.7 + col * 4.1
    const y = 2.3 + row * 2.0
    const [head, sub] = f.split("\n")
    s.addShape(pptx.ShapeType.roundRect, { x, y, w: 3.7, h: 1.5, rectRadius: 0.08, fill: { color: PANEL }, line: { color: CYAN, width: 1 } })
    s.addText(
      [
        { text: head + "\n", options: { color: CYAN, fontSize: 13, bold: true, fontFace: MONO } },
        { text: sub, options: { color: TEXT, fontSize: 11, fontFace: FONT } },
      ],
      { x: x + 0.15, y: y + 0.15, w: 3.4, h: 1.2, valign: "middle", align: "center" },
    )
    if (col < 2) s.addText("→", { x: x + 3.7, y: y + 0.5, w: 0.4, h: 0.5, align: "center", fontSize: 22, color: CYAN, bold: true })
  })
  s.addText("↓", { x: 4.55, y: 3.85, w: 0.4, h: 0.5, align: "center", fontSize: 22, color: CYAN, bold: true })
  s.addText("The Traffic Time slider re-runs the prediction for any hour of the day.", {
    x: 0.7, y: 6.4, w: 11.9, h: 0.4, fontFace: MONO, fontSize: 12, color: MUTED, italic: true,
  })
}

// ---- Slide 8: Tech Stack --------------------------------------------------
{
  const s = pptx.addSlide()
  base(s)
  kicker(s, "Technology Stack", "08 / 15")
  title(s, "Software & Tools")
  card(s, 0.7, 2.05, 3.85, 4.6, "FRONTEND", [
    "Next.js 16",
    "React 19",
    "TypeScript",
    "Tailwind CSS v4",
    "Leaflet / react-leaflet",
    "SWR • lucide-react",
  ])
  card(s, 4.75, 2.05, 3.85, 4.6, "BACKEND & ML", [
    "Next.js route handlers",
    "PyTorch (training)",
    "NumPy (data generation)",
    "ONNX export",
    "onnxruntime-node (serving)",
    "No database",
  ])
  card(s, 8.8, 2.05, 3.85, 4.6, "DATA & QUALITY", [
    "OSRM • Overpass • Nominatim",
    "Open-Meteo • Copernicus CAMS",
    "OSM-derived Guntur road graph",
    "Vitest unit tests",
    "Git / GitHub",
    "Vercel (hosting)",
  ])
}

// ---- Slide 9: Features ----------------------------------------------------
{
  const s = pptx.addSlide()
  base(s)
  kicker(s, "Key Features", "09 / 15")
  title(s, "What It Does")
  const feats = [
    ["Event scheduler", "Up to three events with type, time window and attendance, scored together."],
    ["Traffic time slider", "An event loads the roads only while it runs, peaking at its midpoint."],
    ["Impact dashboard + heatmap", "Per-route baseline vs event ETA and a per-road congestion heatmap."],
    ["Reachability, emergency, closures", "Isochrone view, emergency route check and what-if road closures."],
    ["Organizer plan", "Staggered arrival waves, diversions and marshalling points, tested on the Guntur graph."],
    ["Directions + route intelligence", "Point-to-point routes scored with weather, incidents and closures."],
  ]
  feats.forEach((f, i) => {
    card(s, 0.7 + (i % 2) * 6.05, 2.05 + Math.floor(i / 2) * 1.55, 5.9, 1.35, f[0].toUpperCase(), [f[1]], CYAN)
  })
}

// ---- Slide 10: Workflow ---------------------------------------------------
{
  const s = pptx.addSlide()
  base(s)
  kicker(s, "System Workflow", "10 / 15")
  title(s, "Request Lifecycle")
  bullets(s, [
    "The user places an event and presses Simulate Traffic Impact; the browser posts the events and routes to /api/event/simulate.",
    "For each route the server builds model inputs twice: normal traffic at the evaluated hour, and the same hour with the event's proximity, severity and load.",
    "Both are scored by the ETA and congestion ONNX models. Delay is the difference, so the same model explains both sides.",
    "Routes no event reaches stay exactly at baseline. Routes are ranked by event-time ETA.",
    "The heatmap routes event vehicles over the real Guntur road graph and applies BPR travel times.",
    "The response carries its source (model or heuristic) and a note listing approximated inputs.",
    "Dragging the time slider re-runs the same pipeline for the chosen hour.",
  ], { y: 2.0, fontSize: 15 })
}

// ---- Slide 11: Method -----------------------------------------------------
{
  const s = pptx.addSlide()
  base(s)
  kicker(s, "Implementation", "11 / 15")
  title(s, "How the Simulation Works")
  card(s, 0.7, 2.05, 5.9, 4.4, "MODULES", [
    "lib/event-model-inputs — training-compatible features, event phase, multi-event",
    "lib/ml — ONNX sessions and decoding",
    "lib/guntur-graph — directed OSM road graph, zone demand routing, BPR",
    "lib/route-metrics — per-route metrics with source tags",
    "ml/ — schema, data generator, PyTorch training",
  ])
  s.addShape(pptx.ShapeType.roundRect, { x: 6.75, y: 2.05, w: 5.9, h: 4.4, rectRadius: 0.08, fill: { color: PANEL }, line: { color: LINE, width: 1 } })
  s.addText("CONGESTION WITH EVENTS", { x: 6.95, y: 2.2, w: 5.5, h: 0.4, fontFace: MONO, fontSize: 13, color: CYAN, bold: true })
  s.addText(
    "c = base(hour, day)\n  + Σ boost(type) · reach(distance) · phase(time)\n\nreach: 1 at the venue, 0 at the impact radius\n(200 m + 5.8 m·√attendance, capped 1.5 km)\nphase: 0 outside the window, 1 at midpoint\n\nA route no event reaches stays at baseline.\nBPR: t = t0 · (1 + 0.15 · (v/c)^4)",
    { x: 6.95, y: 2.65, w: 5.5, h: 3.6, fontFace: MONO, fontSize: 12, color: TEXT, valign: "top", lineSpacingMultiple: 1.1 },
  )
}

// ---- Slide 12: ML / Deep Learning -----------------------------------------
{
  const s = pptx.addSlide()
  base(s)
  kicker(s, "ML / Deep Learning", "12 / 15")
  title(s, "The Model Engine")
  card(s, 0.7, 2.05, 5.9, 4.4, "ARCHITECTURE", [
    "Two feed-forward networks, 9 inputs each",
    "9 → 256 → 256 → 128 → 64 → output",
    "BatchNorm • ReLU • Dropout 0.10–0.15",
    "AdamW • LR halves on plateau • early stopping",
    "ETA: SmoothL1 loss on log(future / current time)",
    "Congestion: 5 classes, cross-entropy (smoothing 0.1)",
    "Exported to ONNX (opset 18), served via onnxruntime-node",
  ])
  card(s, 6.75, 2.05, 5.9, 2.5, "HELD-OUT RESULTS (30,000 SAMPLES)", [
    "ETA  R² 0.94  •  within 20%: 92%",
    "Congestion  accuracy 80%  •  macro-F1 0.81",
    "Within one class: ~100%",
  ])
  card(s, 6.75, 4.7, 5.9, 1.75, "READ CAREFULLY", [
    "Synthetic data from our own generator, not real Guntur traffic. The models learned the simulator: a proof of concept to calibrate with observed counts.",
  ], "F59E0B")
}

// ---- Slide 13: Reliability & honesty --------------------------------------
{
  const s = pptx.addSlide()
  base(s)
  kicker(s, "Reliability & Honesty", "13 / 15")
  title(s, "Every Number Says Where It Came From")
  card(s, 0.7, 2.05, 3.85, 4.6, "PROVENANCE", [
    "Badged \"ONNX model\" only if every prediction came from a model",
    "Metrics carry a source tag; CO₂ and fuel are marked estimates",
    "Approximated inputs are listed in the response",
    "Multi-event is flagged as an extrapolation",
  ], CYAN)
  card(s, 4.75, 2.05, 3.85, 4.6, "WORKS WHEN SERVICES FAIL", [
    "Routing: retry, then the local Guntur road graph",
    "Geocoding: local Guntur landmark list",
    "Nearby places: Overpass → Nominatim → landmarks",
    "Heatmap: computed locally from the road graph",
    "Weather / air quality: labelled unavailable",
  ], CYAN)
  card(s, 8.8, 2.05, 3.85, 4.6, "TESTED", [
    "Vitest unit tests for feature encoders and decoders",
    "Event-input builder with reference values from the training code",
    "Road-graph routing and BPR tests",
    "Fallback and retry logic tests",
  ], CYAN)
}

// ---- Slide 14: Evaluation -------------------------------------------------
{
  const s = pptx.addSlide()
  base(s)
  kicker(s, "Evaluation", "14 / 15")
  title(s, "Advantages · Limitations · Future")
  card(s, 0.7, 2.05, 3.85, 4.6, "ADVANTAGES", [
    "Predicts event impact with trained models",
    "Baseline and event use the same model",
    "Real Guntur roads, offline-capable",
    "Handles several events and any hour",
    "Honest labels on every result",
    "Unit-tested core",
  ], CYAN)
  card(s, 4.75, 2.05, 3.85, 4.6, "LIMITATIONS", [
    "Models trained on synthetic data",
    "Current congestion and capacity approximated for OSRM routes",
    "Trained on single events",
    "Directions scoring is heuristic",
    "Forecast curve is parametric",
    "No database, auth or live traffic",
  ], "F59E0B")
  card(s, 8.8, 2.05, 3.85, 4.6, "FUTURE SCOPE", [
    "Calibrate with observed Guntur counts",
    "Live traffic API for real congestion",
    "Compare plans side by side; export for marshals",
    "Explain each prediction (feature drivers)",
    "Persistence, accounts, alerts",
  ], CYAN)
}

// ---- Slide 15: Conclusion -------------------------------------------------
{
  const s = pptx.addSlide()
  s.background = { color: BG }
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.08, fill: { color: CYAN } })
  s.addShape(pptx.ShapeType.rect, { x: 0, y: H - 0.08, w: W, h: 0.08, fill: { color: CYAN } })
  s.addText("Conclusion", { x: 0.6, y: 2.2, w: 12, h: 0.9, fontFace: FONT, fontSize: 36, color: TEXT, bold: true })
  s.addText(
    "RouteCast turns a scheduled event into a predicted, explainable traffic impact on real Guntur roads — with trained models, a transparent method, and honest labels on every number.",
    { x: 0.65, y: 3.2, w: 11.5, h: 1.4, fontFace: FONT, fontSize: 18, color: TEXT, lineSpacingMultiple: 1.2 },
  )
  s.addText("Thank you  —  Questions?", { x: 0.65, y: 5.2, w: 12, h: 0.6, fontFace: MONO, fontSize: 20, color: CYAN, bold: true })
}

await pptx.writeFile({ fileName: OUT })
console.log("[deck] written to", OUT)
