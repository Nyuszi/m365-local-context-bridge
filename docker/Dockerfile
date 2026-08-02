# Local Context Bridge companion — hardened sidecar
# Build context is repository root: docker build -f docker/Dockerfile .

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY companion/ ./companion/
RUN dotnet restore companion/src/LocalContextBridge.Api/LocalContextBridge.Api.csproj \
 && dotnet publish companion/src/LocalContextBridge.Api/LocalContextBridge.Api.csproj \
    -c Release -o /app/publish --no-restore \
    -p:PublishReadyToRun=false

FROM mcr.microsoft.com/dotnet/aspnet:8.0-alpine AS final
RUN addgroup -S bridge && adduser -S bridge -G bridge \
 && mkdir -p /data /tmp/bridge && chown -R bridge:bridge /data /tmp/bridge

WORKDIR /app
COPY --from=build /app/publish .
COPY mock-chat/ /app/wwwroot/mock-chat/

ENV ASPNETCORE_URLS=http://0.0.0.0:32178 \
    LOCAL_CONTEXT_BRIDGE_DATA=/data \
    LOCAL_CONTEXT_BRIDGE_DOCKER=1 \
    DOTNET_EnableDiagnostics=0 \
    TMPDIR=/tmp/bridge

USER bridge
EXPOSE 32178

HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:32178/health || exit 1

ENTRYPOINT ["dotnet", "LocalContextBridge.Api.dll"]
