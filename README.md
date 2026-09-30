# Final Bounce — procedural survival race simulator

Four coloured squares (red, blue, yellow, green) start locked in separate lanes at
the bottom of a tower. A purple flood rises from below. Each colour can only break
bricks of its own colour, so the racers need each other to get out. Then they
ricochet up a snaking tower of halls (pinball fields, slaloms, a blade armory,
brick gates, a narrow sprint corridor) toward a finish room behind a grey plug wall,
while the flood closes in on the last of them. Nobody steers. Whoever reaches the
finish first wins, if anyone does.

The project is a small **content engine** for vertical video: every seed is one
reproducible episode that can be previewed, replayed exactly, scored for drama,
and rendered straight to a frame-perfect 1080×1920 video with sound (a procedural
score included) for Instagram Reels.

It is a static site (HTML + CSS + JavaScript modules, Canvas 2D, Web Audio).
There is no build step, no backend and no runtime dependency.

---

## Running locally

ES modules do not load from `file://`, so serve the folder with any static server:

```sh
npx http-server -c-1 -p 8080 .      # or: npm start
# or
python3 -m http.server 8080
```

Open <http://localhost:8080/>.

Run the tests (Node 18+, no install needed):

```sh
node tests/run-tests.mjs            # self-tests + 60-seed stress test   (npm test)
node tests/stress.mjs medium 1000   # testSeeds(1000) for one preset     (npm run stress)
```

`tests/viz.html?seed=ABC123&t=12&debug` renders one frame of a race at a given
time, with the debug overlay. It is handy when tuning the generator.

## GitHub Pages deployment

All asset paths are relative, so the site works at
`https://USERNAME.github.io/REPOSITORY/` as well as at a domain root.

**Option A — GitHub Actions (included).** `.github/workflows/pages.yml` runs the
self-tests on every push and pull request. On pushes to `main` it copies the
static files into `_site/` and deploys that. One-time setup: *Settings → Pages →
Build and deployment → Source: GitHub Actions*.

**Option B — deploy from branch.** *Settings → Pages → Source: Deploy from a
branch → `main` / `(root)`*. This works because the site needs no build.
`.nojekyll` stops Jekyll from processing the files.

## Workflow

```
GENERATE → WATCH → (REPLAY) → RENDER → DOWNLOAD → NEW SEED
```

1. Enter a seed or press **Random seed** / **New seed**. The page URL updates to
   `?seed=…&preset=…`, so the address bar is always a share link.
2. **Play** starts the race at once, with a short title over the first seconds
   ("WHO ESCAPES THE FLOOD?" and a line explaining the bricks). A slow-motion
   moment when someone finishes is followed by the result card (~1.8 s). The old
   blocking intro card and 3-2-1 countdown are still available in *View*.
3. **Replay** re-runs the same seed and config. The result is identical.
4. **Render video** produces the file (see *Video export*). It is frame-perfect and
   does not need the tab to be visible. **Live capture** is the real-time fallback.
5. **Generate interesting race** tests up to *N* random seeds headless, scores each
   one, and loads the best (or the first that reaches the target score).
   **Auto: find race + render** does both and can repeat it (**Batch**) to produce
   several different videos in a row.

### Controls

| Area | Controls |
| --- | --- |
| Transport | Play / Pause, Restart, Replay, New seed, Close cam toggle, speed ¼× ½× 1× 2× 4× 8× (8× is for testing; exports always use exact 1× time) |
| Seed & course | seed field, Load, Random seed, Copy seed, Copy link, preset, Regenerate same seed |
| Interesting race | minimum score, maximum candidates, Generate interesting race |
| Race settings | difficulty (Easy/Normal/Hard/Chaos), race mode (First wins / Survivors finish), map complexity, barrier density, map length, final wall HP, purple speed, contestant speed, course pull, blade kills, blade on/off, reject bad races |
| View | camera (Auto/Static/Follow pack/Follow leader), close camera, particles, trails, camera shake, text overlays, HUD, title over the start, intro card, countdown, death markers, safe-area guide, debug view, end text |
| Sound | master, effects and music volume, mute, test sound |
| Export video | frame rate (60/30), quality, format (only formats this browser can encode), Render video, Cancel, Auto: find race + render, Batch, Download, Copy caption, Convert to MP4 (only when the file is WebM), Live capture |
| Cover image | moment (current/start/middle/finish), overlay text, Capture cover (1080×1920 PNG) |
| Race report | result table, entertainment score breakdown, live event log |
| Developer | self-tests, `testSeeds(100/500/1000)` |

