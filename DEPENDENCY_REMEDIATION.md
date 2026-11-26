# Dependency remediation

**Release gate open.** The latest completed registry audit predates these upgrades. At that point root had 0 findings, backend had 1 critical and 6 high findings, and frontend had 21 high findings. The raw report is in `docs/dependency-audits.json`.

| Scope | Patched versions in the current lockfile |
|---|---|
| Backend | `proxy-addr` 2.0.8, `path-to-regexp` 8.4.2, `body-parser` 2.4.0 |
| Frontend | `fast-uri` 3.1.9, `nanoid` 3.3.18, `picomatch` 2.3.2 and 4.0.4, `postcss` 8.5.26, `source-map-js` 1.2.2, `browserslist` 4.28.8, `js-yaml` 4.3.2, `zod` 4.6.7 |
| Frontend, selected copies only | `brace-expansion` 1.1.22 and 2.1.8, `minimatch` 3.1.5 |
| Earlier update | `ws` 8.21.0 in both application graphs |

Both patched application graphs passed clean offline installation with the generated lockfiles and cached integrity metadata. The legacy Drive proxy now uses Node HTTPS for streaming, so Axios and its ten unused transitive lockfile entries, including the previously patched `form-data`, were removed. A clean install of that backend lock and 31 focused backend tests passed. Two backend package names (`engine.io` and `socket.io-parser`) and thirteen frontend package names still match previous high or critical audit ranges. The matching versions and exact lockfile hashes are in [the baseline comparison](docs/dependency-baseline-comparison.json). A fresh registry audit is required to evaluate current findings.

Attempts to resolve additional compatible packages offline failed when suitable package metadata or transitive dependencies were missing. An offline npm audit had incorrectly printed a zero finding result. Its tentative graph was reversed and the audit scripts now reject offline mode. It was never used as evidence of remediation.

Automatic approval review blocked verification when it attempted telemetry to `dc.services.visualstudio.com` with an unknown payload. A direct request restricted to the npm registry was also denied by this workspace. Complete the remaining upgrades and run the three-scope registry audit and full regression tests on a host with approved registry access. See RELEASE_GATES.md for release status.
