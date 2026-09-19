"use client";

import { useEffect } from "react";
import { ensureSession } from "@/lib/session-ready";

export function SessionBootstrap() {
  useEffect(() => {
    void ensureSession();
  }, []);
  return null;
}