Keyboard: `Space` play/pause · `R` restart · `N` new seed · `G` interesting race · `D` debug view · `C` close camera.

Presets: **Short reel** (aims for 20–30 s), **Medium reel** (25–40 s), **Chaos**,
**Close race**, **Hard pursuit**, **Long course** (a much taller tower; 45–70 s).
Target durations are aims, not guarantees. The race is never scripted.

## Seeds and determinism

A race is fully defined by **seed + race settings**. The settings under *Race
settings* are part of the replay key and are written into share links
(`?seed=7D92A1&preset=chaos&d=hard&w=0`). Settings under *View* and *Sound* are
presentation only.

How determinism is kept:

- One seeded PRNG (cyrb128 hash → sfc32) drives every random decision:
  generation, spawns, initial angles, mutation, field noise. `Math.random` is
  never used for simulation. Seed *creation* uses `crypto.getRandomValues`.
- The physics runs on a **fixed 120 Hz timestep**. `requestAnimationFrame` only
  sets how many whole ticks to run per frame. Frame rate, playback speed,
  slow-motion, pausing and audio timing change pacing, never results. A
  self-test runs the same race at 30, 59.94 and 144 fps and checks the results
  are identical.
- Contestants are processed in an order that rotates every tick, so no colour
  always resolves first.
- The anti-stuck nudge is a pure hash of (tick, contestant index).
- Replays re-run the simulation from seed + config. Nothing is stored per frame.
- Particles use their own seeded stream, so two recordings of a seed look the same too.

Results are identical across runs in the same browser engine. Floating-point
transcendental functions can differ slightly between JavaScript engines
(V8/SpiderMonkey/JavaScriptCore), so a seed can in rare cases play out
differently in another browser family.

## The simulation

- **Contestants** move at constant speed (base 165 px/s, ±2 % seeded
  variation, +0.4 %/s ramp, capped at +18 %). Position update
  `P += V·dt`. Collisions use circle contact against axis-aligned walls, round
  bumpers and blocks, with reflection `V' = V − 2(V·N)N`, positional correction,
  and bounded sub-steps (≤ half a radius per sub-step) so nothing tunnels.
  Contestant–contestant contacts are equal-mass elastic exchanges.
- **Course pull.** Each ricochet is blended slightly toward the local course
  direction, and racers heading backwards feel a weak current. Motion between
  bounces stays straight. Set *Course pull* to 0 for pure billiards.
- **Axis guard + anti-stuck.** Trajectories within ~7° of an axis are tilted, so
  racers never ping-pong forever between parallel walls. If a racer stays inside
  a 2.5-body box for 4 s, its velocity is rotated a deterministic amount. It is
  never teleported.
- **Starting stalls (puzzle).** Every race starts with the four racers locked in
  their own narrow lanes at the bottom of the tower. The lanes are separated by
  columns of coloured bricks (hanging from the ceiling; the lower part of every
  divider is solid); the last column opens onto a compact exit lane. Only the
  matching colour can break a brick, and each brick in a column breaks on its own.
  The brick colours come from a small solver: the stall is always solvable, always
  chained (2+ rounds), and never lets the racer beside the exit leave on its own.
  Example: BLUE opens the way for YELLOW, YELLOW frees RED, and nobody leaves
  until RED opens the exit. Inside the stalls there is no course bias, so racers
  hit the bricks on both sides, except that a racer whose next brick column has an
  open hole ricochets toward it (otherwise a solved puzzle took ~35 s to clear).
- **Colour gates.** Some halls further up are closed by a full-height wall of
  same-colour bricks. Only that colour can open it, and everyone waits for it.
- **Every contact is a collision.** A racer bounces back even when it breaks
  a block of its own colour. When a colour is eliminated, its blocks turn into
  1-HP grey blocks, so a dead colour can never softlock the course.
- **The grey plug.** The shaft into the finish room is filled with 1–3 layers of
  three grey blocks each (1–2 HP). Any racer damages them; cracks and chipped
  corners show the damage.
