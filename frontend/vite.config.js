import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // ONNX Runtime locates its .wasm file relative to its own module URL.
    // Vite's dependency pre-bundling moves the module and breaks that lookup
    // in dev, so it is served as-is instead. Production builds are unaffected.
    exclude: ['onnxruntime-web'],
  },
})
