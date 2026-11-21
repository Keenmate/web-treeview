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
 * Keep the manifest to the package's PUBLIC API (C-CEM-11). The stock analyzer records every
 * class member (private / protected / `#private` / `_internal`) and every module under
 * `globs`; this pass (packageLinkPhase, before the editor-integration generators) drops:
 * - members that are `private` / `protected` (core hooks, `static inputs` / `events`) or
 *   named `#…` / `_…` (the internal-naming convention);
 * - modules the package entry (`src/index.ts`) doesn't re-export from, and, in the rest, the
 *   declarations / exports `src/index.ts` doesn't re-export (incl. the analyzer's stray
 *   function-local declarations). Custom-element modules are always kept.
 */
function publicApiPlugin({ entry = 'src/index.ts' } = {}) {
  const isInternalMember = (m) =>
    m.privacy === 'private' || m.privacy === 'protected' || /^[#_]/.test(m.name ?? '');
  const toPath = (spec) => {
    if (!spec) return spec;
    const dir = entry.slice(0, entry.lastIndexOf('/') + 1);
    // './x' (named re-export) or 'src/x' (the analyzer's path for `export * from './x'`).
    const p = spec.startsWith('.') ? (dir + spec).replace(/\/\.\//g, '/') : spec;
    if (!p.startsWith(dir)) return p; // a package import — not a module of this manifest
    return /\.[cm]?[jt]s$/.test(p) ? p.replace(/\.js$/, '.ts') : p + '.ts';
  };
  return {
    name: 'web-treeview-public-api',
    packageLinkPhase({ customElementsManifest }) {
      const modules = customElementsManifest.modules ?? [];
      const index = modules.find((m) => m.path === entry);
      if (!index) return;
      const reexported = new Map(); // module path -> Set of names ('*' = all)
      for (const e of index.exports ?? []) {
        const path = toPath(e.declaration?.module);
        if (!path || path === entry) continue;
        if (!reexported.has(path)) reexported.set(path, new Set());
        reexported.get(path).add(e.name === '*' ? '*' : e.declaration.name);
      }
      customElementsManifest.modules = modules.filter((mod) => {
        if (mod === index) return true;
        const names = reexported.get(mod.path);
        const isCe = (mod.declarations ?? []).some((d) => d.customElement);
        if (!names && !isCe) return false;
        const keep = (name, d) => d?.customElement || names?.has('*') || names?.has(name);
        mod.declarations = (mod.declarations ?? []).filter((d) => keep(d.name, d));
        mod.exports = (mod.exports ?? []).filter(
          (e) => e.kind === 'custom-element-definition' || keep(e.declaration?.name, mod.declarations.find((d) => d.name === e.declaration?.name)),
        );
        for (const d of mod.declarations) {
          if (d.members) d.members = d.members.filter((m) => !isInternalMember(m));
        }
        return true;
      });
    },
  };
}

export default blissAnalyzerConfig({
  globs: ['src/**/*.ts'],
  // exclude: core's default (tests + declarations); src/index.ts is analyzed — registerComponent() runs there.
  outdir: '.',
  plugins: [
    publicApiPlugin(),
    cssVariablesFromManifestPlugin(),
    customElementVsCodePlugin({ outdir: '.' }),
    customElementJetBrainsPlugin({ outdir: '.', packageJson: false }),
  ],
});
