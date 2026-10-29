/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    const rawApiUrl =
      process.env.NEXT_PUBLIC_API_URL ||
      (process.env.CI ? "http://localhost:8000" : "");
    const apiUrl = rawApiUrl?.replace(/\/$/, "");

    if (process.env.NODE_ENV === "production" && !apiUrl && !process.env.CI) {
      throw new Error(
        "NEXT_PUBLIC_API_URL is required in production (e.g., https://your-backend.onrender.com)"
      );
    }

    if (!apiUrl) {
      return [];
    }

    return [
      {
        source: "/api/:path*",
        destination: `${apiUrl}/api/:path*`,
      },
      {
        source: "/health/:path*",
        destination: `${apiUrl}/health/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
