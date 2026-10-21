FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl build-essential cmake pkg-config file patchelf \
    qt6-base-dev qt6-webengine-dev libqt6sql6-sqlite libmosquitto-dev \
    libfuse2t64 desktop-file-utils \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /work
ENTRYPOINT ["bash", "scripts/build-appimage.sh"]
