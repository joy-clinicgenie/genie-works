import nextConfig from "eslint-config-next";

const config = [...nextConfig, { ignores: [".next/**", ".next-*/**", "node_modules/**"] }];

export default config;
