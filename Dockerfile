FROM denoland/deno:2.8.3@sha256:438618d8c0678c3154fc77ad6edad61f38cbc42803a181e7908d3e2c9e645022 AS build

WORKDIR /src

COPY deno.json deno.lock ./
COPY src ./src

RUN deno compile \
	--frozen \
	--allow-read \
	--allow-env \
	--output /usr/local/bin/wrapscallion \
	src/main.ts

FROM gcr.io/distroless/cc-debian12@sha256:d703b626ba455c4e6c6fbe5f36e6f427c85d51445598d564652a2f334179f96e

COPY --from=build /usr/local/bin/wrapscallion /usr/local/bin/wrapscallion

ENTRYPOINT ["/usr/local/bin/wrapscallion"]
