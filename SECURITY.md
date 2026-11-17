# Security

StormDesk is a household dashboard with a local owner, paired editors, and read-only viewers.

## What this app trusts

- New installations require owner or paired-editor access to read `/config`, write settings,
  inspect integrations, or perform archive maintenance. Weather and history viewer endpoints
  remain public to devices that can reach the server; `/config-public` removes credentials.
- The desktop owner connects over loopback with a `localhost` or literal loopback-IP Host.
  Browser requests must also have a matching Origin (or an allowed native Tauri origin).
  Cross-origin requests do not inherit this implicit owner authority. Arbitrary Host names do
  not inherit it either, even when Origin matches, preventing the loopback DNS-rebinding bypass.
- Other editors pair with an owner-generated ten-minute code. Their bearer credentials are
  hashed on the server and can be revoked. Treat a paired browser as trusted: it can read the
  unredacted configuration and change settings.
- Existing pre-pairing configurations migrate with `legacyLanAccess: true` to preserve household
  compatibility. That explicit mode trusts LAN clients with credentials and administration.
  Disable it after pairing the screens that need editing access.
- `/public` redirects to `/`; it is **not** an authorization boundary or a way to downgrade a
  browser that already has editor credentials. A reverse proxy must preserve the public Host,
  use paired credentials for administration, and enforce any additional restrictions required
  for internet exposure. Do not rewrite every incoming request to `Host: localhost` and thereby
  make the proxy an implicit owner. Use TLS for paired credentials outside trusted loopback.

