FROM ubuntu:focal

# Install dependencies
RUN apt-get update && \
    apt-get install -y curl gnupg && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get update && \
    /usr/bin/apt-get upgrade -y && \
    apt-get install -y nodejs ffmpeg && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /home/app

ENTRYPOINT ["bash"]