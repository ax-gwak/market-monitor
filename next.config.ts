import type { NextConfig } from "next";

// SSL 검사 프록시 환경에서 Yahoo Finance 접속을 위해 설정
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const nextConfig: NextConfig = {};

export default nextConfig;
