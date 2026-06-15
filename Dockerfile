FROM denoland/deno:2.8.3@sha256:438618d8c0678c3154fc77ad6edad61f38cbc42803a181e7908d3e2c9e645022

WORKDIR /opt/wrapscallion

COPY deno.json deno.lock ./
COPY src ./src
COPY hooks/docker-entrypoint /usr/local/bin/wrapscallion

RUN chmod 0755 /usr/local/bin/wrapscallion \
	&& deno cache --frozen src/main.ts

ENTRYPOINT ["wrapscallion"]
