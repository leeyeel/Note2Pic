# syntax=docker/dockerfile:1.7
FROM node:20.19-bookworm

ENV DEBIAN_FRONTEND=noninteractive \
    TZ=Etc/UTC \
    LC_ALL=en_US.UTF-8 \
    LANG=en_US.UTF-8 \
    LANGUAGE=en_US:en

WORKDIR /workspace
COPY . .
RUN npm i && npm run build

ENTRYPOINT ["npm", "run", "mcp"]
