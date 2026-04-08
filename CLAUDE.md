# citygame

A 3D European-style city driving game built with Three.js and TypeScript.

## Tech Stack

- **Three.js** (^0.183.2) — 3D rendering, WebGL
- **TypeScript** — strict typing
- **Vite** — dev server and bundler

## Commands

```bash
npm run dev      # start dev server (check this first before running build)
npm run build    # tsc + vite build
npm run preview  # preview production build
```

## Architecture

### Entry Point
- `src/main.ts` — creates `Game`, registers systems in dependency order, calls `game.start()`

### Core
- `src/core/Game.ts` — `Game` class: scene, camera, renderer, clock; `GameSystem` interface with `init/update/dispose`

### Systems (`src/systems/`)
Systems are registered via `game.addSystem()` and run in registration order.

| System | name key | Purpose |
|--------|----------|---------|
| `SceneSystem` | `'scene'` | Lighting, fog, shadow camera tracking |
| `InputSystem` | `'input'` | Keyboard state, pointer lock |
| `CarSystem` | `'player'` | Car physics, collision, camera spring-arm |
| `CityBuilder` | `'city'` | Procedural city generation, merged geometry |
| `MinimapSystem` | `'minimap'` | 2D canvas overlay minimap (bottom-right) |
| `CloudSystem` | `'clouds'` | Animated cloud layer |
| `PlayerSystem` | `'player'` | Unused first-person walker (alternative to CarSystem) |

### City (`src/city/`)
- `CityLayout.ts` — `generateCityLayout(gridX, gridZ, seed)` → `CityLayoutData` with `blocks[]`, `streets[]`, `sidewalks[]`, `totalWidth`, `totalDepth`
- `CityBuilder.ts` — consumes layout, builds merged Three.js geometry (~8 draw calls total); exposes `layout` publicly for other systems
- `BuildingFactory.ts` — per-building geometry and vertex color helpers

### Key Design Decisions
- **Merged geometry**: all buildings merged into ~8 meshes for minimal draw calls
- **AABB collision**: `CarSystem` registers building boxes; sliding collision on X/Z independently
- **Seed-based generation**: `CITY_SEED = 42` in `main.ts` for reproducible layouts (12×12 grid)
- **System dependency order matters**: `MinimapSystem` must come after `CityBuilder` (reads `builder.layout` on init)

## Minimap
Rendered as a fixed 180×180px HTML canvas (bottom-right corner). Pre-renders the city once on init, then each frame draws the player dot and heading arrow on top.
