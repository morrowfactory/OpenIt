# OpenIt

OpenIt is a browser-based file preview and sharing platform for CAD, 3D models, drawings, documents, archives, and email files.

Try it at [openit.cc](https://openit.cc), or self-host it on your own server if you want a private deployment.

## Features

- CAD and 3D preview for STP, STEP, STL, OBJ, 3MF, IGS, IGES, DXF, and DWG files.
- STEP/IGES WASM and DWG font data are served from same-origin, versioned build assets. CAD text uses OFL-1.1 Noto fonts rather than redistributed system fonts.
- Document and media preview for images, video, PDF, Word, Excel, CSV, Markdown, text, and code files.
- Archive inspection and extraction for ZIP, RAR, and 7z files.
- Email file preview for EML and MSG files.
- User registration, admin review, personal file library, favorites, and share links.
- Chunked upload with cancellation, retry handling, and resumable upload support.
- PM2 and ops scripts for production deployment.
- A documented production runtime using the `openit` PM2 process name.

## What Should OpenIt Open Next?

Tell us which file types you still want to open in the browser.

Open an issue or pull request, share your use case, and help shape the next release.

## Tech Stack

- Frontend: React 19, Vite 7, Tailwind CSS 4, shadcn/ui
- Backend: Express 4, tRPC 11
- Database: MySQL-compatible database with Drizzle ORM
- Runtime: Node.js 22
- Package manager: pnpm

## Getting Started

Prerequisites:

- Node.js 22 or newer
- pnpm 10.x, or Corepack enabled with the version from `packageManager`
- A MySQL-compatible database for account, file, and share metadata
- A compatible storage proxy for persistent upload/share workflows

Install dependencies:

```bash
pnpm install
```

Create local configuration:

```bash
cp .env.example .env.local
```

Fill the required values in `.env.local`, especially `DATABASE_URL`, `JWT_SECRET`, and the storage proxy variables if upload persistence is needed.

Run database migrations:

```bash
pnpm db:push
```

Start development:

```bash
pnpm dev
```

Build and run production locally:

```bash
pnpm build
pnpm start
```

## Scripts

- `pnpm dev` starts the Express and Vite development server.
- `pnpm build` builds the frontend and bundles the backend entry.
- `pnpm start` runs the production server from `dist/index.js`.
- `pnpm check` runs TypeScript type checking.
- `pnpm test` runs the Vitest test suite.
- `pnpm test:cargo` runs the Cargo solver, safety, rendering, and layout regression tests.
- `pnpm format` formats the repository with Prettier.
- `pnpm db:push` generates and applies Drizzle migrations.

## Cargo loading planner

`cargo/index.html` provides the planner at `/cargo/`. The packing algorithm is maintained in readable modules under `cargo/solver/`; the existing asset bundle provides the Three.js viewer. Both are deployed by the OpenIt GitHub workflow.

The safety baseline checks permitted orientations, complete support, mixed-product stack layers, accumulated top loads, pallet quantity, total height including the pallet, pallet spacing and container payload. An empty top-load field means **unknown**, not an assumed load capacity. The load-transfer model distributes weight by contact area; it does not certify packaging strength, vehicle dynamics or lashing.

Reproducible short links retain the input conditions and result summary. Old links without product top-load data now restore that field as unknown. Changes to safety rules can intentionally reduce loaded counts in previously unsafe plans.

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for the production process, PM2 naming, and historical aliases.

## Environment

Use `.env.example` as the template for local and production configuration. Do not commit real `.env` files, database URLs, API keys, JWT secrets, or server credentials.

Important variables:

- `DATABASE_URL`: MySQL-compatible connection string.
- `JWT_SECRET`: secret used for auth/session signing.
- `OWNER_OPEN_ID`: optional owner/admin identity for OAuth flows.
- `VITE_APP_ID`, `OAUTH_SERVER_URL`, `VITE_OAUTH_PORTAL_URL`: optional OAuth integration settings.
- `BUILT_IN_FORGE_API_URL`, `BUILT_IN_FORGE_API_KEY`: backend storage/proxy credentials.
- `VITE_FRONTEND_FORGE_API_URL`, `VITE_FRONTEND_FORGE_API_KEY`: frontend proxy settings.
- `PORT`: preferred server port, default `3000`.

## Security

This project handles uploaded files and authenticated users, so production deployments should use fresh credentials, a private storage bucket or proxy, HTTPS, strict upload limits, and regular dependency updates. Rotate any credentials that were ever stored outside a secrets manager before publishing or deploying.

## License

MIT. See [LICENSE](LICENSE).
