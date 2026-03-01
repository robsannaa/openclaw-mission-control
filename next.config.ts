import path from "node:path";
import { execSync } from "node:child_process";
import type { NextConfig } from "next";

function git(cmd: string): string {
  try {
    return execSync(`git ${cmd}`, { encoding: "utf-8", timeout: 5000 }).trim();
  } catch {
    return "";
  }
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: git("describe --tags --always") || "dev",
    NEXT_PUBLIC_COMMIT_HASH: git("rev-parse --short HEAD") || "unknown",
  },
  // Ensure modules resolve from project root (avoids HOME being used as context)
  webpack: (config, { dir }) => {
    config.resolve.modules = [
      path.join(dir, "node_modules"),
      ...(Array.isArray(config.resolve.modules) ? config.resolve.modules : ["node_modules"]),
    ];
    return config;
  },
};

export default nextConfig;
