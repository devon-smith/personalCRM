import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  turbopack: {
    root: __dirname,
  },
  async redirects() {
    return [
      { source: "/", destination: "/dashboard", permanent: false },
      { source: "/home", destination: "/dashboard", permanent: false },
      { source: "/queries", destination: "/ask", permanent: false },
      { source: "/source-health", destination: "/integrations", permanent: false },
    ];
  },
};

export default nextConfig;
