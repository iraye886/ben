import { config as loadEnv } from "dotenv";
import path from "node:path";

// `pnpm --filter` runs this package's scripts with the package directory as
// cwd, so dotenv's default (cwd-relative) lookup misses the repo-root env
// files. Load them explicitly, without overriding real process env vars.
//
// This must be the FIRST import in `index.ts` — ES module imports execute
// before any of the importing module's own top-level code, so env vars
// have to be loaded from a dedicated side-effect module rather than from
// statements placed after other imports (like `./app`, which reads env
// vars such as DATABASE_URL at import time).
const repoRoot = path.resolve(import.meta.dirname, "../../../");
loadEnv({ path: path.join(repoRoot, ".env.development.local") });
loadEnv({ path: path.join(repoRoot, ".env") });
