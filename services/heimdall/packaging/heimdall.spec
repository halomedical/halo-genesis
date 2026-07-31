# -*- mode: python ; coding: utf-8 -*-
"""Reproducible source definition for the unsigned Heimdall.exe agent binary."""

from PyInstaller.utils.hooks import collect_submodules


hiddenimports = (
    collect_submodules("watchdog.observers")
    + collect_submodules("PIL")
    + ["pytesseract"]
)

a = Analysis(
    ["halo_sentry/__main__.py"],
    pathex=["."],
    binaries=[],
    datas=[],
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["googleapiclient", "google.oauth2"],
    noarchive=False,
    optimize=1,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="Heimdall",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch="x86_64",
)
