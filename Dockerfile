FROM node:24.22.1-alpine3.24@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS build

WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --ignore-scripts && ./node_modules/.bin/tsc --version

COPY src ./src
COPY manifest.json server.json ./

RUN npm run build

FROM build AS test

RUN apk add --no-cache bash unzip

COPY tests ./tests
COPY scripts ./scripts
COPY packaging/mpak/config.json ./packaging/mpak/config.json
COPY .github/workflows/mpak-release.yml .github/workflows/mpak-scan.yml ./.github/workflows/
COPY Dockerfile README.md REFERENCE.md .dockerignore ./
RUN --network=none npm test

FROM node:24.22.1-alpine3.24@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS runtime

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn* \
        /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
        /usr/local/bin/yarn /usr/local/bin/yarnpkg /usr/local/bin/pnpm /usr/local/bin/pnpx \
    && apk add --no-network --no-scripts alpine-baselayout-data \
    && apk del --no-network --no-scripts alpine-baselayout busybox busybox-binsh ssl_client \
    && node -e "const fs = require('node:fs'); \
        for (const dir of ['/bin', '/sbin', '/usr/bin', '/usr/sbin']) { \
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { \
                const file = dir + '/' + entry.name; \
                if (entry.isSymbolicLink() && fs.readlinkSync(file) === '/bin/busybox') fs.unlinkSync(file); \
            } \
        } \
        fs.mkdirSync('/opt', { recursive: true }); \
        for (const dir of ['/tmp', '/var/tmp']) { fs.mkdirSync(dir, { recursive: true }); fs.chmodSync(dir, 0o1777); }"

COPY --from=build /app/dist ./dist
COPY manifest.json server.json LICENSE README.md CHANGELOG.md SECURITY.md CONTRIBUTING.md RELEASING.md REFERENCE.md ./
COPY packaging/mpak/README.md ./packaging/mpak/README.md
COPY packaging/kiro/ ./packaging/kiro/

USER node

ENTRYPOINT ["node", "/app/dist/cli.js"]
