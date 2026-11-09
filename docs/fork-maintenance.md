# Changes maintained in this fork

This fork keeps the Amber Terminal theme, remote model catalogs, and the lightning-bolt Fast control used by the deployed web portal. Its initial changes are based on upstream commit `d9e2a445c1d4246fbbdf894734a24ab4cd2da7cd`.

- **Amber Terminal** replaces the default OMP palette while retaining its `omp` preference ID, so existing OMP-theme browsers receive it on reload. The canvas is `#151217`; conversation text remains amber (`#EA9C46`). Navigation, controls, links, inline code, and tool labels use teal (`#70B9BE`); headings and reasoning text use plum (`#C48CB9`). General UI and user messages use warm ivory (`#D9CFC3`), with cool neutral metadata. Success text remains green (`#70D174`). Code previews use the same palette; other selectable themes retain their colors.
- Remote chats send their owning host ID to `/api/models`. The server reads that host's model registry over its existing host link and caches each host's catalog separately. A catalog lookup starts a separate empty OMP runtime and stops it after reading the model metadata. Provider credentials remain on the host.
- The composer shows a lightning-bolt **Fast** toggle in place of **Slow**. Clicking it sends OMP's native `set_fast_mode` command and reflects the returned `enabled` and `active` flags. It is disabled during a running turn.
- Codex model eligibility follows OMP's priority-tier check: a nonempty advertised tier list must include `priority`; absent or empty lists are treated as unreported. An enabled setting does not by itself prove that a provider served a request with priority processing.

The source changes and regression tests are committed together. The initial deployment passed 286 targeted tests, TypeScript checking, lint on changed files, the client build, and the Linux binary build. Browser inspection confirmed that Fast was visible and Slow absent. A temporary session verified Fast on/off through OMP without sending a model prompt.

## Merge upstream updates into the fork

`origin` points to `clong/ompweb`; `upstream` points to `kahme247/ompweb`. Maintain the deployed changes on `main` and merge upstream updates without rewriting published history:

```sh
git fetch upstream
git switch main
git merge upstream/main
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

The locked Bun dependency supplies the runtime used by the tests and build. If npm reports that Bun's dependency installation script was blocked, review and allow that locked package's installation script before running these checks.

When resolving upstream conflicts, verify that existing and new remote chats still request the selected host's catalog, caches do not mix hosts, and the Fast control sends the native command. Check an unavailable host too: catalog requests must report its failure instead of substituting the web server's models.

## Build the Linux web-server release

After the client build, compile the baseline Linux x64 binary:

```sh
npx --no-install bun scripts/build-binary.ts --target bun-linux-x64-baseline
```

The output is `release/ompweb-linux-x64.tar.gz`. Keep the binary beside its packaged assets. Record the fork commit and archive SHA-256 with each deployed release, preserve the previous release directory, and restart only the web service when updating the portal. Updating the host daemon is a separate operation because it owns the OMP processes.

Preserve the application's agent directory, host registrations, and signing state across web-server updates. Keep host tokens and provider credentials outside this repository and outside release archives.

The inherited npm package name belongs to upstream. Use binary builds for this fork unless a separate package name and publishing configuration are deliberately established. The inherited publishing workflow must not be used to publish upstream's npm package or send upstream release announcements.
