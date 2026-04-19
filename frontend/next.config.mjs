/** @type {import('next').NextConfig} */
const nextConfig = {
  trailingSlash: true,
  async rewrites() {
    return [
      {
        source: '/api/:path*/',
        destination: 'http://web:8000/api/:path*/',
      },
      {
        source: '/api/:path*',
        destination: 'http://web:8000/api/:path*/',
      },
    ]
  },
};

export default nextConfig;
