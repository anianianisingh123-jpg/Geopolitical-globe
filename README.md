# SIGNAL // HEAT

A single-page geopolitical heat globe with an ops-center interface. 54 analyst-scored zones across kinetic, frozen, maritime, nuclear, sanctions, regime, resource and great-power drivers are rendered as extruded country polygons, sub-national footprints, ringed target markers, lanes and range rings. Beside the globe runs a live open-source news feed (GDELT) that tags headlines to zones. The scores are analyst composites. They are not probabilities.

## Run

Requires Node 20+.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # strict type-check (app + config), then static build to dist/
npm run preview    # serve dist/ locally
npm run geo        # rebuild public/geo (cities, towns, provinces); only needed to refresh the data
```

`npm run dev` and `npm run preview` include the local intel service (RSS desks, GDELT trends, NASA FIRMS). Run **one** of them at a time: two servers means two GDELT queues from the same IP, which invites rate limiting.

`dist/` is a static site with no API keys. On a plain static host (Netlify, Vercel, S3/CloudFront, GitHub Pages) the globe, scores, scenarios and a browser-side GDELT feed work, but the RSS desks, fires and RSS trends need the intel service. Host `server/intel.ts` as a small Node function to get those in production. For a sub-path deploy, set `base` in `vite.config.ts`.

`?view=table` skips the globe and shows the ranked table. Use it for accessibility, low-power devices, or to QA the WebGL fallback.

## Controls

| Input | Action |
| --- | --- |
| Drag / scroll / double-click | Rotate / zoom / reset view |
| Click open ground | Zoom in toward that point |
| Click a place label | Open its place card (what it is, headlines naming it, heat nearby) |
| `/` | Focus search (↑ ↓ Enter to pick) |
| `1`–`8` | Toggle driver layers (kinetic, frozen, maritime, nuclear, sanctions, regime, resource, great power) |
| `0` | Back to composite |
| Shift-click a layer | Solo it |
| `Esc` | Close the brief, place card or detail panel (or clear search) |
| `B` | Open the brief |
| Click a country or bloom | Open the detail panel; click again inside the selected zone to zoom in |
| Hover | Tooltip with name and score |

Zone score labels appear only when exactly one layer is soloed (top 14, decluttered by score) or when the Escalation scenario is on (every adjusted zone is labelled with its delta). Place labels are separate; see below.

## Zooming in: places, provinces, sites

The globe goes from whole-world view down to about 250 km above the ground. What is labelled depends on how close you are, and labels that would overlap are dropped, highest priority kept:

| Altitude (globe radii) | What appears |
| --- | --- |
| Any | Sites named in a live headline (gold badge = headline count), and the selected zone's sites |
| < 1.5 | Capitals, then cities of 5M+ and 1M+ |
| < 1.1 | Large fire clusters, with the nearest town ("23 FIRES · 6 km NE of Pokrovsk") |
| < 0.9 | Province borders and names, and towns load for the countries on screen |
| < 0.8 | Every named site in every zone |
| < 0.6 | Extruded countries flatten into a tint, so borders, towns and fire spikes read through; glow and city lights fade |
| < 0.4 → 0.07 | Cities of 100k+, then towns down to about 1,000 people |

- **Sites** (`src/data/sites.ts`): 312 named places inside the zones (front-line towns, crossings, ports, bases, nuclear and energy facilities, camps), plus every zone node. Each has a one-line note. **Notes are background context, not live status**: control and front lines change faster than the file. Town coordinates were checked against GeoNames with `node scripts/check-sites.mjs`.
- **Live mentions.** Headlines are matched against site names and spellings (for example "Kiev", "Al Fashir"). A named site lights up, is labelled at every zoom, and news pings land on it instead of on the zone centre.
- **Fire clusters.** FIRMS detections are grouped into clusters about 11 km across and named after the nearest town (towns load for the countries the largest clusters sit in).
- **Detail panel.** **⌖ ZOOM IN** flies to ground level for the zone. Under Signals, the largest fire clusters are listed by nearest town. **Places · where it is happening** ranks the zone's sites by headlines, then heat within 25 km. Click any row to fly there and open its card.
- **Cursor readout.** CUR shows country, province, and (close in) the distance and direction to the nearest town.
- **Toggle.** Overlays → **Places & sites**. Low-power render also halves the label budget.

**Data and cost.** `public/geo/cities.json` (13,305 cities: 50k+, capitals, provincial seats; 550 kB) loads once. Each country's towns (1,000+ people) and simplified province polygons live in `public/geo/c/<ISO numeric>.json` (Ukraine is 190 kB), fetched only when you zoom in over that country, at most 4 on screen and 10 kept in memory. Labels are a pooled DOM overlay updated at ~10 Hz while the camera moves, capped at 170 on screen (70 in low-power mode).

## The interface

Everything that moves on screen is driven by something real: the clock, the sun, your cursor, the camera, the news index, or an action you took. Nothing is simulated.

| Element | Where | Source |
| --- | --- | --- |
| Classification band | Top edge | Static label: `UNCLASSIFIED // OPEN SOURCE // ANALYST COMPOSITE`. Deliberately not agency branding. |
| World clocks | Top bar | UTC plus Washington, London, Moscow and Beijing, from your system clock. |
| Earth | Globe | A custom shader: land/water mask rasterised from Natural Earth 1:50m vectors (so coastlines stay sharp), navy water, slate land, and gold city lights on the night side only. |
| Day/night terminator | Globe, mini-map | Computed from the current UTC time (subsolar point to about ±1°), refreshed every 30 s. |
| Borders and graticule | Globe | Vector line layers: 1:50m coastlines and borders, 15° grid. |
| Glow | Globe | Bloom post-process on bright elements only (heat cores, city lights). The **Low-power render** toggle disables it. |
| Radar sweep | Globe | 8 s sweep, clipped to the globe disc. Toggle in Overlays. Off under low-power or reduced motion. |
| Bearing ring | Globe | Ring with tick marks that tracks the globe's on-screen size as you zoom. |
| Target lock | Globe | Selecting a zone draws corner brackets, a `TGT ZN-### · score` label, and a leader line to the panel. |
| CTR / CUR readouts | Globe, bottom-left | Camera centre and altitude; cursor lat/lng plus the country under it (or "open water"). |
| News pings | Globe | Gold rings on zones named in a headline from the last 3 hours. |
| Mini-map | Left rail | Equirectangular overview: land, night side, zone heat, and a camera reticle. Click to fly. |
| OSINT feed | Right rail | Live headlines (see below). |
| Event log | Right rail | Your actions (layer, weight, scenario, track, watch) and every feed fetch, UTC-stamped. |
| Watchlist | Above status line | Zones pinned from the panel (`＋ WATCH`), with live score and change since pinning. Saved in this browser. |
| Boot sequence | Globe, on load | Short initialisation readout, shown while the geodata and textures load. |

