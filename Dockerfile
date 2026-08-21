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

FROM gcr.io/distroless/cc-debian12@sha256:e5d81ddde149641e2a9ba55be4545bc125c67de07508b03ba4c22e6eb0ded5aa

COPY --from=build /usr/local/bin/wrapscallion /usr/local/bin/wrapscallion

ENTRYPOINT ["/usr/local/bin/wrapscallion"]
