export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getConfig } = await import("@/config/env");
    try {
      getConfig();
    } catch (error) {
      console.error(error);
      // next dev already stops on its own; next start would otherwise keep serving requests that
      // all 500.
      if (!process.env.VERCEL) process.exit(1);
    }
  }
}
