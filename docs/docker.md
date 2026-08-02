# Docker Desktop sidecar

Preferred macOS deployment:

```text
Chrome → extension → http://127.0.0.1:32178 → Docker port publish → companion → read-only project mount
```

## Start

```bash
./scripts/bridge-macos.sh start --docker --project /absolute/path/to/project --alias my-app
```

Or manually:

```bash
cp docker/.env.example docker/.env
# edit PROJECT_HOST_PATH
docker compose --profile bridge -f docker/compose.yaml up --build
```

## Hardening

- Publish `127.0.0.1:32178:32178` only
- Non-root user, `cap_drop: ALL`, `no-new-privileges`
- Read-only root filesystem + bounded `noexec,nosuid,nodev` tmpfs
- Project bind mount read-only
- No privileged mode, host network, or `/var/run/docker.sock`
- State volume for pairing / roots / audit only

## Adding another host folder

A running container cannot mount a new host directory. Generate a Compose override, review it, and recreate the container. Never automate via the Docker socket.