Zone codes (`ZN-001`…) follow dataset order and stay stable unless zones are reordered.

## Live intel: news, coverage trends, fires

`npm run dev` and `npm run preview` also run a small **local intel service** (`server/intel.ts`, mounted as a Vite plugin). It exists because publishers' RSS feeds and NASA's fire file don't allow browser (cross-origin) requests, and GDELT rate-limits per IP address. One process holds one polite queue for every open tab, caches to disk (in your OS temp folder, outside the project), and goes quiet 10 minutes after the last tab stops asking.

| Endpoint | What | Refresh |
| --- | --- | --- |
| `/api/intel/news` | 13 world-news RSS desks (BBC, Al Jazeera, Guardian, DW, NPR, France 24, UN News, Defense News, CNBC, Sky, The Diplomat, RFI, Global News) plus 7 GDELT query bands, merged and de-duplicated | RSS every 5 min; each GDELT band every 15 min |
| `/api/intel/trends` | Coverage per zone (see below) | GDELT: one zone at a time, ≥12 s apart, each refreshed every 6 h; the selected zone jumps the queue |
| `/api/intel/fires` | NASA FIRMS VIIRS (S-NPP, 375 m) thermal detections from the last 24 h, filtered to kinetic zones | hourly |
| `/api/intel/events` | GDELT 2.0 event stream: violent events geolocated inside zones, last 24 h, grouped by place | new 15-min file checked every 5 min; a cold start backfills 24 h (~96 small files, newest first, about a minute) |

