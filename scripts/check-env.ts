// Fails the build on an invalid environment, run automatically as the "prebuild" script so a
// misconfigured deploy never ships.
import { ConfigError, parseConfig } from "@/config/env";

try {
  parseConfig(process.env);
} catch (error) {
  console.error(error instanceof ConfigError ? error.message : error);
  process.exit(1);
}
