# map-build

Builds csbot's map geometry from the CS2 map files installed on this PC and writes it to
`packages/engine/src/maps/geo/<map>.ts`. The app ships that output; users' copies of csbot never
read game files.

```
node tools/map-build/src/build.ts            # all seven maps
node tools/map-build/src/build.ts de_dust2   # one map
node tools/map-build/src/inspect.ts de_dust2 # zones, arrival times, and a check of the map's plays
```

`CSBOT_CS2_DIR` overrides the game folder (default: Steam's `…/Counter-Strike Global Offensive/game/csgo`).
Previews of each map (floor, zones, labels, arrival times, walking graph) land in `tools/map-build/out/`.

## What it reads (read-only)

From `game/csgo/maps/<map>.vpk`:

- **Nav mesh** (`maps/<map>.nav`). This is the walkable floor as polygons, plus their connections.
- **Callout volumes** (`env_cs_place` entities in `entities/default_ents.vents_c`, with their brush
  models). These are the place names CS2 shows next to player names, e.g. "LongA" or "TopofMid".
- **Bomb sites** (`func_bomb_target`) and **spawn points** (`info_player_terrorist` and
  `info_player_counterterrorist`).

The parsers follow [ValveResourceFormat](https://github.com/ValveResourceFormat/ValveResourceFormat)
and [awpy](https://github.com/pnxenopoulos/awpy) (both MIT):

- `vpk.ts` reads the package.
- `kv3.ts` decodes binary KeyValues3 v2–v5, including LZ4 and Zstandard.
- `nav.ts` reads nav meshes v31–36.

This is static map data read at build time on the developer's PC. It is not game memory, and the
build never runs during a match.

## What it makes

- **Zones**: callout volumes, some merged into one intel zone (see `src/config.ts`). Each nav area
  takes the callout that holds its centre.
- **Floor and zone outlines**: the nav areas drawn into a 500×500 raster, traced and simplified into
  SVG paths. Map units are 0..1000 with north up. Nuke's lower level is drawn below the main one.
- **Lookup grid**: the zone in each cell of a 250×250 grid, used for clicks and the heat mask.
- **Earliest arrival** for each zone from each team's spawns, in seconds at knife-out speed (250 u/s).
- **Walking graph**: one node per zone (its hub), the two spawns, and the portals where zones meet,
  plus the fastest walk between nodes of the same zone. The engine walks this graph to turn a plan's
  zone list into a timed route.

Paths run along the shared edges between nav areas, then get pulled straight along the floor, so
times match real walking distances rather than zigzags between nav triangles.

Enemy plans and our playbooks are written by hand in `packages/engine/src/maps/plays/`. They use
the zone ids printed by `inspect.ts`, and the checks in `packages/engine/src/maps/validate.ts`
apply to them.

## After a CS2 map update

Run the build again, then check:

- the previews in `out/`
- `git diff` of the generated files
- the engine tests, which check every map's geometry and plays
