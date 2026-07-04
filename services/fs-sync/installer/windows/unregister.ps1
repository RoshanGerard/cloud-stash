# Deregisters the cloudstash-sync Scheduled Task. Idempotent — absent task is OK.
# Invoked by apps/desktop's electron-builder `afterUninstall` hook.

$taskName = "cloudstash-sync"
schtasks /Delete /TN $taskName /F 2>$null
Write-Host "cloudstash-sync: Scheduled Task deregistered (if present)"
exit 0