**News feed**
- The feed opens on **Geopolitical**: headlines that name a zone, came from a GDELT geopolitical query, or use conflict and statecraft vocabulary. **All** shows every desk headline, **Tagged** only zone-tagged ones, and the zone button (when a zone is selected) only that zone's headlines.
- Zone tags come from `src/data/newsTerms.ts`, matched as whole words in the headline only. Tags filter the feed, list headlines in the panel, and ping the globe. **They never change a score.**
- The header shows LIVE / THROTTLED and how many of the 14 sources are healthy. If GDELT throttles, the RSS desks keep the feed live.

**Coverage trends (news volume)**
- **Primary: GDELT.** 14 days of daily article counts per zone (`timelinevolraw`), taken as a share of all coverage GDELT monitored that day, so a slow global news day doesn't read as a fall. The ratio is the mean share of the last 3 days ÷ the mean of the 11 before.
- **Fallback: RSS.** When GDELT is throttled, the service counts zone-tagged RSS headlines on the day it first observes them, keeping 21 days. It skips the backlog present at first contact, because feeds list only their latest items and older days would otherwise look artificially quiet. A ratio needs 6+ observed days, so this fallback starts empty and fills in over a week.
- **Where it shows.** A sparkline and ratio in the panel's **Signals** section, **Coverage movers** at the top of the right rail, and `NEWS ▲2.1×` badges on zone rows and watchlist chips once a zone is ≥1.5× its baseline. Badges are ignored when built on too few articles (40 for GDELT, 12 for RSS).

**Thermal detections (FIRMS)**
- **Scope.** Watched only in active kinetic zones (kinetic intensity ≥ 50). The watch area is the zone footprint, a radius around the conflict, or the whole country where the war is nationwide (Ukraine, Sudan, Myanmar, Yemen, Lebanon, Gaza/Israel, Haiti, Somalia). The Iran zone is watched only around its named nuclear sites, and Hormuz, the LNG ports and open-sea zones are excluded, because oil and gas flares would dominate.
- **Display.** Thin spikes coloured by fire radiative power, rising through the extruded country. The panel shows the count and total FRP. Toggle under Overlays.
- **Caveat.** Satellites see heat, not causes: crop burning, wildfires and industrial heat appear alongside strikes.

**Reported events (GDELT event stream)**
- **What.** Every 15 minutes GDELT publishes the events it machine-codes from world news, each with a location. These are static files, not the rate-limited search API. The service keeps violent events (assault, fighting, mass violence) that come from an article's lead, are located to a city, fall inside a zone, and involve an armed actor or an act of war. In active war zones (kinetic ≥ 50), fighting between states counts too. Articles whose URL reads as off-topic (no vocabulary of violence) are dropped.
- **On the map.** Red pins, grouped by place. The badge is the number of distinct source articles. Pins with 2+ sources show from mid-zoom (4+ from any zoom) and pulse when reported in the last 3 hours. Single-source pins are hollow and only appear close in: treat them as unconfirmed. Places GDELT locates only to a region ("(general)") need 8+ sources to show at world view. Places reported in the last hour also ping the globe.
- **Click a pin** for the event types, time of the latest report, and the source articles (titles read from their URLs). The zone panel lists the zone's event places under Signals, and every place card counts events within 25 km. Toggle under Overlays → **Reported events (GDELT)**.
- **Caveat.** Machine-coded: type and location can be wrong, and "clash" is GDELT's catch-all for fighting. A pin means violence was *reported* there, so open the sources.

**Opening brief.** When you open the app after 15+ minutes away, a brief greets you: the hottest corroborated event places (marked NEW if they appeared since your last session), the two largest fire clusters, your watchlist (headlines since you were last here, events in 24 h) and zones with surging coverage. Every row flies the globe there. Click the name in the greeting to set your callsign. Reopen it with **◆ Brief** or `B`, and turn off auto-open with the checkbox. The callsign, last-visit time and preference are saved in this browser only.

**Without the service.** On static hosting the app detects the missing service and falls back to browser-side GDELT, with the same spacing and backoff, saved in `localStorage`. Fires and RSS-based trends are unavailable there, and the UI says so.

**Caveat.** These are unverified open-source headlines, including partisan and tabloid outlets. Treat them as signals to check, not facts.

## How the score is built

Each zone lists `drivers_detail`: one **intensity** from 0 to 100 per driver it carries, each with a one-line note. The composite is a weighted sum:

```
score = min(100, Σ_d weight_d × intensity_d)
```

