# Observed output

Captured 2026-09-25.

## macOS 15.6 arm64, `missing` mode

```
[bare v1.33.4 (bare-fs 4.8.1)] fs.watch('<tmp>/bare-fs-repro-missing-1790329659723/does-not-exist') — the path does not exist
  no throw. Creating the directory and a file inside it…
  events: []  errors: []
  OBSERVED: a dead watcher — nothing fires, nothing errors (the defect)
[node v24.19.0] fs.watch('<tmp>/bare-fs-repro-missing-1790329660273/does-not-exist') — the path does not exist
  threw ENOENT: this is the expected behaviour (Node)
```

## Linux arm64 (Docker node:22-slim, privileged), `limit` mode via run-linux-limit.sh

```
max_user_watches: 1048576 -> 40 (VM already holds 0)
[bare v1.33.4 (bare-fs 4.8.1)] arming 100 directory watches; fs.inotify.max_user_watches=40
  armed without throwing: 100, threw: 0, error events: 0
  watchers that never fired: 69 (indices 31…99)
  OBSERVED: dead handles past the limit with no throw and no error (the defect)
[node v22.23.3] arming 100 directory watches; fs.inotify.max_user_watches=40
  first throw at index 31: ENOSPC (expected behaviour, Node)
  armed without throwing: 31, threw: 69, error events: 0
  watchers that never fired: 0
```
