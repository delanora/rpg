import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Em desenvolvimento o frontend roda no Vite (porta 5173) e repassa
 * `/api` e `/socket.io` para o backend Node (porta 3000), evitando CORS.
 *
 * Em produção não existe proxy: o Express serve o build do client na mesma
 * origem, então os caminhos relativos continuam funcionando.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // permite acessar pelo IP da máquina
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:3000', ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
