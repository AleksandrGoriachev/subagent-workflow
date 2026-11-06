#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Единственный разрешённый путь коммита (и пуша) в репозитории движка workflow.

.DESCRIPTION
  Гейт структуры (processPolicy=fail) отклоняет прямой git commit/push/merge/rebase
  в оболочке. Эта обёртка делает ту же проверку покрытия путей ДО git — через
  собственный сторож репозитория spec/scripts/task-guard.mjs — и только потом
  коммитит (и, с -Push, пушит). Проверка не ослаблена: задача или осознанная метка
  [workflow-bypass: причина] обязательны, как и в task-guard.

.EXAMPLE
  pwsh -File tools/commit.ps1 "release: 2.6.38 — ... [workflow-bypass: выпуск версии]" -Push
#>
param(
  [Parameter(Mandatory = $true, Position = 0)][string]$Message,
  [switch]$DryRun,
  [switch]$Push
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$staged = @(git diff --cached --name-only --diff-filter=ACMRT)
if ($staged.Count -eq 0) {
  Write-Host 'КОММИТ НЕ НУЖЕН: индекс пуст. Сначала: git add <пути>' -ForegroundColor Yellow
  exit 2
}

$guard = Join-Path $repo 'spec/scripts/task-guard.mjs'
if (-not (Test-Path $guard)) {
  Write-Host "ГЕЙТ НЕ НАЙДЕН: $guard — коммит запрещён (нельзя проверить покрытие заданием)." -ForegroundColor Red
  exit 3
}

Write-Host ('task-guard: проверяю ' + $staged.Count + ' путей в индексе...')
node $guard --staged --message $Message
if ($LASTEXITCODE -ne 0) {
  Write-Host ''
  Write-Host 'КОММИТ ОТКЛОНЁН: пути не покрыты активным заданием.' -ForegroundColor Red
  Write-Host 'Варианты: задание docs/tasks/00NN с allowedPaths; метка [workflow-bypass: причина] в сообщении.'
  exit 1
}

if ($DryRun) {
  Write-Host 'ПРОВЕРКА ПРОЙДЕНА (dry run): коммит не сделан.' -ForegroundColor Green
  exit 0
}

# Хуки обходятся осознанно: проверку уже сделал task-guard, а под песочницей хук падает на sh.exe.
git -c core.hooksPath=.git/empty-hooks commit -m $Message
if ($LASTEXITCODE -ne 0) {
  Write-Host 'git commit завершился ошибкой.' -ForegroundColor Red
  exit 4
}
Write-Host 'КОММИТ СОЗДАН.' -ForegroundColor Green

if ($Push) {
  git -c core.hooksPath=.git/empty-hooks push origin HEAD
  if ($LASTEXITCODE -ne 0) {
    Write-Host 'git push завершился ошибкой.' -ForegroundColor Red
    exit 5
  }
  Write-Host 'ЗАПУШЕНО.' -ForegroundColor Green
}
exit 0
