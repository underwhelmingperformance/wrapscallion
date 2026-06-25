FROM denoland/deno:2.9.0@sha256:8d24854de78a79c56e74b49aa4c5996c60e1fe3730efba8fbdd2692c582e6e29 AS build

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
