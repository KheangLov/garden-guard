# Garden Guard

A lane-defense game: plant guardians on a lawn and stop Gearax's Bolt-Bots before they reach your
patio. **120 levels in six worlds**, a story told in scenes between worlds, a boss at the end of each
world, 12 plants and 8 kinds of robot. All the art is 3D, built in code: no image or model files.

- **Khmer and English**: Khmer by default, with Khmer digits.
- **Made for phones**: tap a seed then a tile, or drag a seed onto the lawn; tap dew to collect it
  (or turn on auto-collect). Keyboard: 1–8 seeds, S shovel, F double speed, Space pause.
- **Stars**: one for clearing a level, one for using no garden cart, one for losing no plants.
- **Saved on the device**: progress, stars and settings stay in the browser (localStorage).
- **Installable and offline**: once opened, it plays with no connection.
- **Plays inside the [gaming gateway](https://github.com/KheangLov/gaming-gateway)**, loaded with
  Module Federation (`modules/gateway-remote/`, the same folder as in the other games).

Built with Nuxt 4, Nuxt UI, [three.js](https://threejs.org) and [Motion for Vue](https://motion.dev/docs/vue) for interface animation.

## How it's built

- **The rules are separate from the drawing** (`shared/game/engine.ts`): a plain TypeScript engine,
  stepped at a fixed 60 steps a second (120 at double speed), emits events (shots, hits, waves) that
  drive the effects, sounds and top bar. Deterministic, so tests play whole levels.
- **The garden is real 3D, in plain three.js** (`app/game/three/`): the lawn seen from the front and
  above, with soft shadows, the house and its garden carts on the left and the street on the right;
  shaded models of every plant, robot, shot and dew drop built from shapes in code (`models.ts`),
  with textures painted in code (nothing to download, so it works offline). Night worlds are lit by
  the moon and lanterns, fog drifts over the far columns, rain falls in the storm. The camera fits
  the garden to any screen and turns it so robots come up the screen on phones held upright.
  Health bars are HTML laid over the canvas; taps and dragged seeds are turned back into board
  points for the engine. Everything that never moves is merged into a few meshes. Settings →
  high-quality graphics turns shadows and sharp pixels off for older phones.
- **The interface uses the same models**: each is rendered once into a picture (`icons.ts`) for the
  seed cards, briefings and story; the menus have the garden turning slowly behind them.
- **Vue stays out of the frame loop**: the seed cards' recharge sweep is written straight to the
  cards, and the top bar's values update only when they change.
- **Sound and music are synthesised** with Web Audio: no audio files to download.

## Development

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

| Command | What it does |
|---|---|
| `pnpm dev` | Dev server |
| `pnpm lint` / `pnpm lint:fix` | ESLint (includes code style) |
| `pnpm typecheck` | Type-check the app and the unit tests |
| `pnpm test` | Unit tests (`test/unit`: levels, engine, a simple player that plays all 120 levels) and Nuxt tests (`test/nuxt`) |
| `pnpm build` | Production build (Cloudflare Workers; Vercel's preset on Vercel) |
| `pnpm build:federation` | The gaming gateway's remote (`/mf/remoteEntry.js`), copied into the site's build |
| `pnpm run deploy` | Build both and deploy to Cloudflare |
| `pnpm layout [base URL] [folder]` | Screenshots at four screen sizes in both languages, failing on sideways scrolling or a board that doesn't fit |
| `pnpm icons [chromium]` | Regenerate the PNG icons from `public/icon.svg` |

## Project layout

```
shared/game/      The game: sprites, plants and robots (data.ts), the 120 levels (levels.ts), the story, the engine
app/game/         The canvas renderer and the synthesised audio
app/pages/        Home, levels (/map), and a level (/play/<n>)
app/components/   Story scenes, the board, seed bar, briefing and result, settings
app/stores/       Progress and settings, saved in localStorage
modules/          gateway-remote: the gaming gateway's Module Federation remote
test/             unit/ and nuxt/ tests (test/unit/helpers/autoplay.ts is the balancing player)
```

## Levels and balance

Levels are generated from their number with a seeded random generator (`shared/game/levels.ts`), so
they're the same everywhere. Each world has teaching levels for its new plants and robots, two last
stands (lots of dew, no producers), a rush hour and a boss. The worlds add night (no dew from the sky),
fog, rubble and a storm. Tuning numbers are in `shared/game/data.ts`; after changing them, run
`pnpm test`: the simple player must still win at least 110 of the 120 levels, every first-world level
and every boss.

## Deploying

- **Vercel**: import the repository; `vercel.json` builds the site and the gateway remote.
- **Cloudflare Workers**: `pnpm run deploy`, or push to `main` with the `CLOUDFLARE_API_TOKEN` and
  `CLOUDFLARE_ACCOUNT_ID` secrets set.

Then set the game's `siteUrl` in the gateway's registry entry (`garden-guard` in
`app/games/registry.ts`) to the deployed address.

## Credits

- Fonts: [Kantumruy Pro](https://fonts.google.com/specimen/Kantumruy+Pro) and [Koulen](https://fonts.google.com/specimen/Koulen) (SIL Open Font License 1.1), bundled via Fontsource
- Icons: [Lucide](https://lucide.dev) (ISC License)
- An original game in the lane-defense genre; all characters, art, names and story are its own.
