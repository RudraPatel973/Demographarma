import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native (FFI) SDK: load with Node's require instead of bundling
  serverExternalPackages: ["@smartspectra/node-sdk", "koffi"],
};

export default nextConfig;
