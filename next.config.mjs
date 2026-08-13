/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: {
    // Never ship a build that does not typecheck — financial types are the safety net.
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
  async redirects() {
    return [
      {
        source: "/",
        destination: "/dashboard",
        // 307, not 308. A permanent redirect is cached hard by browsers and is
        // painful to undo — and the root is the obvious place a marketing or
        // landing page would go later.
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
