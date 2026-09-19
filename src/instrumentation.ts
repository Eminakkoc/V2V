export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getConfig } = await import("@/config/env");
    try {
      getConfig();
    } catch (error) {
      console.error(error);
      // next dev already stops on its own; next start only logs and keeps
      // serving requests that all 500 (Vercel is covered separately by the
      // prebuild env check, which fails the build before it ships).
      if (!process.env.VERCEL) process.exit(1);
    }
  }
}
