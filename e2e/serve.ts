import { spawn, type ChildProcess } from "node:child_process";
import { MongoMemoryServer } from "mongodb-memory-server";
import { E2E_ENV, E2E_PORT } from "./env";

let mongo: MongoMemoryServer | null = null;
let child: ChildProcess | null = null;
let shutdownPromise: Promise<void> | null = null;

// A signal, a crashed server and a failed build all reach here; only the first call tears anything
// down, later ones await the same exit.
function shutdown(code: number): Promise<void> {
  shutdownPromise ??= (async () => {
    child?.kill("SIGTERM");
    await mongo?.stop();
    process.exit(code);
  })();
  return shutdownPromise;
}

function run(args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    child = spawn("pnpm", ["exec", ...args], { env, stdio: "inherit" });
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${args.join(" ")} exited with ${code}`)),
    );
  });
}

async function main() {
  // Registered before any process starts, so a signal during setup still runs shutdown.
  process.on("SIGINT", () => void shutdown(0));
  process.on("SIGTERM", () => void shutdown(0));

  mongo = await MongoMemoryServer.create();
  const env = { ...process.env, ...E2E_ENV, MONGODB_URI: mongo.getUri() };
  const isCi = Boolean(process.env.CI);
  if (isCi) await run(["next", "build"], env);

  // The in-memory database starts with no indexes, so without this the unique-constraint guards
  // would silently no-op.
  await run(["tsx", "--conditions=react-server", "scripts/create-indexes.ts"], env);

  child = spawn("pnpm", ["exec", "next", isCi ? "start" : "dev", "--port", String(E2E_PORT)], {
    env,
    stdio: "inherit",
  });
  child.on("exit", (code) => void shutdown(code ?? 0));
}

main().catch((error: unknown) => {
  console.error(error);
  void shutdown(1);
});
