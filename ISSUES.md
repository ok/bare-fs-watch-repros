# Draft issues for holepunchto/bare-fs — FOR REVIEW, NOT POSTED

Two issues, each written as it would be posted, followed by the fix each would come with as a
pull request. Everything below is verified against bare-fs 4.8.1 (`binding.c`, `index.js`) and
libuv 1.52.1, and reproduced by the scripts in this repository on GitHub Actions
(run 36121193600) and locally. `<repro-url>` is this repository's URL once it is public.

---

## Issue 1 — `fs.watch()` returns a watcher that never fires and never errors when `uv_fs_event_start()` fails

### Summary

Since 3a55a9f ("Assert that `uv_fs_event_start()` succeeds", first released in 4.4.5),
`bare_fs_watcher_init` only asserts the result of `uv_fs_event_start()`:

```c
// binding.c:2610-2611 (4.8.1)
err = uv_fs_event_start(&watcher->handle, bare_fs__on_watcher_event, (char *) path, recursive ? UV_FS_EVENT_RECURSIVE : 0);
assert(err == 0);
```

The prebuilds are release builds, so the `assert` is compiled out and a failed start is discarded.
`fs.watch()` then returns a `Watcher` that never emits `'change'` and never emits `'error'`. Node
throws synchronously in the same situations.

Every failure `uv_fs_event_start()` can report is affected: a path that does not exist (`ENOENT`),
the per-user inotify limit on Linux (`ENOSPC` past `fs.inotify.max_user_watches`), and the open-file
limit for kqueue-backed file watches on macOS (`EMFILE`).

### Reproduction

`<repro-url>/i1-silent-start-failure` — one script, runs under both runtimes.

```
cd i1-silent-start-failure && npm install
node node_modules/bare-runtime/bin/bare repro.js      # bare: no throw, no error, nothing ever fires
node repro.js                                          # node: throws ENOENT
./run-linux-limit.sh                                   # Linux, Docker, privileged: max_user_watches lowered to 40, 100 dirs armed
```

Observed (macOS 15.6 arm64, Bare 1.33.4, bare-fs 4.8.1; also ubuntu-latest and windows-latest on
GitHub Actions):

```
[bare v1.33.4 (bare-fs 4.8.1)] fs.watch('<tmp>/does-not-exist') — the path does not exist
  no throw. Creating the directory and a file inside it…
  events: []  errors: []
[node v24.19.0] fs.watch('<tmp>/does-not-exist') — the path does not exist
  threw ENOENT
```

Linux, past the inotify limit (Docker `node:22-slim` arm64, `max_user_watches=40`):

```
[bare v1.33.4 (bare-fs 4.8.1)] arming 100 directory watches; fs.inotify.max_user_watches=40
  armed without throwing: 100, threw: 0, error events: 0
  watchers that never fired: 69 (indices 31…99)
[node v22.23.3] arming 100 directory watches; fs.inotify.max_user_watches=40
  first throw at index 31: ENOSPC
  armed without throwing: 31, threw: 69, error events: 0
  watchers that never fired: 0
```

### Why it matters

