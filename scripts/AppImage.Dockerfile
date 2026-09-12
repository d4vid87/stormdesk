FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive \
    RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl build-essential pkg-config file wget patchelf \
    libwebkit2gtk-4.1-dev libxdo-dev libssl-dev libayatana-appindicator3-dev \
    librsvg2-dev nodejs npm xdg-utils && rm -rf /var/lib/apt/lists/*
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs -o /tmp/rustup.sh \
    && sh /tmp/rustup.sh -y --profile minimal --default-toolchain 1.98.0 \
    && rm /tmp/rustup.sh \
    && chmod -R a+rX /usr/local/rustup /usr/local/cargo
COPY --from=node:22-bullseye-slim /usr/local/ /usr/local/
RUN npm install --global @tauri-apps/cli@2.11.4 && npm cache clean --force
