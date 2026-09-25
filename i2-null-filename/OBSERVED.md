# Observed output

Captured 2026-09-25 on GitHub Actions `windows-latest` (Bare 1.33.4, bare-fs 4.8.1, Node 22.23.2),
workflow run 36121193600, job "Issue 2 / NULL filename / windows".

## bare (observed)

```
[bare v1.33.4 (bare-fs 4.8.1)] recursive watch on D:\a\_temp/burst-bare, then a burst of 50000 file creates
##[error]Process completed with exit code 139.
```

Exit code 139 is a segmentation fault: `bare_fs__on_watcher_event` calls `strlen()` on the NULL
filename libuv passes when the ReadDirectoryChangesW buffer overflowed.

## node (control)

```
[node v22.23.2] recursive watch on D:\a\_temp/burst-node, then a burst of 50000 file creates
  events: 2, events with a null filename: 1
  Node: the overflow arrived as null-filename events (rescan signal)
```

Node delivers the same overflow as a `'change'` event whose filename is `null`: the signal a watcher
needs to rescan.
