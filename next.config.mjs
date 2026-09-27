import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["pdf-parse", "mammoth"],
  experimental: { serverActions: { bodySizeLimit: "20mb" } },
  webpack(config) {
    // Alias eksplisit: resolusi "paths" tsconfig kadang gagal di Windows (path dengan spasi).
    config.resolve.alias["@"] = path.join(root, "src");
    return config;
  },
};
export default nextConfig;
