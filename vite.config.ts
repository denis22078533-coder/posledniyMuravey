import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 9000,
    watch: {
      ignored: ['**/node_modules/**', '**/dist/**']
    },
    host: "0.0.0.0",
    allowedHosts: true,
    hmr: {
      timeout: 7000,
      overlay: false, // Disables the error overlay if you only want console errors
    },
  },
});
