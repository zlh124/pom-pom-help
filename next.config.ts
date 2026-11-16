import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // node:sqlite 是 Node 24 内置模块，不需要打包
  serverExternalPackages: [],
  // 3D 模型/贴图较大，关闭对静态资源的严格优化
  experimental: {},
};

export default nextConfig;
