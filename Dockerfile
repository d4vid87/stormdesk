# The dashboard with no desktop: the LAN server, the hub listener and the archive, for a house
# whose only always-on machine is a NAS or a Pi.
#
# Built without the `gui` feature, so no Tauri, no GTK and no WebKit are anywhere in this image.
FROM rust:1-slim-bookworm AS build
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY site ./site
COPY src-tauri ./src-tauri
WORKDIR /src/src-tauri
RUN cargo build --release --no-default-features --bin stormdesk

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/src-tauri/target/release/stormdesk /usr/local/bin/stormdesk
# The uid is fixed at 1000:1000 so a bind mount can be matched from the host.
RUN groupadd --gid 1000 stormdesk \
    && useradd --uid 1000 --gid 1000 --home-dir /data --no-create-home stormdesk \
    && install -d -o stormdesk -g stormdesk /data
# One directory holds the settings blob and the observation archive.
ENV WD_DATA_DIR=/data
VOLUME /data
EXPOSE 8088
EXPOSE 50222/udp
# IMPORTANT: run with `network_mode: host` on Linux. The Tempest hub broadcasts to the subnet,
# and a broadcast does not cross a bridged Docker network no matter how many ports are published.
# Docker creates a missing bind-mount directory as root. Repair it before dropping privileges so
# SQLite can create the archive on a first run as well as after an upgrade.
ENTRYPOINT ["sh", "-c", "chown -R stormdesk:stormdesk /data && exec setpriv --reuid=stormdesk --regid=stormdesk --init-groups /usr/local/bin/stormdesk --headless"]
