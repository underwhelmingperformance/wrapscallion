FROM denoland/deno:2.9.1@sha256:c40ad61ed0b40cca8fda05a2bbf44f8e02485bebec8ee4820bdb4b6fff42599d AS build

ARG SOURCE_DATE_EPOCH=0

WORKDIR /src

COPY deno.json deno.lock ./
COPY src ./src

RUN deno install --frozen --entrypoint src/main.ts && \
	find deno.json deno.lock src node_modules \
		-exec touch -h -d "@${SOURCE_DATE_EPOCH}" {} + && \
	deno compile \
		--frozen \
		--cached-only \
		--node-modules-dir=auto \
		--allow-read \
		--allow-env \
		--output /usr/local/bin/wrapscallion \
		src/main.ts && \
	touch -d "@${SOURCE_DATE_EPOCH}" /usr/local/bin/wrapscallion

FROM gcr.io/distroless/cc-debian12@sha256:e5d81ddde149641e2a9ba55be4545bc125c67de07508b03ba4c22e6eb0ded5aa

COPY --from=build /usr/local/bin/wrapscallion /usr/local/bin/wrapscallion

ENTRYPOINT ["/usr/local/bin/wrapscallion"]
