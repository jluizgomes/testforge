Build the TestForge application for production.

Arguments: $ARGUMENTS — optional: `frontend` (Vite only), `electron` (full Electron app), `docker` (Docker image), or empty for frontend only.

**Frontend only** (`npm run build:frontend`):
```bash
cd /Users/jluizgomes/Documents/Projetos/testforge
npm run typecheck 2>&1 | tail -5
npm run build:frontend 2>&1
```

**Electron desktop app** (`npm run electron:build`):
```bash
cd /Users/jluizgomes/Documents/Projetos/testforge
npm run electron:build 2>&1
```
Output goes to `release/` directory. Show the file sizes of the generated installers.

**Docker image** (backend):
```bash
cd /Users/jluizgomes/Documents/Projetos/testforge
docker compose build backend 2>&1
docker images | grep testforge
```

**Pre-build checks** (always run first):
```bash
# 1. Type check
npx tsc --noEmit 2>&1 | head -20

# 2. Lint
npx eslint . --ext ts,tsx --max-warnings 0 2>&1 | tail -10
```

**If type check fails**, stop and show the errors — don't proceed with build.

**After successful build, show**:
- Output directory and file sizes
- Build time
- For `frontend`: `dist/` contents with sizes
- For `electron`: `release/` with the DMG/EXE/AppImage paths

**Common build failures and fixes**:
- `Cannot find module` → run `npm install`
- TypeScript errors → run `/typecheck` to see all errors
- `electron-builder` missing → `npm install electron-builder --save-dev`
