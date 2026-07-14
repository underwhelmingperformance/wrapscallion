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

FROM gcr.io/distroless/cc-debian12@sha256:7ee09f36862efbdbf70422db263e411c2618409ca46faa555bd5b636155307df

COPY --from=build /usr/local/bin/wrapscallion /usr/local/bin/wrapscallion

ENTRYPOINT ["/usr/local/bin/wrapscallion"]
