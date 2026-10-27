import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  // Prepare the lazy Excel dependency before a first export can trigger a dev reload.
  optimizeDeps: { include: ['write-excel-file/universal'] },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/jspdf')) return 'pdf';
          if (id.includes('/node_modules/react') || id.includes('/node_modules/scheduler/'))
            return 'react';
        },
      },
    },
  },
});
