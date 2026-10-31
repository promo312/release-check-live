import { defineConfig } from 'vite';
export default defineConfig({ build: { target: 'es2022' }, server: { hmr: { port: 5174, host: '127.0.0.1' } } });
