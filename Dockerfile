FROM denoland/deno:2.9.1@sha256:c40ad61ed0b40cca8fda05a2bbf44f8e02485bebec8ee4820bdb4b6fff42599d AS build

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
