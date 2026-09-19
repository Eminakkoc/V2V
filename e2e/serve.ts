import { spawn } from "node:child_process";
import { MongoMemoryServer } from "mongodb-memory-server";
import { E2E_ENV, E2E_PORT } from "./env";

function run(args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["exec", ...args], { env, stdio: "inherit" });
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${args.join(" ")} exited with ${code}`)),
    );
  });
}

async function main() {
  const mongo = await MongoMemoryServer.create();
  const env = { ...process.env, ...E2E_ENV, MONGODB_URI: mongo.getUri() };
  const isCi = Boolean(process.env.CI);
  if (isCi) await run(["next", "build"], env);

  const server = spawn(
    "pnpm",
    ["exec", "next", isCi ? "start" : "dev", "--port", String(E2E_PORT)],
    {
      env,
      stdio: "inherit",
    },
  );
  const shutdown = async (code: number) => {
    server.kill("SIGTERM");
    await mongo.stop();
    process.exit(code);
  };
  process.on("SIGINT", () => void shutdown(0));
  process.on("SIGTERM", () => void shutdown(0));
  server.on("exit", (code) => void shutdown(code ?? 0));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
