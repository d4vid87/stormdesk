# StormDesk transport hardening

This directory vendors **tiny_http 0.12.0**, originally published at
<https://crates.io/crates/tiny_http/0.12.0> from
<https://github.com/tiny-http/tiny-http>. The source, original package manifest,
README, changelog and MIT/Apache-2.0 licenses were copied from that published
crate. Registry metadata, generated build artifacts and example assets are not
part of this vendored copy.

StormDesk needs a cancellable upload transport; upstream 0.12.0 exposes neither
socket cancellation nor body deadlines through `Request`. The local patch:

- applies a 10-second idle timeout to accepted socket reads and writes;
- gives each request a 30-second absolute read deadline, starting only when its
  sequential reader obtains ownership, so pipelined requests cannot reset an
  earlier body's deadline;
- adds `Request::set_body_deadline(Duration)` for the application's longer backup
  upload allowance and `Request::abort(self)` to close both halves without
  sending a response or waiting to drain rejected bodies;
- closes only the read half on an expired read, preserving an earlier active
  SSE/download response while the parser waits for the next keepalive request;
- dispatches all nonempty request bodies without eagerly buffering small ones;
- dispatches one request at a time per connection, including plain HTTP, so a
  pipelined request behind a streaming response cannot occupy an application
  worker waiting for response order; independent connections remain concurrent;
- signals a stopped connection after cancellation or transport failure, so bytes
  already buffered for a pipelined follow-up cannot be dispatched after abort;
- aborts the connection and reports a body read error if sending `100 Continue`
  fails, instead of silently proceeding with the upload;
- rejects unsupported HTTP versions before reserving a request writer, avoiding
  the upstream error path waiting on its own unfinished response;
- reports truncated fixed-length bodies as `UnexpectedEof`, and uses a fixed
  8 KiB drain buffer rather than allocating the untrusted remaining length;
- stops attempting to drain a fixed-length body after a terminal read error,
  while preserving normal retries after `Interrupted`.

The unused upstream example-test dependencies were removed; the body-reading
doc example now leaves JSON parsing to the caller without requiring a separate
JSON crate. The regression tests use only Rust's standard library.

The application bounds upload concurrency separately. This is not a claim of
unlimited connection-flood protection. TLS retains the upstream implementation;
StormDesk serves plain HTTP locally and terminates external TLS at its proxy.

Run the focused tests using StormDesk's existing lockfile with:

```sh
cargo test --manifest-path src-tauri/Cargo.toml -p tiny_http --locked
```

The streaming-response regression intentionally waits 11 seconds to cross the
real socket idle limit. In-memory `TestRequest` values have no socket to cancel
or time out.
