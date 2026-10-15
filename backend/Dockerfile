# The moving 10.0 tag can change feature bands, which global.json intentionally forbids.
FROM mcr.microsoft.com/dotnet/sdk:10.0.302 AS build
WORKDIR /src
COPY global.json ./
COPY backend/ backend/
WORKDIR /src/backend
RUN dotnet restore Vessel.slnx --locked-mode && dotnet tool restore
ARG VERSION=0.1.2
RUN dotnet publish src/Vessel.Api/Vessel.Api.csproj -c Release --no-restore \
    -p:Version=${VERSION} -o /out/api
# The design-time factory needs a syntactically valid connection, never a live database or a secret.
RUN ConnectionStrings__Vessel='Host=localhost;Database=vessel;Username=vessel' \
    dotnet ef migrations bundle --project src/Vessel.Persistence --configuration Release \
    --target-runtime linux-x64 --output /out/migrate

FROM mcr.microsoft.com/dotnet/aspnet:10.0
ARG VERSION=0.1.2
ARG REVISION=unknown
LABEL org.opencontainers.image.source="https://github.com/jcarcaboso/vessel" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"
USER root
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/lib/vessel/evidence && chown app:app /var/lib/vessel/evidence
WORKDIR /app
COPY --from=build /out/api/ ./
COPY --from=build --chmod=755 /out/migrate /app/migrate
ENV ASPNETCORE_HTTP_PORTS=8080 \
    ASPNETCORE_ENVIRONMENT=Production \
    Vessel__Evidence__Storage__Local__RootPath=/var/lib/vessel/evidence
USER app
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=6 \
    CMD curl --fail --silent --output /dev/null http://127.0.0.1:8080/health/ready || exit 1
ENTRYPOINT ["dotnet", "Vessel.Api.dll"]
