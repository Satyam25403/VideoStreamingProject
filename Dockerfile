FROM ubuntu:focal

ENV DEBIAN_FRONTEND=noninteractive

# Install dependencies
RUN apt-get update && \
    apt-get install -y \
    bash \
    curl \
    gnupg \
    unzip \
    dos2unix && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get update && \
    apt-get install -y nodejs ffmpeg && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /home/app

ENTRYPOINT ["/bin/bash"]