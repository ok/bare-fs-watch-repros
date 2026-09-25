# bare-fs watch reproductions

Runnable reproductions of two defects in `bare-fs`'s `fs.watch()` (bare-fs 4.8.1, Bare 1.33.x),
each next to the Node behaviour for comparison. They exist so the upstream issues can point at
code, and so the workarounds in [chokibare](https://github.com/ok/chokibare) are justified by
something that can be re-run.

| Issue | What bare-fs does | What Node does | Workaround chokibare had to build |
| --- | --- | --- | --- |
| **1. Silent start failure** ([bare-fs#51](https://github.com/holepunchto/bare-fs/issues/51)) | `fs.watch()` returns a watcher that never fires and never errors when `uv_fs_event_start()` fails (missing path → ENOENT, past `fs.inotify.max_user_watches` → ENOSPC, past the open-file limit on macOS → EMFILE) | throws synchronously | on Linux, after every arm, read `/proc/self/fdinfo/<inotify fd>` and check the kernel actually holds the watch (`lib/inotify.js`); report the ones it does not as `ENOSPC` |
| **2. NULL filename crash** ([bare-fs#52](https://github.com/holepunchto/bare-fs/issues/52)) | the native event callback calls `strlen(filename)` without a NULL check; libuv passes `NULL` on a Windows `ReadDirectoryChangesW` buffer overflow (4 KB buffer, ~50–100 events) and on a kqueue `F_GETPATH` failure → the process crashes | delivers `'change'` with a `null` filename ("events were lost, rescan") | do not use the recursive backend on Windows under Bare until this is fixed |

## Issue 1 — silent start failure

```
cd i1-silent-start-failure
npm install                         # bare-runtime, bare-fs (+ node for the control)
node node_modules/bare-runtime/bin/bare repro.js   # missing path: expected "threw ENOENT", observed "watcher never fires"
node repro.js                       # control: throws ENOENT
./run-linux-limit.sh                # Linux, Docker, privileged: lowers max_user_watches, arms past it
```

Where it is in the source: `bare-fs/binding.c`, `bare_fs_watcher_init()`:

```c
err = uv_fs_event_start(&watcher->handle, bare_fs__on_watcher_event, (char *) path, flags);
assert(err == 0);      // 3a55a9f "Assert that uv_fs_event_start() succeeds", released in 4.4.5
```

Release prebuilds compile the `assert` out, so the error is discarded. Before that commit the code
threw — but after `uv_fs_event_init` had already registered the handle and without closing it,
which is a use-after-free once the ArrayBuffer holding the handle is collected. The fix is to keep
the buffer referenced, `uv_close()` the handle, release the reference in the close callback, and
throw the libuv error, matching Node.

## Issue 2 — NULL filename

```
cd i2-null-filename
npm install
.\run-windows.ps1                   # Windows: observer under Bare + load generator, then the same under Node
```

`run-windows.ps1` starts `observer.js` (a recursive `fs.watch`, counting events and `null`
filenames) in a second process, runs `load.js` against its directory (create → rename-shuffle →
overwrite → delete, 20 000 empty files by default), and prints the observer's exit code: with
bare-fs 4.8.1 the Bare observer dies with `-1073741819` (`0xC0000005`), the Node observer survives
and reports `null` filenames. File size is irrelevant: the 4 KB buffer holds change *records*
(12 bytes + the UTF-16 name each, ~128 for ten-character names); the number of operations in a
short window is what overflows it, and a rename is two records. Options: `-Files N`, `-Mode
create|rename|write|delete|all`, `-Rounds R`. The pieces also run alone:

```
node node_modules/bare-runtime/bin/bare observer.js <dir> --seconds 20   # in one terminal
node load.js <dir> --files 20000 --mode rename --rounds 3                # in another
node node_modules/bare-runtime/bin/bare repro.js <dir>                   # the single-process form used by CI
```

Where it is in the source: `bare-fs/binding.c`, `bare_fs__on_watcher_event()`: `strlen(filename)` on
the status-0 path. libuv: `src/win/fs-event.c` (`handle->cb(handle, NULL, UV_CHANGE, 0)` when the
buffer overflowed) and `src/unix/kqueue.c` (`path = NULL` when `F_GETPATH` fails). The fix is to pass
`null` to JS when `filename == NULL` and guard the `Buffer.from(filename)` in `Watcher._onevent`.

_This reproduction has to run on Windows; the crash log from the build box is committed next to it
once captured._

## Environment used

macOS 15.6 arm64 (Bare 1.33.4, bare-fs 4.8.1, Node 24.19); Linux arm64 + amd64 in Docker
`node:22-slim` (kernel 6.12, Bare 1.33.4, Node 22.23).
