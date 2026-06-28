/** @type {import('next').NextConfig} */
const nextConfig = {
  // sql.js is used for SQLite in API routes — no native binary needed
  serverExternalPackages: ['sql.js'],
};

export default nextConfig;
