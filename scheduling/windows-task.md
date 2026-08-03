# Windows server — Task Scheduler

PowerShell, as the user who will run it:

```powershell
$action  = New-ScheduledTaskAction -Execute "C:\Program Files\Git\bin\bash.exe" `
           -Argument "-lc '/c/Users/YOU/github-web/scripts/sync.sh --publish'"
$trigger = @(
  New-ScheduledTaskTrigger -Daily -At 00:00
  New-ScheduledTaskTrigger -Daily -At 08:00
  New-ScheduledTaskTrigger -Daily -At 16:00
)
Register-ScheduledTask -TaskName "github-web" -Action $action -Trigger $trigger `
  -Description "Refresh the GitHub channel data"
```

Notes:

- `sync.sh` is bash. Use Git Bash or WSL — there is no `.cmd` equivalent shipped,
  because the whole point is one script across all four platforms.
- Under WSL, schedule `wsl.exe -e /home/YOU/github-web/scripts/sync.sh --publish`
  instead, and put the credentials in the WSL-side `.env`.
- Task Scheduler does not load your shell profile, so `node` must be on the system
  PATH (not just your user PATH) or invoked by absolute path.
- To run when the machine was asleep at the scheduled time, tick
  **"Run task as soon as possible after a scheduled start is missed"** in the task's
  Settings tab. It is off by default — this is the Windows equivalent of
  systemd's `Persistent=true`.
