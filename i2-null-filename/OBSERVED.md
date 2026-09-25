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

## After the fix — bare-fs 4.8.2 (holepunchto/bare-fs#53), same runner, same burst

Workflow run 36180367510, job "Issue 2 / NULL filename / windows / bare-fs 4.8.2", with no
`continue-on-error` on the bare step:

```
bare-fs 4.8.2
[bare v1.33.4 (bare-fs 4.8.2)] recursive watch on D:\a\_temp/burst-bare, then a burst of 50000 file creates
  events: 2, events with a null filename: 1
bare exit code: 0
```

The Bare observer survives and reports the overflow as a `null`-filename event, exactly as Node
does. The 4.8.1 job in the same run still exits with code 139.

## Physical Windows machine, 2026-09-25

Same commands, same box (`C:\Users\Mirall`, Bare 1.33.4), first with 4.8.1 and then with 4.8.2:

```
> npm install bare-fs@4.8.1 --no-save
> node node_modules\bare-runtime\bin\bare repro.js $env:TEMP\burst2 50000; "exit=$LASTEXITCODE"
[bare v1.33.4 (bare-fs 4.8.1)] recursive watch on C:\Users\Mirall\AppData\Local\Temp\burst2, then a burst of 50000 file creates
exit=-1073741819

> npm install bare-fs@4.8.2 --no-save
> node node_modules\bare-runtime\bin\bare repro.js $env:TEMP\burst2 50000; "exit=$LASTEXITCODE"
[bare v1.33.4 (bare-fs 4.8.2)] recursive watch on C:\Users\Mirall\AppData\Local\Temp\burst2, then a burst of 50000 file creates
  events: 2, events with a null filename: 1
exit=0
```

`-1073741819` is `0xC0000005`, an access violation: the process died in the callback before any
JavaScript ran. On 4.8.2 the same overflow is delivered as one `null`-filename event.

Note: `run-windows.ps1` (observer and load in separate processes) did not overflow on this machine
even with a 2 s stall — the watching process drained in time. The single-process `repro.js`, where
the burst runs inside the watching process, is the deterministic form.