| Driver | Default weight |
| --- | --- |
| kinetic | 0.30 |
| nuclear | 0.20 |
| maritime | 0.15 |
| great_power | 0.15 |
| sanctions | 0.08 |
| regime | 0.07 |
| resource | 0.05 |
| frozen | 0.00 |

- The default weights sum to 1.00, so a zone at 100 on every weighted driver scores exactly 100.
- **Frozen is 0 by design.** A frozen conflict scores through its kinetic residual and great-power exposure, not through a synthetic war score. The frozen intensity is still used when you solo the Frozen layer.
- **Weights are not renormalised.** Raising nuclear to 0.40 lifts only zones that carry nuclear intensity: Iran 82→100 (capped), DPRK launch corridors 45→64, Korean DMZ 42→58, Pakistan–India 40→58, Kashmir 38→52. It does not push other zones down. The rail shows Σ weights, and the sum goes amber when it is not 1.00.
- The stored `score` field on each zone is always **derived** from its breakdown at default weights (`withBaselineScore`). It is never typed in by hand, so every number can be reproduced from the panel.

**Layer view.** When you toggle individual drivers, the displayed score is the weighted mean over the *active* drivers only:

```
view = Σ_{d∈active} w_d·i_d / Σ_{d∈active} w_d
```

A soloed layer therefore reads its raw intensity on the full 0–100 ramp. That is why "maritime only" makes Hormuz (100), Bab el-Mandeb (95), Taiwan Strait (90), Malacca (86), Suez (85) and Panama (76) dominate. If every active weight is 0 (Frozen alone), the drivers are averaged equally.

**On the globe:**

- **Country polygons.** Country heat is the max over zones of `zone view score × country share`. Shares come from `zone.countries`, so Ukraine takes 1.0 of the Ukraine-front score and Russia takes 0.3. Colour follows the ramp (cool gray → amber → deep red → white-hot), and extrusion is `0.006 + 0.07·(heat/100)^1.35`.
- **Blooms.** Additive discs sized by `radiusKm`, scaled ×0.75–1.25 with score. The core pushes toward white above 45. A bloom pulses (4 s period, ±6 %) only when `trend === "rising"` and its displayed score is above 70.
- **Footprints.** Sub-national or maritime polygons, where a real extent exists, float just above the host countries.
- **Routes and range rings.** Routes (shadow-fleet lanes, export routes, cable corridors, island chains) show while their zone is lit. Range rings show when the zone is selected or the Nuclear layer is soloed.
- **Arcs.** Proxy and supply links are off by default and drawn thin at 20 % opacity.

## How to add a zone

1. Add an object to `ZONES` in `src/data/heatzones.ts`:

   ```ts
   {
     id: "example-strait",               // unique, kebab-case
     name: "Example Strait",
     region: "Somewhere",
     kind: "chokepoint",                 // theater | chokepoint | network | corridor
     drivers: ["maritime"],              // primary tags; each must appear in drivers_detail
     trend: "stable",
     confidence: "medium",               // confidence in the score, not the facts
     centroid: [12.3, 45.6],             // [lat, lng]
     radiusKm: 150,                      // point bloom
     countries: { YEM: 0.3 },            // optional: polygon heat shares (0–1)
     summary: "Mechanism in 2–3 sentences, plus what would falsify the score.",
     drivers_detail: [
       { driver: "maritime", weight: 70, note: "Why 70. Mark (conf: low|med) if thin." },
     ],
     watch: ["Tripwire or falsifier"],
     links: [{ label: "Transit data", query: "example strait transits weekly" }],
   }
   ```

2. Optional geometry:
   - `polygon: poly([[lat, lng], …])` for a footprint. The helper swaps to GeoJSON `[lng, lat]`, closes the ring and forces the winding the renderer expects. A counter-clockwise ring would paint the whole globe.
   - `nodes` for multi-point zones. For `kind: "network"`, the zone *is* its nodes, and `radiusKm` is only the default node size.
   - `routes` for lanes and `ranges` for strike-range rings.
   - `opacity` below 1 for deliberately faint layers (the China silo fields use 0.4).
3. If `countries` names a new country, add its world-atlas numeric id to `ATLAS_ID_TO_ISO3` in `src/data/countries.ts`. The type system rejects unknown codes.
4. Run `npm run dev`. In development, `validateDataset` (`src/data/source.ts`) logs duplicate ids, out-of-range values, summaries longer than 2–3 sentences, drivers missing from `drivers_detail`, zones with nothing to render, and scenario references to unknown zones.