A caller cannot distinguish a dead watch from a healthy one. For a file watcher that means a folder
that silently stops reporting changes with no error anywhere — the one failure mode a watcher must
never have. To cope, [chokibare](https://github.com/ok/chokibare) has to ask the kernel after every
arm on Linux (read `/proc/self/fdinfo/<inotify fd>` and check the watch is listed) and has no
equivalent for `EMFILE` on macOS at all.

### Probable cause of the change

Before 3a55a9f the failure path threw — but only after `uv_fs_event_init()` had already registered
the handle with the loop, and without closing it. The handle lives inside a JS-owned `ArrayBuffer`,
so that was a use-after-free once the buffer was collected; the `assert` removed the unsafe path in
one line. The proper fix keeps the buffer alive until libuv has released the handle.

### Proposed fix (would come as a PR)

```c
// binding.c, bare_fs_watcher_init(), replacing the assert
err = uv_fs_event_start(&watcher->handle, bare_fs__on_watcher_event, (char *) path, recursive ? UV_FS_EVENT_RECURSIVE : 0);

if (err < 0) {
  // The handle is already registered with the loop; keep the buffer referenced until libuv
  // has released it, then throw the libuv error like Node does.
  watcher->env = env;

  err = js_create_reference(env, result, 1, &watcher->self);
  assert(err == 0);

  uv_close((uv_handle_t *) &watcher->handle, bare_fs__on_watcher_start_failed);

  err = js_throw_error(env, uv_err_name(err), uv_strerror(err));
  assert(err == 0);

  return NULL;
}

static void
bare_fs__on_watcher_start_failed(uv_handle_t *handle) {
  bare_fs_watcher_t *watcher = (bare_fs_watcher_t *) handle;

  js_handle_scope_t *scope;
  js_open_handle_scope(watcher->env, &scope);

  js_delete_reference(watcher->env, watcher->self);

  js_close_handle_scope(watcher->env, scope);
}
```

(`self` is a new `js_ref_t *` field on `bare_fs_watcher_t`; the exact shape should follow how the
other bindings in this repo handle a failed start after a successful init.)

Plus a test — there is no `watch` coverage in `test.js` today:

```js
test('watch: a missing path throws ENOENT', (t) => {
  t.exception(() => fs.watch('/does/not/exist'), /ENOENT/)
})
```

---

## Issue 2 — the watcher event callback dereferences a NULL filename and crashes the process

### Summary

`bare_fs__on_watcher_event` calls `strlen(filename)` without checking for `NULL`:

```c
// binding.c:2445, :2492 (4.8.1)
bare_fs__on_watcher_event(uv_fs_event_t *handle, const char *filename, int events, int status) {
  …
    size_t len = strlen(filename);
```

libuv passes `filename == NULL` in two documented situations:

- **Windows**, when the `ReadDirectoryChangesW` buffer overflows (`src/win/fs-event.c`:
  `handle->cb(handle, NULL, UV_CHANGE, 0)`). libuv's buffer is 4096 bytes
  (`uv_directory_watcher_buffer_size`), roughly 50–100 change records, so any burst of changes in
  one watched directory — an unzip, a `git checkout`, a download finishing — overflows it.
- **macOS**, kqueue-backed file watches, when `F_GETPATH` fails (`src/unix/kqueue.c`: `path = NULL`).

Node delivers these as a `'change'` event whose filename is `null`; bare-fs crashes.

### Reproduction

`<repro-url>/i2-null-filename` — Windows.

```
cd i2-null-filename && npm install
node node_modules/bare-runtime/bin/bare repro.js <dir>    # recursive watch, then 50 000 file creates
node repro.js <dir>                                        # control
```

Observed on GitHub Actions `windows-latest` (Bare 1.33.4, bare-fs 4.8.1, Node 22.23.2),
run 36121193600, job "Issue 2 / NULL filename / windows":

```
[bare v1.33.4 (bare-fs 4.8.1)] recursive watch on D:\a\_temp/burst-bare, then a burst of 50000 file creates
##[error]Process completed with exit code 139.

[node v22.23.2] recursive watch on D:\a\_temp/burst-node, then a burst of 50000 file creates
  events: 2, events with a null filename: 1
```

Exit code 139 is a segmentation fault. The same crash killed a chokibare test run on
`windows-latest` on a burst of only 500 appends to one file under a single-directory watch, so it
is not specific to recursive watches or to huge bursts.

### Why it matters

Any Bare process watching a directory on Windows dies as soon as that directory gets busy, and
nothing in JavaScript can prevent it (the crash is in the callback before JS runs). A `null`
filename is exactly the signal a watcher needs — "events were lost, rescan this directory" — so
delivering it is more useful than any alternative.

### Proposed fix (would come as a PR)

```c
// binding.c, bare_fs__on_watcher_event(): pass null to JS when libuv reports no filename
js_value_t *argv[3];

if (filename == NULL) {
  err = js_get_null(env, &argv[2]);
  assert(err == 0);
} else {
  size_t len = strlen(filename);
  err = js_create_string_utf8(env, (const utf8_t *) filename, len, &argv[2]);
  assert(err == 0);
}
```

and in `Watcher._onevent` (`index.js:2665-2682`), guard the `Buffer.from(filename)`:

```js
const path =
  filename === null
    ? null
    : this._encoding === 'buffer'
      ? Buffer.from(filename)
      : Buffer.from(filename).toString(this._encoding)
```

Documenting `'change'` with a `null` filename as "the backend lost events; rescan" would match Node.

---

## Possible follow-ups, not proposed for filing now

- `bare_fs_watcher_init` copies the path into a `4096 + 1` byte buffer
  (`binding.c:28`, `:2584`) and silently truncates longer paths; throwing `ENAMETOOLONG` would be
  clearer. The same pattern probably applies to other path-taking bindings, so it wants a survey
  first.
- `fs.watch` has no README section and no tests in `test.js`; the reproduction scripts here could
  seed a test set.
