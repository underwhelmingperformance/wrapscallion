FROM denoland/deno:2.9.8@sha256:a0d88a7fcbd44f062cba2748e19df67d30290ad12aa203c7c1e0b12462c483f0 AS build

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