Copy rules for summaries and notes:

- Name the mechanism (deterrence, chokepoint, regime control, sanctions leakage) and one thing that would falsify the score.
- No casualty figures. No "tensions are high" or "experts say". No predictions stated as fact.

## What the scenario toggle assumes

Scenarios live in `src/data/scenarios.ts`. A scenario **never overwrites a score**. It adds documented deltas to driver intensities, clamps them to 0–100, and recomputes the composite under whatever weights are active. **Escalation** is a stress case, not a forecast. Five concurrent shifts are applied, and every other zone is unchanged:

| Zone | One-line assumption | Intensity deltas | Composite at default weights |
| --- | --- | --- | --- |
| Taiwan Strait | PLA exercise becomes a declared customs "quarantine" of Taiwan's ports with coast-guard boardings; no strikes on Taiwan | kinetic +40, sanctions +25, nuclear +10, maritime +8, great power +2 | 54 → 72 (+17.5) |
| Korean DMZ · NLL | Artillery or naval exchange at the NLL, with Pyongyang declaring the line void | kinetic +35, maritime +20, nuclear +12, great power +10 | 42 → 60 (+17.4) |
| Baltic · Suwałki | Multiple cables and a pipeline sabotaged, plus a naval standoff over boarding a shadow-fleet tanker | kinetic +30, maritime +20, resource +20, nuclear +10, sanctions +10, great power +6 | 47 → 64 (+16.7) |
| Strait of Hormuz | The US–Iran exchange widens to Gulf export terminals (Ras Tanura, Fujairah) and mines are laid in the strait | great power +15, kinetic +10, nuclear +10, resource +5 | 78 → 85 (+7.5) |
| Bab el-Mandeb | The Houthis declare the strait closed from Perim Island and strike Yanbu-bound tankers | great power +20, resource +20, kinetic +15, maritime +5 | 56 → 65 (+9.3) |

Adjusted zones also switch to `trend: "rising"`, so Taiwan Strait and Hormuz, both now above 70, pulse. The delta is always on screen:

- a banner states the global assumption and lists each zone's baseline→scenario score;
- the globe labels every adjusted zone with its delta;
- the detail panel shows the one-line assumption, and the driver bars mark each delta as a hatched extension.

## Data layer and live feeds

`src/data/source.ts` defines the only seam the UI uses:

```ts
interface HeatSource { id: string; load(signal?: AbortSignal): Promise<HeatDataset> }
```

v1 ships `staticSource`, which dynamically imports the seed as its own chunk. To go live, implement a source that fetches, maps into `HeatDataset`, runs `validateDataset`, and set `ACTIVE_SOURCE` to it. Nothing in the view layer changes.

The seed reflects public information through **H1 2026**. Notes marked `(conf: low)` or `(conf: med)`, and zones with `confidence: "low"` (Venezuela, Yemen internal fronts, Lombok), are where the underlying situation is fluid. Refresh them against current reporting before relying on them.

> **Refreshed 29 September 2026.** Twelve zones affected by the 2026 Iran war and related shifts were rescored against current reporting and carry `reviewed: "2026-09-29"`, shown in the panel as **REVIEWED**:
> - Iran and Hormuz: war since 28 February; strait closed except for IRGC-licensed transits.
> - LNG load ports: Ras Laffan damage.
> - Iran shadow fleet.
> - Bab el-Mandeb, Red Sea/Houthis and Yemen: Houthi attacks; Mokha and Perim taken.
> - Gaza/Lebanon/Israel and Lebanon: the 2026 Lebanon war and truce.
> - Suez and the Cape: diversions.
> - Venezuela: supervised transition.
> - Ukraine: revived talks.
>
> Other zones still reflect the H1 2026 seed. Sources for the refresh include CRS and House of Commons Library briefings, Wikipedia event pages, straits.live, Al Jazeera, CNBC, NBC, Euronews and ABC News. Notes mark medium- and low-confidence points.

## Layout

