// Fails the build on an invalid environment. Run automatically as the
// "prebuild" script (see package.json) so `pnpm build` — and therefore a
// Vercel build, whose env vars are available at build time — fails with a
// clear message instead of shipping a build that 500s on every request.
// Usage: tsx --env-file-if-exists=.env.local --conditions=react-server scripts/check-env.ts
import { ConfigError, parseConfig } from "@/config/env";

try {
  parseConfig(process.env);
} catch (error) {
  console.error(error instanceof ConfigError ? error.message : error);
  process.exit(1);
}
