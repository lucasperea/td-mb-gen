<#
  Snapshots a folder of live marketing box JSON files (top level only, *.json) into a script the app can load
  with one click. Re-run it whenever the folder changes.

  Example:
    .\build-current-state.ps1 -Folder "..\..\2026\11_Nov\19\app\marketing-box" -Id "2026-11-19" -Label "11/19 · app/marketing-box"
#>
param(
  [Parameter(Mandatory)][string]$Folder,
  [Parameter(Mandatory)][string]$Id,
  [Parameter(Mandatory)][string]$Label,
  [string]$Out = ""
)
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Out) { $Out = Join-Path (Join-Path $root 'current-state') "$Id.js" }
$files = Get-ChildItem -LiteralPath $Folder -File -Filter *.json | Sort-Object Name   # no -Recurse: no subfolders
$entries = foreach ($f in $files) {
  $txt = [IO.File]::ReadAllText($f.FullName).TrimStart([char]0xFEFF)
  '{"file":' + ($f.Name | ConvertTo-Json) + ',"text":' + ($txt | ConvertTo-Json) + '}'
}
$js = "window.CURRENT_STATES = window.CURRENT_STATES || {};`n" +
      "window.CURRENT_STATES[" + ($Id | ConvertTo-Json) + "] = {`"label`":" + ($Label | ConvertTo-Json) + ",`"files`":[`n" +
      ($entries -join ",`n") + "`n]};`n"
New-Item -ItemType Directory -Force -Path (Split-Path $Out) | Out-Null
[IO.File]::WriteAllText($Out, $js, (New-Object Text.UTF8Encoding $false))
"Wrote $Out ($($files.Count) files)"
