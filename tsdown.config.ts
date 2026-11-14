import { defineConfig } from 'tsdown';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  entry: { index: 'src/index.ts', testing: 'src/testing/index.ts' },
  format: ['esm', 'cjs'],
  platform: 'neutral',
  target: 'es2022',
  dts: true,
  sourcemap: true,
  clean: true,
  define: { __ARBOX_SDK_VERSION__: JSON.stringify(pkg.version) },
});
