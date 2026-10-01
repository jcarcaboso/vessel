#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

pnpm test:prototype
dotnet restore backend/Vessel.slnx --locked-mode
dotnet build backend/Vessel.slnx --no-restore --configuration Release
dotnet test backend/Vessel.slnx --no-build --configuration Release
pnpm install --frozen-lockfile
pnpm --filter vessel-frontend typecheck
pnpm --filter vessel-frontend lint
pnpm --filter vessel-frontend test
pnpm --filter vessel-frontend build