- **Blade.** The first living racer to touch it carries it. An armed racer
  eliminates an unarmed one on contact. Two armed racers would bounce. By
  default the blade shatters after **1 kill** (configurable to 2, 3 or unlimited).
  If the carrier dies, the blade is lost.
- **Purple pursuit.** The purple field is not a shape sliding across the screen.
  It is a threshold on **geodesic course distance**: distance from the back of
  every stall lane, measured through the halls, so it follows the route through
  every turn. Its front advances at a base rate
  `(v0 + a·(t − delay)) · scale` plus a **catch-up term** that grows with the
  distance between the front and the *last* surviving racer. That makes it crawl
  while the racers are still locked in the stalls and then close in on whoever
  falls behind (at a gate, in the plug), instead of killing everyone early. The
  difficulty levels are a ladder of these parameters (about 0.3 / 0.7 / 1.3 / 1.7
  purple deaths per race).
  The purple is **solid**: touching it bounces a racer and shoves it **along the
  normal of the purple's own front** (the gradient of its distance field), never
  along the course flow, which points sideways inside a lane. The gap is sampled
  bilinearly so it changes smoothly as a racer moves. A racer dies only when it is
  **crushed**: the purple keeps coming but a wall, a closed gate, the plug or
  another racer stops it from being pushed any further. Coming within 1.5
  body-widths logs a near miss.
- **Finish.** A racer finishes when its centre enters the checkered zone.
  *First wins* ends the race 0.6 s after the first finisher. *Survivors finish*
  runs until everyone has finished or died, or until the timeout.

Every system talks through events (`contestant:bounce`, `contestant:collision`,
`barrier:damage`, `barrier:destroy`, `weapon:pickup`, `contestant:killed`,
`danger:nearMiss`, `contestant:finish`, `race:end`, …). Audio, particles, the
event log and the stats panel subscribe to these. Gameplay code never calls them.

## Procedural generation

Maps are *designed, then varied*: "the flooded tower". The generator does not
scatter obstacles. It plans a sequence of halls with a purpose each, and every seed
varies the plan, the proportions and the contents.

1. **Plan** (`LevelGenerator.planTower`). A director picks the halls between the
   stalls and the finish (2 / 3 / 4 halls for low / medium / high complexity, 5 / 7 / 9
   for long courses) along an intensity curve: early halls let the pack regroup
   (plinko, slalom, pillars, lanes), middle halls add obstacles (funnels, lanes),
   late halls add pressure. It places exactly one **blade armory** in the first
   half, usually a **sprint corridor** right before the plug, and a number of
   **brick gates** by barrier density (every sprint corridor gets one: that is
   where the purple catches the slow). Gate colours cycle through the four colours.
2. **Geometry.** Halls are stacked bands. Every band's ends alternate left/right,
   so the course snakes upward; each door sits at the end of a hall where the next
   one begins. Tower width (380–470 px), hall lengths (78–100 % of the space
   left), heights, door widths and the stall side vary per seed, so silhouettes
   differ. The slab before the finish is thick enough to hold the plug.
3. **Set pieces** (`Pieces.js`): `SCATTER` (diamond plinko grid or scattered
   bumpers), `SLALOM` (alternating baffles with bumpers in the gaps), `PILLARS`,
   `LANES` (a divider forming two lanes), `FUNNEL` (a wide mouth, then a tight
   neck), `ARMORY` (the blade in a ring of bumpers, with cover), `SPRINT` (a 44–50 px
   corridor) and brick gates. Every shape passes a fit check that keeps ≥ 20 px of
   clear space to walls, other shapes and both doors, so nothing is ever too narrow
   for a racer or blocks a doorway.
4. **Course field** on a 4 px grid: configuration space (where a racer's centre
   fits), Dijkstra distances, normalised progress `distS / (distS + distF)`, the
   organic purple threshold, the flow direction and the purple's push normal.
5. **Validation.** Structural checks (spawns free and separate, finish, blade,
   every door and the plug reachable by a racer-sized body, walls inside the
   world, every colour present in the stalls, no large sealed pockets), then a
   **headless test race** rejects layouts where everyone dies almost immediately,
   nobody passes 30 % of the course, the race times out, there is no winner, or
   the duration falls outside the preset's range.