```
src/
  data/        schema.ts (types, weights), heatzones.ts (zones + links), scenarios.ts,
               countries.ts (atlas id → ISO3), newsTerms.ts (headline terms per zone),
               source.ts (HeatSource + validation), sites.ts (named places inside zones)
  model/       score.ts (composite, layer view, scenario, country heat), heatColor.ts (ramp LUT)
  news/        gdelt.ts (client, bands, timelines, title cleanup), match.ts (headline → zone tags),
               siteMatch.ts (headline → site tags), useNewsFeed.ts (browser-side GDELT fallback)
  intel/       types.ts (wire types), useIntel.ts (polls the local intel service),
               fireClusters.ts (FIRMS clusters named after the nearest town), eventFormat.ts (event labels)
  state/       viewState.ts (reducer: layers, weights, scenario, selection, watchlist, render prefs)
  globe/       GlobeView.tsx (lazy, globe.gl), GlobeHud.tsx (SVG HUD), earth.ts (shader, mask, lines),
               blooms.ts (target markers), geo.ts, format.ts, bus.ts (camera/atlas store), webgl.ts, stubs/,
               places.ts (city/town/province loading + nearest-place index), labels.ts (LOD label overlay),
               placeItems.ts (what gets labelled at which altitude)
  components/  TopBar, WorldClocks, LayerDock, WeightControl, MiniMap, NewsFeed, EventLog, Watchlist,
               DetailPanel, PlaceCard, Briefing, DriverBars, ZoneList, ScenarioBanner, StatusLine, FallbackTable,
               LayerChips, GlobeBoundary
  styles/      global.css (tokens, shell), ops.css (ops-center layer)
server/
  intel.ts     local intel service + Vite plugin (news, GDELT queue, trends, FIRMS, disk cache)
  rss.ts       RSS/Atom reader and the 13 desks
  firms.ts     FIRMS CSV parse + kinetic-zone watch regions
  events.ts    GDELT event-stream parse, violence filters, grouping by place
  regions.ts   zone watch areas shared by fires and events
scripts/
  build-geo.mjs    downloads GeoNames + Natural Earth admin-1 and writes public/geo
  check-sites.mjs  checks site coordinates against GeoNames
public/geo/        generated: cities.json + one file per country (c/<ISO numeric>.json)
```

## Performance notes

- **Lazy globe.** The globe (globe.gl + three.js) is a lazy chunk. On desktop it is prefetched in parallel with the data. On mobile it mounts only when scrolled into view, below the ranked list, which is the primary mobile UI.
- **Smaller globe chunk.** three-globe statically imports the WebGPU renderer (heatmap layer) and h3-js (hexbin layers). Neither is used here, so `vite.config.ts` aliases both to `src/globe/stubs/unused-layer.ts`. That stub throws if it is ever reached. This roughly halves the globe chunk (~1.9 MB → ~1.0 MB minified, ~290 kB gzip). Remove the alias if you add a heatmap or hexbin layer.
- **Cheap repaints.** Bloom objects are created once. A reweight or scenario change only mutates material colour, opacity and scale, and re-evaluates memoised polygon accessors. There is no geometry rebuild.
- **Smaller entry chunk.** Framer Motion loads through `LazyMotion` with async features and is used only for panel, rail and banner transitions. The globe itself is pure three.js.
- **WebGL fallback.** WebGL is probed before the globe chunk is requested. If the probe fails, or the globe throws, the ranked table renders from the same scored data.
- **Two map resolutions.** Desktop loads Natural Earth 1:50m (~240 kB gzip) for crisp borders. Mobile loads 1:110m (~40 kB gzip) and starts in low-power render. Only countries that a zone can heat become extruded polygons. The rest of the land is drawn by the shader, and borders are a single line layer, which keeps the 50m detail cheap.
- **No per-frame React.** The HUD, readouts and mini-map follow the camera through small stores and direct SVG/DOM updates. React re-renders only when state changes. The clock re-renders once a second in its own component.

## Assets

- `public/textures/earth-night.jpg` (city lights) comes from the `three-globe` package examples. Check the redistribution terms for your deployment.
- Country polygons, borders and the land mask are Natural Earth 1:50m and 1:110m via `world-atlas`, which is public domain.
- Province polygons are Natural Earth 1:10m admin-1 (public domain), simplified by `scripts/build-geo.mjs`.
- Cities and towns are from [GeoNames](https://www.geonames.org/) `cities1000`, licensed CC BY 4.0. Keep this attribution in any deployment.
- Headlines link to their original publishers. The app stores only titles, URLs, outlet domains and timestamps.
