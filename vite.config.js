import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // 方便用手机在局域网访问调试
    port: 5173,
  },
});
