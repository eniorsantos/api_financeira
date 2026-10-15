import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
// O front só fala com /api (proxy). O token da brapi NUNCA chega ao navegador.
export default defineConfig({ plugins: [react()], server: { proxy: { "/api": "http://localhost:3333" } } });
