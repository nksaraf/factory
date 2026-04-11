# TraffiCure

AI-powered traffic intelligence platform

## Tech Stack

- **Framework**: [Vinxi](https://vinxi.vercel.app/) ([Vite](https://vite.dev) and Nitro) with React 19 and React Router
- **UI Library**: Rio.js UI components (`@rio.js/ui`)
- **Styling**: Tailwind CSS 3
- **Language**: TypeScript 5.8
- **State Management**: TanStack React Query
- **Maps**: Mapbox GL, Google Maps, Lepton Maps
- **GIS**: Rio.js GIS libraries (`@rio.js/gis`, `@rio.js/gdal`)
- **API Routes**: Powered by H3 and Nitro
- **Auth**: Better Auth with Supabase/GoTrue
- **Testing**: Playwright
- **Deployment**: Vercel/Anywhere

## Prerequisites

- **Node.js**: 20.x or higher
- **pnpm**: 9.x or higher
- **Git**: For version control

### Google Artifact Registry Access

This project uses private packages from Google Artifact Registry. Before installing dependencies, you need to set up your environment with the required service account credentials.

#### Service Account Configuration

Create a `.env` file in the root directory of the project and add your Google Cloud Platform (GCP) service account credentials:

```bash
PRIVATE_GCP_SERVICE_ACCOUNT=<base64-encoded-service-account-json>
```

The `PRIVATE_GCP_SERVICE_ACCOUNT` should be a base64-encoded JSON string of your GCP service account key file. This service account is used to authenticate with Google Artifact Registry for accessing private npm packages. You can get this from one of the other engineers on the team.

**Note:** If you need to publish packages or make updates to the registry, you'll need a service account with publish access. For read-only access (installing packages), a service account with read permissions is sufficient.

**To encode your service account JSON file:**

```bash
# On macOS/Linux
cat path/to/service-account.json | base64 | tr -d '\n' > encoded.txt

# Or using Node.js
node -e "console.log(require('fs').readFileSync('path/to/service-account.json').toString('base64'))"
```

Copy the base64-encoded string and add it to your `.env` file as shown above.

#### NPM Credentials Setup

After setting up the `.env` file, run the npm setup script to configure your npm credentials for accessing the private registry:

```bash
npx vinxi run scripts/setup-npm.ts
```

This script will:

- Decode the base64-encoded service account from your `.env` file
- Authenticate with Google Artifact Registry
- Configure your `.npmrc` file with the necessary registry settings and authentication token

## Getting Started

### 1. Clone the repository

```bash
git clone <repository-url>
cd trafficure
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Environment configuration

The app uses a typed environment schema defined in `app.settings.ts`. Default values are provided for development. To override, create a `.env` file:

```bash
# Example overrides (most have defaults in app.settings.ts)
PUBLIC_APP_NAME=SmartMarket
PRIVATE_DATABASE_URL=postgresql://...
```

### 4. Start development server

```bash
pnpm dev
```

The app will be available at `http://localhost:3000`.

## Project Structure

```
trafficure/
├── app.config.ts        # Vinxi app configuration (routers, plugins)
├── app.settings.ts      # Environment schema with Zod validation
├── tailwind.config.cjs  # Tailwind CSS configuration
├── tsconfig.json        # TypeScript configuration
├── public/              # Static assets (fonts, images, favicon)
├── scripts/             # Build/initialization scripts
└── src/
    ├── entry.client.tsx # Client-side React entry point
    ├── entry.server.tsx # Server-side rendering entry point
    ├── middleware.ts    # Server middleware (CSP, auth)
    ├── bootstrap.ts     # Rio.js client initialization
    ├── globals.css      # Global styles and Tailwind imports
    ├── lib/             # Shared utilities
    │   ├── rio.ts       # Rio client singleton
    │   └── enterprise-db.ts
    ├── docs/            # MDX documentation pages
    ├── modules/         # Feature modules
    │   └── trafficure.core/  # Main app module
    │       ├── extension.ts
    │       ├── manifest.json
    │       └── (app)/(dashboard)/command-center/  # Main dashboard
    └── routes/          # File-based routing
        ├── (marketing)/ # Landing pages
        │   ├── page.tsx
        │   └── components/
        └── api/         # API routes
            └── auth/    # Authentication endpoints
```

## Available Scripts

| Command              | Description                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`           | Start development server with hot reload                                                                             |
| `pnpm build`         | Build for production                                                                                                 |
| `pnpm start`         | Run production build                                                                                                 |
| `pnpm openapi:fetch` | Download OpenAPI spec from data service (set `OPENAPI_SPEC_URL` or uses `http://localhost:8084/api/v1/data/openapi`) |
| `pnpm openapi-ts`    | Generate API client + TanStack Query hooks from `openapi.json` into `src/client`                                     |

### OpenAPI codegen (TanStack Query)

The app uses [@hey-api/openapi-ts](https://heyapi.dev/openapi-ts) with the [TanStack Query plugin](https://heyapi.dev/openapi-ts/plugins/tanstack-query) to generate a type-safe API client and React Query hooks from your OpenAPI spec.

1. **Get the spec**: With the data service running (`task dev -- services` from repo root), run `pnpm openapi:fetch` to save the spec as `openapi.json`. Or point at another URL with `OPENAPI_SPEC_URL`.
2. **Generate client**: Run `pnpm openapi-ts`. Output is written to `src/client` (SDK, types, `*Options` / `*Mutation` for `useQuery` / `useMutation`).
3. **Use in components**: `import { getXOptions } from '@/client'; useQuery({ ...getXOptions({ path: { id } }) });`

## Key Configuration Files

### `app.config.ts`

Configures Vinxi routers:

- **Public router**: Static assets
- **API router**: Server-side API endpoints (`/api/*`)
- **React Client router**: Client-side rendering with MDX support
- **React Server router**: SSR with middleware
- **Server Functions router**: RPC-style server functions

### `app.settings.ts`

Typed environment configuration using Zod schemas. Divided into:

- **PUBLIC**: Client-accessible variables (API URLs, keys)
- **PRIVATE**: Server-only variables (database URLs, secrets)

### Path Aliases

```typescript
@/           → ./src/
~/           → ./
@/components/ui → @rio.js/ui/components
```

## Architecture Overview

### Rio.js Framework

The app is built on the Rio.js ecosystem which provides:

- **@rio.js/client**: Core client with service registration
- **@rio.js/enterprise**: Authentication, workspaces, multi-tenancy
- **@rio.js/gis**: Geographic information system capabilities
- **@rio.js/gdal**: Geospatial data processing (GeoJSON, Parquet, TIFF)
- **@rio.js/agents**: AI agent infrastructure
- **@rio.js/workflows**: Workflow automation

### Modules System

Features are organized as "modules" with:

- `manifest.json`: Module metadata and configuration
- `extension.ts`: Module initialization and hooks
- Route directories for pages

### Authentication Flow

1. Landing page (`/`) checks for existing session
2. Authenticated users redirect to `/command-center`
3. Auth handled via Better Auth with Supabase backend

## Development Workflow

### Adding a new page

1. Create a new file in `src/routes/` following the file-based routing convention
2. Export a default React component and optionally a `loader` function

### Adding API endpoints

1. Create files in `src/routes/api/`
2. Export handler functions (`GET`, `POST`, etc.)

### Working with GIS data

```typescript
import { RioClient } from "@rio.js/client"

const rio = RioClient.instance
const gisService = rio.services.get("gis")
// Use gisService for map operations
```

## Testing

```bash
# Run Playwright tests
npx playwright test
```

Configuration is in `playwright.config.ts`.

## Deployment

### Vercel (Recommended)

```bash
pnpm deploy       # Preview deployment
pnpm deploy:prod  # Production deployment
```

### Docker

```bash
docker-compose up
```

See `docker-compose.yaml` for configuration.

## Documentation Links

### Core Technologies

- [Vinxi Documentation](https://vinxi.vercel.app/)
- [React 19 Documentation](https://react.dev/)
- [TanStack Query](https://tanstack.com/query/latest)
- [Tailwind CSS](https://tailwindcss.com/docs)
- [TypeScript](https://www.typescriptlang.org/docs/)

### Mapping & GIS

- [Mapbox GL JS](https://docs.mapbox.com/mapbox-gl-js/)
- [Google Maps Platform](https://developers.google.com/maps/documentation)
- [Turf.js (Geospatial Analysis)](https://turfjs.org/)
- [Deck.gl (Large-scale Data Viz)](https://deck.gl/)

### Authentication & Backend

- [Supabase Documentation](https://supabase.com/docs)
- [Better Auth](https://www.better-auth.com/)

### Testing & Deployment

- [Playwright](https://playwright.dev/)
- [Vercel](https://vercel.com/docs)

## Troubleshooting

### Memory issues during build

The build uses increased memory allocation:

```bash
NODE_OPTIONS=--max-old-space-size=16384
```

### Package installation fails

Ensure you've set up your service account in the `.env` file and run the npm setup script:

```bash
npx vinxi run scripts/setup-npm.ts
```

### Type errors with Rio.js packages

Path aliases are configured in `tsconfig.json`. Ensure your IDE uses the workspace TypeScript version.