6. On rejection, the next attempt stream of the same seed is tried (up to 14). The
   seed → course mapping stays a pure function. Measured over 150 seeds per preset,
   the average is 0.06–0.3 extra attempts per seed (it was 1.4–3.4 with the old
   generator).

**Progress** (0 → 1) comes from the geodesic field, not from Y position. It drives
the purple field, leader detection, the HUD progress bar, the follow camera and
scoring.

The tools in `tests/` (see *Testing*) exist because this was tuned with data: for
example, an early version killed 81 % of racers inside the stalls, which turned
out to be two bugs in the crush rule, and the stall puzzle took 35 s to clear
until racers were taught to seek open holes.

## Entertainment score

After the headless run, each race gets a 0–100 score. Every part is capped so one
noisy statistic cannot saturate it, and the raw sum is stretched so a typical race
scores about 60 and only races with tension, conflict *and* a dramatic finish
reach 80+.

| Part | Max | Rewards |
| --- | --- | --- |
| pacing | 8 | duration inside the preset's target range |
| tension | 20 | near misses that the racer survived, and how close the closest was |
| conflict | 21 | blade pickup (earlier is better), kills, racers crushed after the opening |
| finish | 16 | runner-up close behind; winner barely ahead of the purple |
| turnover | 8 | the lead changing hands |
| puzzle | 6 | gates opened, the plug dug through |
| depth | 8 | several racers reaching the late tower |

Penalties: an instant wipe, no winner, no progress, anti-stuck interventions, a
timeout, dead air (more than 5 s without a notable event) and one racer leading
wire to wire. The breakdown is shown in the race report (creator UI only).

**Generate interesting race** samples random seeds, simulates each one without
rendering, keeps the best, and stops at the target score (default 70) or the
candidate limit (default 50). It shows `Testing races… 18 / 50`, then the selected
seed and its score.

## Visual style

The recorded view is meant to look like a small experimental physics game, not
an app. Everything on the canvas has a gameplay job:

- **Surround**: dark charcoal with an almost invisible diagonal hatch.
- **Course**: pale cool-grey floor with a faint 24 px grid, cream walls with
  thin charcoal outlines, flat bumpers. The finish is a flat checkerboard. The
  static level is drawn as vector shapes culled to the visible window, so edges
  stay crisp at the 2.4× close camera and a frame costs about 5 ms.
- **Racers**: 12 px flat squares with a thin dark border and a short tapering
  translucent trail (drawn under the walls).
- **Purple**: solid dark purple on the 4 px tile grid (stepped edge kept on
  purpose), with a one-band lighter leading edge. No glow, fog or animation.
- **Blocks**: colour barriers are solid blocks with a dark outline and simple
  brick joints. Grey final blocks are blue-grey and show damage through cracks, chipped
  corners and darkening. There are no health bars.
- **Blade**: a tiny flat icon lying on the floor. When carried, it points along
  the carrier's direction of travel.
