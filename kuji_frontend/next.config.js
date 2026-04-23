/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Kuji 前端掛在 nginx 的 /kuji/* 路徑下；讓 Next.js 生成的 asset URL 也帶 prefix
  basePath: "/kuji",
};

module.exports = nextConfig;
