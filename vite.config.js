import { defineConfig } from 'vite';

// GitHub Pages 는 /Hexle/ 아래에 올라간다
export default defineConfig({ base: process.env.GITHUB_ACTIONS ? '/Hexle/' : '/' });
