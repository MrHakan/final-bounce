# Final Bounce — procedural survival race simulator

Four coloured squares (red, blue, yellow, green) ricochet through a procedurally
generated course while a purple field eats the map behind them. Nobody steers.
Whoever reaches the finish first wins, if anyone does.

The project is a small **content engine** for vertical video: every seed is one
reproducible episode that can be previewed, replayed exactly, scored for drama,
and recorded straight to a 1080×1920 video with sound for Instagram Reels.

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
GENERATE → WATCH → (REPLAY) → RECORD → DOWNLOAD → NEW SEED
```

1. Enter a seed or press **Random seed** / **New seed**. The page URL updates to
   `?seed=…&preset=…`, so the address bar is always a share link.
2. **Play** runs the intro (“WHO WILL SURVIVE?”, ~1 s), the countdown
   (3-2-1-GO, ~1.2 s), the race, a short slow-motion moment when someone
   finishes, and the result card (~1.8 s).
3. **Replay** re-runs the same seed and config. The result is identical.
4. **Record race** resets the race, records the whole episode, stops by itself
   after the result card, and offers the file for download.
5. **Generate interesting race** (or **Auto generate + record**) tests up to
   *N* random seeds headless, scores each one, and loads the best (or the first
   that reaches the target score).

### Controls

| Area | Controls |
| --- | --- |
| Transport | Play / Pause, Restart, Replay, New seed, speed ¼× ½× 1× 2× 4× 8× (8× is for testing; recording always runs at 1×) |
| Seed & course | seed field, Load, Random seed, Copy seed, Copy link, preset, Regenerate same seed |
| Interesting race | minimum score, maximum candidates, Generate interesting race |
| Race settings | difficulty (Easy/Normal/Hard/Chaos), race mode (First wins / Survivors finish), map complexity, barrier density, map length, final wall HP, purple speed, contestant speed, course pull, blade kills, blade on/off, reject bad races |
| View | camera (Auto/Static/Follow pack/Follow leader), particles, trails, camera shake, text overlays, HUD, intro, countdown, death markers, safe-area guide, debug view |
| Sound | master volume, effects volume, mute, test sound |
| Record Reel | frame rate (60/30), quality, format (only formats this browser supports are listed), auto-download, Record race, Stop, Auto generate + record, Download video, Convert to MP4 |
| Cover image | moment (current/start/middle/finish), overlay text, Capture cover (1080×1920 PNG) |
| Race report | result table, entertainment score breakdown, live event log |
| Developer | self-tests, `testSeeds(100/500/1000)` |

Keyboard: `Space` play/pause · `R` restart · `N` new seed · `G` interesting race · `D` debug view.

Presets: **Short reel** (aims for 15–25 s), **Medium reel** (25–40 s), **Chaos**,
**Close race**, **Hard pursuit**, **Long course** (taller than the frame; the
camera follows). Target durations are aims, not guarantees. The race is never
scripted.

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
- **Starting stalls (puzzle).** Every race starts with the four racers
  locked in their own narrow lanes. The lanes are separated by columns of
  coloured bricks; the last column opens onto the exit lane. Only the matching
  colour can break a brick, and each brick in a column breaks on its own. The
  brick colours are chosen by a small solver so the stall is always solvable,
  always chained, and never lets the racer beside the exit leave on its own.
  Example: BLUE opens the way for YELLOW, YELLOW frees RED, and nobody leaves
  until RED opens the exit. The purple rises from the back of every lane.
- **Colour gates.** Some doorways further down the course are closed by
  columns of single-colour bricks.
- **Every contact is a collision.** A racer bounces back even when it breaks
  a block of its own colour. When a colour is eliminated, its blocks turn into
  1-HP grey blocks, so a dead colour can never softlock the course.
- **Final grey wall.** Neutral blocks in front of the finish room. Any racer
  damages them (1–4 HP, cracks show the damage).
- **Blade.** The first living racer to touch it carries it. An armed racer
  eliminates an unarmed one on contact. Two armed racers would bounce. By
  default the blade shatters after 2 kills (configurable, or unlimited). If the
  carrier dies, the blade is lost.
- **Purple pursuit.** The purple field is not a shape sliding across the
  screen. It is a threshold on **geodesic course distance**: distance from the
  back of the start room, measured through the corridors. That way it follows
  the route through every turn. Its front advances at
  `rate(t) = (v0 + a·(t − delay)) · scale`, plus a catch-up term when every
  survivor is far ahead. The catch-up term is capped so it never outruns the
  racers. The purple is **solid**: touching it bounces a racer and pushes it
  down the course, and it fills each section completely as it advances. A racer
  dies only when it is **crushed**, meaning the purple keeps coming but a wall,
  a closed gate or a dead end stops the racer from being pushed any further.
  Coming within 1.5 body-widths logs a near miss.
- **Finish.** A racer finishes when its centre enters the checkered zone.
  *First wins* ends the race 0.6 s after the first finisher. *Survivors finish*
  runs until everyone has finished or died, or until the timeout.

Every system talks through events (`contestant:bounce`, `contestant:collision`,
`barrier:damage`, `barrier:destroy`, `weapon:pickup`, `contestant:killed`,
`danger:nearMiss`, `contestant:finish`, `race:end`, …). Audio, particles, the
event log and the stats panel subscribe to these. Gameplay code never calls them.

## Procedural generation

Maps are *random but structured*:

1. **Route skeleton.** A self-avoiding walk over a 4-column grid (6 rows for
   the 9:16 frame, 10 rows for long courses), in one of several styles
   (wander, snake, zigzag, corridor, spiral). Consecutive cells are linked by
   doors. Every other cell boundary is solid wall. The course is a chain
   START → … → FINISH, which forms straights, L-turns, U-turns, S-bends and
   merged open rooms.
2. **Stages** along the route: start, colour section, bounce section, power
   room, pursuit section, chaos section, final gate, finish.
3. **Section templates** decorate each cell given its entry/exit connectors:
   `ARENA`, `PINBALL`, `PILLARS`, `ZIGZAG`, `PARALLEL_LANES`, `CHOKEPOINT`,
   `FUNNEL`, `CORNER`, `POWERUP_ROOM`, plus colour gates and the final gate.
   Every piece goes through a fit check that keeps door approaches clear and
   forbids gaps narrower than a racer.
4. **Placement**: the starting stalls in the first two cells (lane order and
   brick colours from the stall solver), single-colour brick gates in some
   later doorways, the blade in a contested
   room at 30–55 % of the route, free-standing colour blocks, 2–6 grey final
   blocks in 1–2 layers, the finish zone, and a 2×2 spawn with colours
   shuffled across the slots.
5. **Bounded mutation** of obstacle positions and sizes.
6. **Course field** on a 4 px grid: configuration space (where a racer's centre
   fits), Dijkstra distances from start and to finish, normalised progress
   `distS / (distS + distF)`, the organic purple threshold, and the flow
   direction.
7. **Validation.** Structural checks: spawns free and not overlapping, finish,
   blade, every door and the final gate reachable by a racer-sized body, gates
   multi-coloured, walls inside the world, no large sealed pockets. Then a
   **headless test race** rejects layouts where everyone dies almost
   immediately, nobody passes 30 % of the course, the race times out, there is
   no winner, or the duration falls outside the preset's range.
8. On rejection, the next attempt stream of the same seed is tried (up to 14).
   The seed → course mapping stays a pure function.

**Dynamic balancing**: short routes get busier rooms, and long routes get a
slightly slower purple field. Barrier-heavy maps and double-layer final walls
get lower grey HP. The blade room gets a ring of bumpers around the blade.

**Progress** (0 → 1) comes from the geodesic field, not from Y position, so it
works for courses that twist in any direction. It drives the purple field,
leader detection, the HUD progress bar, the follow camera and scoring.

## Entertainment score

After the headless run, each race gets a 0–100 score.

Points are added for:
- a blade pickup (more if it comes early)
- kills
- eliminations after the opening seconds
- near misses that the racer survives
- lead changes
- barrier destruction and the final wall breaking
- several racers reaching the late stage
- a close finish, and a winner who barely escaped the purple
- a duration inside the preset's target range

Points are taken off for:
- an instant wipe
- no winner
- no progress
- anti-stuck interventions
- a timeout
- long stretches with nothing happening
- a wire-to-wire leader with no lead changes

The breakdown is shown in the race report (creator UI only).

**Generate interesting race** samples random seeds, simulates each one without
rendering, keeps the best, and stops at the target score or the candidate limit
(default 50). It shows `Testing races… 18 / 50` and then the selected seed and
its score.

## Visual style

The recorded view is meant to look like a small experimental physics game, not
an app. Everything on the canvas has a gameplay job:

- **Surround**: dark charcoal with an almost invisible diagonal hatch.
- **Course**: pale cool-grey floor with a faint 24 px grid, cream walls with
  thin charcoal outlines, flat bumpers. The finish is a flat checkerboard.
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
- **Messages**: one line of condensed text such as `YELLOW GOT THE BLADE`. The
  name is in the racer's colour and the rest is off-white, with a thin dark
  outline and no box. It fades in over ~120 ms and lasts ~1 s.
- **Ending**: the scene dims and the final state stays visible. The text is
  `YELLOW WINS`, then `TIME`, `KILLS` and `SEED` in small mono. It reveals over
  300 ms. There are no banners, crowns or trophies.
- **Composition**: the course is top-aligned under the HUD and never scaled
  above 1.3×. Courses using less than ~80 % of the frame width sit on the left
  and leave negative space on the right, where Instagram's buttons are.
- **Long courses**: a close follow camera (2.4×, never further than 1.7×)
  tracks the main group of racers.
  When a racer breaks away and leaves the screen, a circular inset camera
  appears in the lower-right corner and follows it until it rejoins.
- **Effects**: small square fragments (3–8) for breaks and eliminations, and a
  camera shake capped at 4 px. Sound carries most of the feedback.
- **Type**: Barlow Condensed for labels and IBM Plex Mono for numbers. Both
  are bundled in `assets/fonts/` (SIL OFL), so recordings look the same on
  every machine. The page waits for them before drawing the first frame.

## Recording and export

- The recorder captures **only the simulation canvas**
  (`canvas.captureStream(fps)`) plus the Web Audio mix. The audio graph feeds
  both the speakers and a `MediaStreamAudioDestinationNode`. Creator UI, debug
  panels, cursor and browser chrome are never in the video. The debug overlay
  and safe-area guide appear in the video only if you switch them on.
- Output is 1080×1920 at 60 or 30 fps. The container and codec are picked with
  `MediaRecorder.isTypeSupported()`, in this order:
  `video/webm;codecs=vp9,opus` → `vp8,opus` → `video/webm`. MP4 variants are
  listed when the browser can record them natively.
- MediaRecorder writes WebM without a duration, which breaks seeking in some
  players. The exporter patches the EBML `Duration` element into the file.
- **MP4.** If the browser's MediaRecorder can write MP4 directly (recent
  Chrome/Edge, Safari), pick an MP4 format and no conversion is needed.
  Otherwise **Convert to MP4** turns the WebM into H.264/AAC in the browser with
  ffmpeg.wasm. The wrapper is vendored in `vendor/ffmpeg/` (MIT) so its worker
  is same-origin. The ~31 MB single-thread core is fetched from jsDelivr only
  when you click the button. Conversion is slow: expect minutes for a 30 s
  1080p clip, and it is not recommended on phones. On desktop you can do the
  same with `ffmpeg -i race.webm -c:v libx264 -pix_fmt yuv420p -c:a aac race.mp4`.
- **Cover image.** A 1080×1920 PNG of the current frame, or of the start,
  middle or finish (re-simulated deterministically), with optional text such
  as “WHO WILL WIN?”.
- Keep the tab visible while recording. Browsers stop drawing hidden tabs.

### Browser support

| | Simulation | Sound | Recording |
| --- | --- | --- | --- |
| Chrome / Edge (desktop) | yes | yes | WebM (VP9/VP8 + Opus); MP4 on recent versions |
| Firefox (desktop) | yes | yes | WebM (VP8/VP9 + Opus) |
| Safari 14.1+ (macOS/iOS) | yes | yes | MP4 where MediaRecorder supports it |
| Mobile Chrome (Android) | yes | yes | usually WebM; performance varies by device |

When recording is not possible, the panel explains why and the simulation keeps
working. Audio starts after the first click or tap, because of browser autoplay
rules.

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
  Game.js                  state machine + presentation timeline
  GameLoop.js              rAF driver
  Share.js                 URL <-> config
js/physics/                Collision.js, SpatialGrid.js (broadphase), Vector.js
js/entities/               Contestant, Wall/Bumper, Barrier, Weapon, FinishZone, DangerZone
js/generation/
  RouteGenerator.js        route skeleton + shape classification
  SectionTemplates.js      section templates with fit checks
  LevelGenerator.js        full pipeline + retries
  CourseField.js           configuration space, geodesic fields, flow
  LevelValidator.js        structural checks + race verdict
  EntertainmentEvaluator.js
  RaceFinder.js            "generate interesting race"
js/rendering/              Renderer.js, Camera.js, Particles.js (pooled)
js/audio/                  AudioEngine.js (graph, throttling), Sounds.js (synthesis)
js/recording/              Recorder.js, VideoExporter.js, WebmDuration.js
js/ui/                     CreatorPanel.js, StatsPanel.js
js/dev/                    SelfTests.js, DevTools.js (testSeeds)
vendor/ffmpeg/             ffmpeg.wasm wrapper (MIT), loaded on demand
tests/                     run-tests.mjs, stress.mjs, viz.html
```

