import { defineComponentConfig } from '@keenmate/web-components-devkit/vite';

// Ports, lib output (dist/web-treeview.js + .umd.js + web-treeview.css, rolled-up .d.ts,
// sourcemaps), build-time constants and the examples site come from package.json#kmwc.
// web-components-core and flexsearch are bundled so the UMD build is drop-in.
export default defineComponentConfig({
  overrides: {
    // Dev dep-scan only the real pages and the e2e fixtures — not test-results/ etc.
    optimizeDeps: { entries: ['index.html', 'examples-*.html', 'test/*.html'] },
  },
});