The access checks protect the application API, not the host machine from another local process.
See the [technical reference](docs/technical-reference.md#sharing-a-read-only-dashboard) for setup.

On Unix, configuration writes, new backups, and restore staging files use owner-only permissions
(`0600`), and startup tightens the existing configuration file. Previously exported backups and
existing archive files are not automatically changed. Windows uses its existing filesystem ACLs.

Uploads use two dedicated workers and two queue slots, so stalled request bodies do not consume
the four normal HTTP workers. A local `tiny_http 0.12.0` patch adds connection cancellation,
ten-second socket idle timeouts and absolute request-body deadlines. Discard buffers are bounded,
and truncated/oversized bodies cannot apply a valid prefix. See
[`src-tauri/vendor/tiny_http/STORMDESK-PATCH.md`](src-tauri/vendor/tiny_http/STORMDESK-PATCH.md)
for the upstream provenance and maintained changes.

Only the newest release is supported. The desktop builds update themselves, the container's
`latest` tag moves on every release, and there are no backport branches.

## Reporting something

Open an issue with the version from Settings, how it is installed (Windows, Docker, Pi, APK), and
the exact request or setting that triggers it. If you would rather not do that in public, open an
issue with no detail in it and we will find another channel. Reporters are credited by name in the
changelog.

## Advisories against crates we ship

This section exists so that "the lockfile contains a crate with an advisory" has a written answer in
the repository, rather than a new pull request every few weeks. An entry here means the advisory has
been read, the call path traced, and the finding recorded — not that it has been waved away. Every
entry is mirrored in `src-tauri/deny.toml`, so `cargo deny check advisories` fails in CI if one
stops being true.

### Current dependency status (November 17, 2026)

`cargo deny check advisories` passes against the checked-in lockfile. The yanked
`async-executor 1.14.0` is replaced by `1.14.1`; the Flatpak offline archive and checksum manifest
matches all locked registry packages; the patched HTTP crate is bundled in the source tree.
The bundled SQLite fix is present through
`rusqlite 0.41.1` / `libsqlite3-sys 0.39.1`.

The specific maintenance exceptions in `src-tauri/deny.toml` remain enforced by CI. No broad
advisory ignore was added. The analyses below are historical and describe earlier dependency
trees; they do not assert that the old affected TLS packages are still shipped.

### Historical: RUSTSEC-2026-0104 / GHSA-82j2-j2ch-gfr8 — rustls-webpki panic parsing a CRL

**We ship the affected crate. StormDesk cannot reach the code that panics.** Assessed 2026-08-24
against 3.2.0, with `rumqttc 0.25.1` the newest release on crates.io.

`rustls-webpki 0.102.8` is in `src-tauri/Cargo.lock` twice, both times underneath the MQTT client:

    stormdesk 3.2.0
    └── rumqttc 0.24.0
        ├── rustls-webpki 0.102.8              direct — Cargo.lock:3141
        └── tokio-rustls 0.25.0                Cargo.lock:3144
            └── rustls 0.22.4
                └── rustls-webpki 0.102.8      Cargo.lock:3198

Those are the only two paths. Only `rumqttc 0.24.0` and `rustls 0.22.4` depend on `0.102.8`, only
`tokio-rustls 0.25.0` depends on that `rustls`, and only StormDesk depends on `rumqttc`. Every
other TLS user in the build is already on the fixed line: the advisory is patched in `0.103.13`,
and `rustls 0.23.43` and `rustls-platform-verifier 0.7.0` both pull `rustls-webpki 0.103.14`
(`Cargo.lock:3213` and `:3275`) — which is what `ureq 2.12.1` (all of our own HTTPS) and
`reqwest 0.13.4` (Tauri and the updater) use. The MQTT publisher is the only thing left on the old
line.

**The advisory states its own precondition.** From the GHSA:

> CRL checking is opt-in in rustls-webpki. This vulnerability affects only applications that
> explicitly pass RevocationOptions to verify_for_usage() and load CRL bytes from a source the
> attacker can influence. The default rustls configuration (no RevocationOptions) is not affected.

RustSec puts it in one line: "Applications that do not use CRLs are not affected." The panic is an
index underflow in `bit_string_flags()` in the crate's `src/der.rs`, reached from the public
`BorrowedCertRevocationList::from_der()` when a CRL's `issuingDistributionPoint` extension carries
an empty BIT STRING with zero padding bits. Nothing calls that entry point except revocation
checking.

**StormDesk configures TLS in exactly two places, identically, and neither passes any
configuration at all.** In `src-tauri/src/mqtt.rs:307-309`, in the publish loop:

```rust
if tls {
    opts.set_transport(rumqttc::Transport::tls_with_default_config());
}
```

and the same three lines again at `src-tauri/src/mqtt.rs:410-412`, in `probe()` — the connection
test behind Settings. Those two are the only `Transport::` or `tls_*` calls anywhere in the crate:
twelve Rust files, `build.rs` included, and no vendored dependencies. `RevocationOptions`,
`verify_for_usage`, `CertRevocationList`, `add_parsable_crls`, `RootCertStore`, `ClientConfig`,
`CertificateDer` and `ServerCertVerifier` do not appear in the source at all; neither does the word
`crl`, in any case; there is no `danger`-prefixed call; and there is no `.pem`, `.der` or `.crl`
file in the repository. We build no `ClientConfig` of our own, so there is nowhere to put a
revocation list even if we had one — root certificates come from the platform store inside
`tls_with_default_config()`, and platform roots are not CRLs. The twelve `ureq` call sites
(`cwop.rs`, `store.rs`, `ingest.rs`, `alerts.rs`, `api.rs`, `server.rs`) use `get`, `post`,
`timeout` and `set` and nothing else — no `AgentBuilder`, no TLS connector, no custom root store.
`verify_for_usage()` is therefore only ever called by rustls' own default verifier, with
`RevocationOptions` absent, which is the configuration the advisory names as unaffected.

**The honest part: a hostile server certificate can reach that crate. A hostile CRL cannot.** The
broker address is a setting. `mqttUrl` is typed into the settings drawer (`site/js/boot.js:459`)
and written through the LAN settings route (`src-tauri/src/server.rs:174`), which takes no
credentials by default, and `conf()` in `src-tauri/src/mqtt.rs:88` reads it straight back. Anyone
who can reach port 8088 can therefore point the MQTT client at a host they control and feed a chain
of their choosing into `0.102.8`'s chain building. We are not claiming the affected crate never
sees attacker-controlled bytes. We are claiming the *panicking* path never runs: it is in CRL
parsing, which executes only for a revocation list the application supplied alongside
`RevocationOptions` it constructed. Neither of the advisory's two attack paths applies — we are not
an mTLS server checking client certificates, and we fetch no CRL distribution point to be MITM'd. A
hostile broker gets what a broken one gets: the handshake fails, the disconnect reason is logged
without the URL (it can carry a password), and the publish loop retries.

MQTT is also off in a stock install. `conf()` returns `None` until both `mqttUrl` and `stationId`
are set, and the loop sleeps. On most installs neither call site ever executes.

**There is nothing to upgrade to yet.** The fix ships in `0.103.13`. The `0.102` line ends at
`0.102.8` and never received a backport, so `cargo update` has nowhere to go, and `0.102 → 0.103`
is a semver break it cannot cross on its own — the requirement has to come from `rumqttc`. It does
not: `rumqttc 0.25.1`, the newest release, still declares `rustls-webpki = "^0.102.8"`, a caret on
the affected line that cannot resolve to `0.103` at all. It does move to `tokio-rustls 0.26`,
dropping the second path, but the direct dependency keeps the crate in the lockfile and the
advisory with it. That leaves two ways to remove it outright, both costing more than an unreachable
panic: `rumqttc`'s `use-native-tls` feature, which drags OpenSSL into the Linux and cross-compiled
release builds that today need no system TLS at all — there is no `native-tls` anywhere in the
lockfile, and that is the point — or dropping MQTT TLS, which breaks every `mqtts://` broker.

**What would change this.** A `rumqttc` release that asks for `rustls-webpki 0.103`, directly and
through whichever `tokio-rustls` it picks up, turns this into a one-line bump in
`src-tauri/Cargo.toml` plus `cargo update -p rumqttc`, and this entry becomes a changelog line. A
`0.102.x` backport would be a one-line `cargo update --precise`. Until one of those exists, this
section is the answer to an advisory PR against `rustls-webpki` in this repository. A pull request
that performs the upgrade, or that shows the argument above is wrong, is very welcome; one that
edits unrelated lockfile entries is not.

**Checking this yourself.** With a network, from `src-tauri`:

    cargo tree -i rustls-webpki@0.102.8      # every path in — expect the two above
    cargo tree -i rustls-webpki@0.103.14     # the patched copy, and everything already using it
    cargo audit                              # names the advisory and the same two paths
    cargo deny check advisories              # the same, and enforces the exception recorded here

Offline, the lockfile and the source answer the same questions:

    grep -n 'rustls-webpki 0.102.8' src-tauri/Cargo.lock          # the reverse-dependency list
    grep -rn 'Transport::\|tls_' --include='*.rs' src-tauri/      # every TLS call site: two
    grep -rniE 'RevocationOptions|verify_for_usage|CertRevocationList|add_parsable_crls|crl' \
      --include='*.rs' src-tauri/                                 # no matches at all

`cargo tree` needs the registry index and `cargo audit` the advisory database, so both want a
network on a cold checkout — `cargo fetch` first. The greps need neither.

[share]: docs/technical-reference.md#sharing-a-read-only-dashboard

### October 31, 2026 release audit

StormDesk 4.6.1 upgrades the stable Tauri plugins (including the updater), rustls, rustls-webpki and bundled root certificates. This removes the reported TLS and ZIP extraction vulnerabilities. MQTT now uses rumqttc's native TLS backend and the operating system's certificate store; certificate and hostname verification remain enabled. Linux packages and containers include the OpenSSL 3 runtime.

The old rustls-webpki 0.102, rustls-pemfile and unic dependency paths are gone, so their exceptions have been removed. The historical analysis below describes earlier releases, not the 4.6.1 dependency tree.

Three maintenance notices remain accepted: RUSTSEC-2026-0370, -0371 and -0372. They cover zvariant, zbus_names and zvariant_derive merging into zbus 6. Current stable Tauri notification/single-instance dependencies still use zbus 5. These advisories report maintenance status, not a vulnerability. Keep the specific exceptions only until stable upstream plugins migrate; do not ignore future vulnerability reports on these crates.

### The 2026-08 advisory batch — three more rustls-webpki findings, and a wall of "unmaintained"

The advisories run on `main` started failing on 2026-08-26 when the RustSec database grew a
batch of new entries against crates this tree already shipped. Every one is recorded in
`src-tauri/deny.toml` with a reason; the summary:

**rustls-webpki 0.102.8, again** (RUSTSEC-2026-0049, -0098, -0099). Same crate, same tree and
same constraint as RUSTSEC-2026-0104 above: the fixes are in 0.103.x, there is no 0.102.x
backport, and `rumqttc 0.25.1` still requires `^0.102.8`, so there is nothing to upgrade to.
Reachability differs per advisory:

- **-0049 (CRL Distribution Point matching):** unreachable for the same reason as -0104 — this
  application loads no CRLs, so all CRL handling is dead code here.
- **-0098 / -0099 (name-constraint acceptance for URI and wildcard names):** these sit in
  certificate validation proper, which *does* run when MQTT-over-TLS is configured. The exposure
  requires the user's broker to present a certificate chained through a CA that issues
  name-constrained certificates that a correct validator would reject. The deployment this app
  supports — a LAN broker with a self-signed or private-CA certificate — has no such chain, and
  a public-CA chain abusing this needs a misissuing CA, which is a browser-ecosystem event, not
  a StormDesk one. Accepted as low risk; both entries are dropped the moment a rumqttc release
  moves to rustls-webpki 0.103.

**Unmaintained, not vulnerable.** The rest of the batch is maintenance-status advisories, all
arriving through Tauri v2's own dependency tree:

- **gtk-rs GTK3 bindings** (RUSTSEC-2024-0411 through -0420): Tauri v2 renders through
  WebKitGTK on GTK3 on Linux. Moving to GTK4 is Tauri's roadmap, not something a dependent
  application can do; these leave the list with Tauri v3.
- **proc-macro-error** (RUSTSEC-2024-0370): build-time proc-macro helper, no runtime code.
- **rustls-pemfile** (RUSTSEC-2025-0134): PEM parsing was folded into rustls upstream; rumqttc
  still pulls the standalone crate. It parses local PEM files only.
- **the unic block** (RUSTSEC-2025-0075, -0080, -0081, -0098, -0100): compile-time Unicode
  identifier tables under `tauri-utils`.

None of these change what the application does at runtime. The rule from the top of this
section still holds: each entry exists in `deny.toml` only alongside this writeup, and the
check goes red again the moment an entry stops being true.
