import nextConfig from "eslint-config-next";

export default [...nextConfig, { ignores: [".next/**", ".next-audit/**", "node_modules/**"] }];