- **HUD strip** (top, below Instagram's header): `SEED`/`TIME` labels over
  values, four narrow status sections (dead = 35 % opacity with ×; blade icon
  when armed; `#1` when finished), and a thin race timeline showing the purple
  progress, racer markers and a checkered finish tick. The course scrolls
  under the strip in follow mode.
- **Title over the start**: for the first ~2.4 s, `WHO ESCAPES THE FLOOD?` with a
  smaller line, `EACH COLOR BREAKS ONLY ITS OWN BRICKS`, so a new viewer understands
  the stalls at once. It fades in over 180 ms and never blocks the race.
- **Messages**: one line of condensed text such as `YELLOW GOT THE BLADE`. The
  name is in the racer's colour and the rest is off-white, with a thin dark
  outline and no box. It fades in over ~120 ms and lasts ~1 s.
- **Ending**: the scene dims and the final state stays visible. The text is
  `YELLOW WINS`, then `TIME`, `KILLS` and `SEED` in small mono, and an optional
  end line (default `WHO WINS THE NEXT ONE?`, editable in *View*). It reveals over
  300 ms. There are no banners, crowns or trophies.
- **Composition**: in the static camera the course is top-aligned under the HUD
  and never scaled above 1.3×; courses using less than ~80 % of the frame width sit
  on the left and leave negative space on the right, where Instagram's buttons are.
- **Close camera** (optional, on by default; `Close cam` button, View →
  *Close camera*, or the `C` key): with the Auto camera, every course is
  followed up close (2.4×, never further than 1.7×) on the main group of
  racers. Switched off, courses that fit the frame are shown whole and long
  courses get a wide follow camera.
  When a racer breaks away and leaves the screen, a circular inset camera
  appears in the lower-right corner and follows it until it rejoins.
- **Effects**: small square fragments (3–8) for breaks and eliminations, and a
  camera shake capped at 4 px. Sound carries most of the feedback.
- **Type**: Barlow Condensed for labels and IBM Plex Mono for numbers. Both
  are bundled in `assets/fonts/` (SIL OFL), so recordings look the same on
  every machine. The page waits for them before drawing the first frame.

## Video export

### Render video (frame-perfect, WebCodecs)

The live recorder can only capture whatever the browser happens to draw in real
time, so frame pacing and audio sync depend on how busy the machine is. **Render
video** does not record anything: it *runs the race itself*, one exact `1/fps` step
per video frame.

```
game.update(1/fps) -> draw to an offscreen 1080x1920 canvas -> VideoEncoder
sound events, stamped with the frame time -> OfflineAudioContext -> AudioEncoder
both tracks, merged in timestamp order -> mp4-muxer / webm-muxer -> file
```

- **Formats** are probed with `isConfigSupported`, so only what this browser can
  actually encode is offered: **MP4 (H.264 + AAC)** (what Instagram likes) where the
  browser has those encoders, otherwise **WebM (VP9 + Opus)**. MP4 is written with
  the index up front (fast start). If an encoder fails midway, the next format is
  tried automatically.
- **Deterministic.** Same seed and settings give the same frames and the same
  soundtrack (to float rounding: Chromium sums overlapping voices in a varying order,
  which moves samples by about 1e-7, i.e. -140 dBFS), on any machine load. The tab can
  be in the background and rendering can run faster than real time. Compressed bytes
  may still differ between encoders and machines.
- **Soundtrack.** The sound effects use the same synthesis code as live playback,
  scheduled at exact times. A procedural score (`Music.js`: 128 bpm, key and
  variations from the seed, four layers from a drone up to arpeggio + clap) follows
  a race-tension curve (`Intensity.js`: how close the purple is to a racer, how far
  the leader has climbed, whether the blade is out) and fades out at the end. The mix
  is compressed and normalised to a consistent loudness with a soft limiter (no
  clipping). Set *Music* to 0 for effects only.
- **What is in the frame.** Only the canvas: HUD, world and messages. The safe-area
  guide and debug overlay are never rendered into an export.
- **Also included**: progress with speed and ETA, cancel, a live preview while it
  renders, **Auto: find race + render** and **Batch** (N different interesting
  seeds, downloaded one after another; the browser may ask once to allow multiple
  downloads), and **Copy caption** (winner, time, seed and hashtags as plain text).
- **Requirements**: WebCodecs (Chrome or Edge 94+, Firefox 130+, Safari 16.4+). The
  panel says so when it is missing and falls back to live capture.

### Live capture (fallback)

`canvas.captureStream()` + the Web Audio mix → `MediaRecorder`, in real time. The
container and codec are picked with `MediaRecorder.isTypeSupported()`
(`vp9,opus` → `vp8,opus` → `webm`; MP4 where the browser can record it). The WebM
duration is patched into the file (MediaRecorder omits it). Keep the tab visible
while it records.

### MP4 from a WebM

If Render video could only produce WebM, **Convert to MP4** runs ffmpeg.wasm in the
browser (H.264 + AAC). The wrapper is vendored in `vendor/ffmpeg/` (MIT); the ~31 MB
core is fetched from jsDelivr only when you click the button. It is slow (minutes for
a 30 s clip) and not recommended on phones. On a desktop you can do the same with
`ffmpeg -i race.webm -c:v libx264 -pix_fmt yuv420p -c:a aac race.mp4`.

### Cover image

A 1080×1920 PNG of the current frame, or of the start, middle or finish
(re-simulated deterministically), with optional text such as “WHO WILL WIN?”.

### Browser support

| | Simulation | Sound | Render video | Live capture |
| --- | --- | --- | --- | --- |
| Chrome / Edge (desktop) | yes | yes | MP4 (H.264 + AAC) or WebM (VP9 + Opus), by what the browser can encode | WebM; MP4 on recent versions |
| Firefox 130+ (desktop) | yes | yes | WebM (VP9 + Opus) | WebM |
| Safari 16.4+ | yes | yes | depends on the codecs exposed | MP4 where supported |
| Mobile Chrome (Android) | yes | yes | works where WebCodecs encoders exist; slow on weak devices | usually WebM |

Only the WebM/VP9 path and the MP4 *container* path (with VP9) were exercised in
automated tests; H.264 and AAC encoding depend on codecs this project's test browser
does not ship. Audio starts after the first click or tap, because of browser autoplay
rules (rendering does not need it).

### Instagram-safe composition

The course is fitted between the HUD band (top ~12 %) and the caption zone
(bottom ~13 %). The HUD, callouts and result card stay clear of the right-hand
action buttons. **Safe-area guide** overlays the zones that Instagram usually
covers.

## Architecture

```
index.html                 creator page (canvas + DOM controls)
css/app.css
js/main.js                 bootstrap, wiring, window.race dev handle
js/config/presets.js       constants, difficulties, presets, URL keys
js/core/
  RNG.js                   seeded PRNG, hashing, seed strings
  EventBus.js              pub/sub
  Simulation.js            deterministic fixed-step race (no DOM)
  Intensity.js             race tension curve (drives the score)
  Game.js                  state machine + presentation timeline
  GameLoop.js              rAF driver
  Share.js                 URL <-> config
js/physics/                Collision.js, SpatialGrid.js (broadphase), Vector.js
js/entities/               Contestant, Wall/Bumper, Barrier, Weapon, FinishZone, DangerZone
js/generation/
  LevelGenerator.js        plan -> geometry -> content -> field -> checks, with retries
  Pieces.js                set pieces (plinko, slalom, lanes, funnel, armory, gates)
  StartStalls.js           starting stalls + the colour-chain solver
  CourseField.js           configuration space, geodesic fields, flow, purple push normal
  LevelValidator.js        structural checks + race verdict
  EntertainmentEvaluator.js
  RaceFinder.js            "generate interesting race"
js/rendering/              Renderer.js, Camera.js, Particles.js (pooled)
js/audio/
  AudioEngine.js           live graph, throttling, music bus
  Sounds.js, SoundMap.js   synthesised effects, event -> sound map (shared with export)
  Music.js                 procedural score (live player + shared step scheduler)
  OfflineMixer.js          renders a whole soundtrack offline, loudness normalisation
js/recording/
  FrameExporter.js         frame-perfect WebCodecs export
  Recorder.js              live MediaRecorder capture (fallback)
  VideoExporter.js         downloads, PNG covers, ffmpeg.wasm conversion
  WebmDuration.js          patches the duration into MediaRecorder WebM
js/ui/                     CreatorPanel.js, StatsPanel.js
js/dev/                    SelfTests.js, DevTools.js (testSeeds)
vendor/ffmpeg/             ffmpeg.wasm wrapper (MIT), loaded on demand
vendor/muxers/             mp4-muxer, webm-muxer (MIT)
assets/fonts/              Barlow Condensed, IBM Plex Mono (SIL OFL)
tests/                     run-tests.mjs, e2e.mjs, stress.mjs, and tuning tools (below)
```

Game states: `IDLE → GENERATED → COUNTDOWN → RUNNING → FINISHED`. `REPLAY`,
`RECORDING` and `RENDERING` are session modes layered on the running race and are
shown in the header badge.

The simulation modules have no DOM dependency. The same code runs the on-screen
race, the headless validation run, the interesting-race search, the Node tests,
cover-frame re-simulation and the video export.

## Testing

`node tests/run-tests.mjs` (and **Developer → Run self-tests** in the page) runs 26
self-tests. They check:

- same seed → same map, same winner and duration, same event timeline; results
  independent of frame rate (30 / 59.94 / 144 fps); different seeds → different maps
- racers cannot pass through a thin wall even at 6× speed
- colour bricks break only for their colour and still bounce the racer; grey blocks
  accept every colour; orphaned colour bricks turn neutral
- blade ownership; an armed collision eliminates the target
- the purple crushes racers against a gate they cannot open, but only bounces them
  otherwise; **it shoves a racer along its own front normal, and a fast front
  sweeping through a lane never crushes a racer that still has room**
- the starting stalls are solvable, chained, and the exit brick never belongs to its neighbour
- the tower structure (stalls at the bottom, finish on top, alternating halls, doors
  inside both halls, plug block count, hall counts per preset) and ≥ 20 px clear
  gaps between obstacles
- the tension curve is deterministic, bounded and rises toward the finish
- the score's key and arrangement are seeded and layered; audio normalisation reaches
  the target loudness and never clips
- finish detection; recording-support detection on browsers without the APIs;
  structural validation of 120 generated maps across presets

The two purple regression tests were checked by **mutation**: re-introducing the
original bugs (push along the course flow; per-tile gap) makes them fail.

`node tests/e2e.mjs` needs Playwright + Chromium (`PLAYWRIGHT_MODULE` can point at an
existing install) and runs the real thing: exports WebM and MP4-container videos,
decodes them back (1080×1920, duration = frames/fps, audio and video lengths agree,
audible and unclipped, moov before mdat), checks determinism (same frames, same
soundtrack fingerprint, sample drift below 1e-5), 60 vs 30 fps, the automatic encoder fallback, the auto/batch flow
and live capture.

Tuning tools (they print the numbers the presets are tuned against):

| Tool | Use |
| --- | --- |
| `tests/stress.mjs [preset] [n]` | `testSeeds(n)`: validity, retries, duration, wins per colour, score |
| `tests/profile.mjs [preset] [n]` | where racers die, near misses, quiet gaps, attempts |
| `tests/tune.mjs preset '[overrides]' [n] ['{cfg}']` | compare purple parameters on unfiltered races |
| `tests/stallprobe.mjs [n]` | how long the starting puzzle takes with the purple off |
| `tests/scoredist.mjs presets [n]` | distribution of the entertainment score |
| `tests/gallery.html?preset=medium&n=6&t=14` | contact sheet of generated levels (`t` = seconds to simulate first) |

## Known limitations

- **H.264/AAC encoding was not testable here.** The MP4 path shares its code with the
  tested one, and a failing encoder falls back to WebM automatically, but it has not
  been run against a real H.264/AAC encoder.
- Rendering speed depends on the browser. In this project's software-only headless
  Chromium a 26 s video renders in about 30 s; browsers with GPU-accelerated canvas
  and hardware encoders should be faster, but that was not measured.
- The score is generated and checked numerically (steady 128 bpm pulse, balanced
  spectrum, no clipping) but its taste is unreviewed.
- Live capture is real-time, needs a visible tab, and frame pacing depends on the
  machine.
- MP4 conversion with ffmpeg.wasm is heavy (31 MB download, single-threaded).
- Determinism is guaranteed within a JavaScript engine, not across engines
  (transcendental functions can differ). Encoded bytes can differ between machines.
- The simulation and every video frame are exactly reproducible; the soundtrack is
  reproducible to float rounding only. Chromium adds simultaneous voices in a varying
  order, so two renders of one race differ by about 1e-7 (-140 dBFS), which is inaudible
  and far below the 16-bit/Opus noise floor.
- The purple front is drawn on a 4 px grid, which gives it a slightly stepped edge by design.

## Roadmap

The engine is built so these can be added without restructuring. New
obstacles plug into the level data, the spatial grid, `Simulation.resolveStatic`
and the renderer. New power-ups follow the `Weapon` pattern. New effects
subscribe to events.

- shields, speed boosts, teleporters, mines, slow/ice zones, lava
- moving walls, rotating bumpers, doors and keys
- multiple weapons and duel rules
- team mode, boss walls
- prediction/betting overlay, tournament brackets
- automated captions and highlight cuts from the event log

## License

GPL-3.0 (see `LICENSE`). `vendor/ffmpeg/` is MIT-licensed (ffmpeg.wasm); see
`vendor/ffmpeg/LICENSE`. The fonts in `assets/fonts/` are under the SIL Open
Font License 1.1; see `assets/fonts/OFL.txt`.
