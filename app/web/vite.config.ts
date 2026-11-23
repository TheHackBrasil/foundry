import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// A web chama só /api/* no mesmo domínio. Em dev o Vite repassa ao servidor;
// em produção o Fastify serve o build e a rota é a mesma.
const API = process.env['VITE_API_URL'] ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': API } },
  preview: { port: 4173, proxy: { '/api': API } },
});
