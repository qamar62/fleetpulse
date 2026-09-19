/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emit .next/standalone: a self-contained server plus only the packages it
  // imports, which is what the production Docker image runs.
  output: 'standalone',
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
