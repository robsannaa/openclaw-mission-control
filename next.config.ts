import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
