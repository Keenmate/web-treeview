import { blissAnalyzerConfig, cssVariablesFromManifestPlugin } from '@keenmate/web-components-core/cem';
import { customElementVsCodePlugin } from 'custom-element-vs-code-integration';
import { customElementJetBrainsPlugin } from 'custom-element-jet-brains-integration';

/**
 * web-treeview's ~60 attributes/members/events are declared in the `static inputs`
 * / `static events` tables on `WebTreeViewElement` (invisible to the stock
 * analyzer, which can't statically read them). The core `blissInputsPlugin()` —
 * wired in by `blissAnalyzerConfig()` and run FIRST — reads those tables straight
 * from the AST and injects them, so the manifest stays a single source of truth
 * with the runtime table. The editor-integration generators run after it and see
 * the injected attributes.
 *
 * Core's `cssVariablesFromManifestPlugin()` runs before the editor-integration
 * generators and injects the `--wtv-*` surface (from
 * `component-variables.manifest.json`) as `cssProperties`, so both the VS Code
 * CSS custom-data file and `web-types.json` carry the theming variables.
 */
/**
 * Line endings: a Windows checkout (core.autocrlf) hands the analyzer CRLF sources, so JSDoc and
 * input-row descriptions came out with CRLF and a build on another checkout rewrote the manifests.
 * Fold CRLF / CR to LF in every manifest string before the generators below read it, so the output
 * is the same whatever the checkout's line endings.
 */
function normalizeLineEndingsPlugin() {
  const fold = (value) => {
    if (typeof value === 'string') return value.replace(/\r\n?/g, '\n');
    if (Array.isArray(value)) return value.map(fold);
    if (value && typeof value === 'object') {
      for (const key of Object.keys(value)) value[key] = fold(value[key]);
    }
    return value;
  };
  return {
    name: 'wtv-normalize-line-endings',
    packageLinkPhase({ customElementsManifest }) {
      fold(customElementsManifest);
    },
  };
}

export default blissAnalyzerConfig({
  globs: ['src/**/*.ts'],
  // exclude: core's default (tests + declarations); src/index.ts is analyzed — registerComponent() runs there.
  outdir: '.',
  plugins: [
    normalizeLineEndingsPlugin(),
    cssVariablesFromManifestPlugin(),
    customElementVsCodePlugin({ outdir: '.' }),
    customElementJetBrainsPlugin({ outdir: '.', packageJson: false }),
  ],
});
