<#
Rebuild navigator-female.glb from the recorded Meshy tasks.
Run in the repository root with a working Meshy API key registered as documented in meshy.mjs.
The original Meshy input views are represented by the recorded multi-image-to-3D task. The
tracked front plate is used for the small cheek repair. Temporary downloads stay under .qa.
#>
param(
  [string]$Scratch = '.qa/female-character/build',
  [switch]$SkipDownload,
  [string]$BackPlate = '',
  [string]$FrontPlate = ''
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$scratchPath = [System.IO.Path]::GetFullPath((Join-Path $repo $Scratch))
New-Item -ItemType Directory -Force $scratchPath | Out-Null
$tasks = Get-Content (Join-Path $PSScriptRoot 'female-tasks.json') -Raw | ConvertFrom-Json
if (-not $tasks.multiImageTo3d -or -not $tasks.rig -or -not $tasks.idleAnimation) {
  throw 'female-tasks.json is incomplete; all three Meshy task ids are required.'
}
$m2m = Join-Path $scratchPath 'm2m'
$rig = Join-Path $scratchPath 'rig'
$idle = Join-Path $scratchPath 'idle'
if (-not $SkipDownload) {
  & node (Join-Path $PSScriptRoot 'meshy.mjs') download m2m $tasks.multiImageTo3d $m2m
  if ($LASTEXITCODE -ne 0) { throw 'Meshy mesh download failed.' }
  & node (Join-Path $PSScriptRoot 'meshy.mjs') download rig $tasks.rig $rig
  if ($LASTEXITCODE -ne 0) { throw 'Meshy rig download failed.' }
  & node (Join-Path $PSScriptRoot 'meshy.mjs') download anim $tasks.idleAnimation $idle
  if ($LASTEXITCODE -ne 0) { throw 'Meshy idle download failed.' }
}
$rigGlb = Join-Path $rig 'result.rigged_character_glb_url.glb'
$albedo = Join-Path $m2m 'texture_urls.0.base_color.png'
$idleGlb = Join-Path $idle 'result.animation_glb_url.glb'
$walkGlb = Join-Path $rig 'result.basic_animations.walking_glb_url.glb'
$runGlb = Join-Path $rig 'result.basic_animations.running_glb_url.glb'
foreach ($file in @($rigGlb, $albedo, $idleGlb, $walkGlb, $runGlb)) {
  if (-not (Test-Path -LiteralPath $file)) { throw "Missing Meshy output: $file" }
}
$atlas = Join-Path $scratchPath 'navigator-female-albedo.png'
$sidecar = Join-Path $scratchPath 'navigator-female-albedo.json'
$frontSource = if ($FrontPlate) { [System.IO.Path]::GetFullPath($FrontPlate) }
  else { Join-Path $PSScriptRoot 'plates/navigator-female-front.png' }
if (-not (Test-Path -LiteralPath $frontSource)) { throw "Missing front plate: $frontSource" }
$albedoArgs = @((Join-Path $PSScriptRoot 'albedo.py'), '--glb', $rigGlb,
  '--albedo', $albedo, '--out', $atlas, '--sidecar', $sidecar, '--face-front', $frontSource)
if ($BackPlate) {
  $albedoArgs += @('--back', [System.IO.Path]::GetFullPath($BackPlate))
} else {
  $albedoArgs += '--no-project'
}
& python @albedoArgs
if ($LASTEXITCODE -ne 0) { throw 'Albedo preparation failed.' }
$output = Join-Path $repo 'client/assets/player-character/navigator-female.glb'
& 'C:/Apps/Blender/blender.exe' --background --factory-startup --python-exit-code 1 `
  --python (Join-Path $PSScriptRoot 'build_navigator.py') -- `
  --rig $rigGlb --clip "idle=$idleGlb" --clip "walk=$walkGlb" --clip "run=$runGlb" `
  --albedo $atlas --sidecar $sidecar --head 1.38 --hands 1.25 --feet 1.2 --torso 1.08 `
  --smooth-face 1 `
  --out $output
if ($LASTEXITCODE -ne 0) { throw 'Blender character build failed.' }
& node (Join-Path $PSScriptRoot 'manifest.mjs') $output `
  (Join-Path $repo 'client/assets/player-character/female-manifest.json') --female
if ($LASTEXITCODE -ne 0) { throw 'Female manifest generation failed.' }