Game states: `IDLE → GENERATED → COUNTDOWN → RUNNING → FINISHED`. `REPLAY` and
`RECORDING` are session modes layered on the running race and are shown in the
header badge.

The simulation modules have no DOM dependency. The same code runs the on-screen
race, the headless validation run, the interesting-race search, the Node tests
and cover-frame re-simulation.

## Testing

`node tests/run-tests.mjs` (and **Developer → Run self-tests** in the page) checks:

- same seed → same map, same winner and duration, same event timeline
- results independent of frame rate (30 / 59.94 / 144 fps)
- different seeds → different maps and routes
- racers cannot pass through a thin wall even at 6× speed
- colour barriers break only for their colour; grey blocks accept every colour
- orphaned colour barriers turn neutral
- blade ownership, and an armed collision eliminates the target
- the purple field eliminates racers
- finish detection ends a *First wins* race
- recording-support detection handles browsers without canvas capture, MediaRecorder or codecs
- structural validation of 120 generated maps across presets

`testSeeds(count)` (developer panel, `race.testSeeds(1000)` in the console, or
`tests/stress.mjs`) reports valid/invalid maps, generation retries, average
duration, stuck races, no-winner races, wins per colour (fairness), kills,
blade pickup rate and average entertainment score. Use it when tuning the
generator.

## Known limitations

- Recording is real-time: a 30 s race takes 30 s to record, in a visible tab.
- `MediaRecorder` bitrate and frame pacing depend on the machine. Low-end
  phones may drop frames in the video (the simulation itself is unaffected).
- MP4 conversion with ffmpeg.wasm is heavy (31 MB download, single-threaded).
- Determinism is guaranteed within a JavaScript engine, not across engines.
- The purple front is drawn on a 4 px grid, which gives it a slightly stepped
  edge by design.

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
