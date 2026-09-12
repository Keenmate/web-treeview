# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 — build: compile the library (dist/web-treeview.js + style.css)
# ─────────────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS build
WORKDIR /app

# Pin to the latest npm before installing anything. The npm bundled in the base
# image can lag by weeks; newer npm ships fixes and stricter registry handling
# that reduce exposure to supply-chain attacks. Kept as its own cached layer so
# it only re-runs when the base image changes.
RUN npm install -g npm@latest

# Install deps from the committed lockfile. `npm ci` is reproducible and fast;
# it works here because package-lock.json resolves every dependency (including
# @keenmate/web-components-core) from the public npm registry — there are no
# local `file:` sibling paths that would be missing inside the build context.
# Copy only the manifest + lock first so this layer is cached until deps change.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Bring in the source and build. `npm run build` = clean dist + vite build,
# producing dist/ (web-treeview.js + web-treeview.umd.js + style.css + types).
# Everything the build touches (src/, vite.config.ts, tsconfig.json, examples)
# comes in here; host node_modules/ and dist/ are excluded via .dockerignore
# for a clean, in-container build.
COPY . .
RUN npm run build

# Stamp the landing page's version badge with the real package version and the
# build time. On the static site the badge's `import { version } from
# './package.json'` never resolves (that's a Vite-only transform), so it renders
# blank; here we bake the value in. BUILD_TIME can be passed for a reproducible
# stamp (e.g. --build-arg BUILD_TIME=$(date -u +%FT%RZ) from CI); it defaults to
# the moment this layer builds.
ARG BUILD_TIME
RUN VERSION="$(node -p "require('./package.json').version")"; \
    BT="${BUILD_TIME:-$(date -u +'%Y-%m-%dT%H:%MZ')}"; \
    STAMP="v${VERSION} (built ${BT})"; \
    sed -i "s|id=\"version-badge\"></span>|id=\"version-badge\" title=\"Built ${BT}\">${STAMP}</span>|" index.html; \
    sed -i "s|import { version } from './package.json'|const version = '${VERSION} (built ${BT})'|" index.html

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 — serve: static example site (examples-*.html + compiled library)
# ─────────────────────────────────────────────────────────────────────────────
FROM nginx:alpine AS serve

# Replace the stock server block with one that serves the static examples and
# silently drops vulnerability-scanner traffic (see nginx.conf).
COPY nginx.conf /etc/nginx/conf.d/default.conf

# The example pages load the library via <script type="module"> from ./dist, so
# the served root needs the HTML pages, the shared stylesheet, the shared
# chapter-nav + copy-link scripts, and the compiled dist/.
COPY --from=build /app/*.html            /usr/share/nginx/html/
COPY --from=build /app/examples-shared.css /usr/share/nginx/html/
COPY --from=build /app/examples-chapter-nav.js /usr/share/nginx/html/
COPY --from=build /app/examples-copy-link.js /usr/share/nginx/html/
COPY --from=build /app/dist              /usr/share/nginx/html/dist/

# The example pages load the library dev entry via `<script src="/src/index.ts">`,
# which only works under `vite dev` (it transpiles TS on the fly). A static nginx
# server has no src/ tree and can't transform TS, so those requests 404. Rewrite
# the dev entry to the compiled ES bundle in the served copies; the repo HTML is
# left untouched so `vite dev` keeps working locally. (The iOS Files pages already
# import ./dist/web-treeview.js directly and are unaffected.)
RUN sed -i 's#/src/index\.ts#/dist/web-treeview.js#g' /usr/share/nginx/html/*.html

# Inject the Plausible analytics snippet into every served page, right after the
# opening <head>. The snippet lives in plausible-snippet.html (kept out of the
# page sources so `vite dev` serves untracked, analytics-free HTML); sed's `r`
# reads it in and appends it after the matched line.
COPY --from=build /app/plausible-snippet.html /tmp/plausible-snippet.html
RUN for f in /usr/share/nginx/html/*.html; do \
        [ -f "$f" ] && sed -i '/<head>/r /tmp/plausible-snippet.html' "$f"; \
    done; rm /tmp/plausible-snippet.html /usr/share/nginx/html/plausible-snippet.html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
