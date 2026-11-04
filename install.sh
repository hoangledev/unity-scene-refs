#!/bin/bash
# Unity Scene References — installer for VS Code, Cursor and Antigravity IDE.
#
# From a clone of the repo:   ./install.sh [/path/to/UnityProject]
# Without cloning:            curl -fsSL https://raw.githubusercontent.com/hoangledev/unity-scene-refs/main/install.sh | bash -s -- [/path/to/UnityProject]
#
# When a Unity project path is given, the Editor bridge script is installed into
# <project>/Assets/Editor/UnitySceneRefs/, or an existing bridge (including a legacy
# CursorBridge.cs) is updated in place to the latest version.
set -e

REPO_RAW="https://raw.githubusercontent.com/hoangledev/unity-scene-refs/main"
UNITY_PROJECT="${1:-}"

SCRIPT_DIR=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# Use the file from the local clone when present, otherwise download it from GitHub.
fetch() {
    local rel="$1" out="$2"
    if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/$rel" ]; then
        cp "$SCRIPT_DIR/$rel" "$out"
    else
        curl -fsSL "$REPO_RAW/$rel" -o "$out"
    fi
}

echo "=========================================================="
echo "  Unity Scene References — Installer"
echo "  Supports: Visual Studio Code, Cursor, Antigravity IDE"
echo "=========================================================="
echo ""

VSIX_FILE="$TMP_DIR/unity-scene-refs.vsix"
fetch "dist/unity-scene-refs.vsix" "$VSIX_FILE"
echo "Package: dist/unity-scene-refs.vsix"

echo ""
echo "── Detecting Editors & Installing Extension ──"

INSTALLED_ANY=false

# $1 = display name, $2 = CLI name, rest = app bundle paths to try
install_into() {
    local name="$1" cli="$2" bin=""
    shift 2
    if command -v "$cli" &>/dev/null; then
        bin="$cli"
    else
        for app in "$@"; do
            if [ -f "$app" ]; then bin="$app"; break; fi
        done
    fi
    if [ -n "$bin" ]; then
        echo "• Found $name: $bin"
        if "$bin" --install-extension "$VSIX_FILE" --force; then
            echo "  ✅ Installed to $name!"
            INSTALLED_ANY=true
        else
            echo "  ⚠️  Failed to install into $name"
        fi
    fi
}

VSCODE_APP="$(mdfind "kMDItemCFBundleIdentifier == 'com.microsoft.VSCode'" 2>/dev/null | head -n 1)"
install_into "Visual Studio Code" code \
    "${VSCODE_APP:+$VSCODE_APP/Contents/Resources/app/bin/code}" \
    "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
    "$HOME/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"
install_into "Cursor" cursor \
    "/Applications/Cursor.app/Contents/Resources/app/bin/cursor" \
    "$HOME/Applications/Cursor.app/Contents/Resources/app/bin/cursor"
install_into "Antigravity IDE" antigravity-ide \
    "/Applications/Antigravity IDE.app/Contents/Resources/app/bin/antigravity-ide" \
    "$HOME/Applications/Antigravity IDE.app/Contents/Resources/app/bin/antigravity-ide"

if [ "$INSTALLED_ANY" = false ]; then
    cp "$VSIX_FILE" "$HOME/Downloads/unity-scene-refs.vsix"
    echo "⚠️  No editor CLI detected. Saved the package to ~/Downloads/unity-scene-refs.vsix"
    echo "   Install it via Cmd+Shift+P → 'Extensions: Install from VSIX...'"
fi

echo ""
echo "── Unity Editor Bridge ──"
if [ -z "$UNITY_PROJECT" ]; then
    echo "  (skipped) Pass your Unity project path to install the bridge script, e.g.:"
    echo "  ./install.sh ~/Projects/MyGame"
elif [ ! -d "$UNITY_PROJECT/Assets" ]; then
    echo "  ⚠️  '$UNITY_PROJECT' is not a Unity project (no Assets folder) — bridge not installed"
else
    LATEST_BRIDGE="$TMP_DIR/UnitySceneRefsBridge.cs"
    fetch "unity-editor-script/UnitySceneRefsBridge.cs" "$LATEST_BRIDGE"
    # The bridge ships with a fixed .meta GUID so every install, on every branch, produces
    # byte-identical files and merges without .meta conflicts.
    fetch "unity-editor-script/UnitySceneRefsBridge.cs.meta" "$LATEST_BRIDGE.meta"

    # Folders created by this installer also get fixed GUIDs (Unity would otherwise generate
    # random ones per machine). $1 = folder path, $2 = GUID.
    make_folder() {
        [ -d "$1" ] && return
        mkdir -p "$1"
        [ -f "$1.meta" ] || printf 'fileFormatVersion: 2\nguid: %s\nfolderAsset: yes\nDefaultImporter:\n  externalObjects: {}\n  userData: \n  assetBundleName: \n  assetBundleVariant: \n' "$2" > "$1.meta"
    }

    CURRENT="$(find "$UNITY_PROJECT/Assets" -name UnitySceneRefsBridge.cs -print -quit)"
    CHANGED=false

    # Legacy CursorBridge.cs: rename in place, or remove it when the
    # project already has UnitySceneRefsBridge.cs — two bridges would fight over the same port.
    while IFS= read -r legacy; do
        [ -n "$legacy" ] || continue
        if [ -n "$CURRENT" ]; then
            rm -f "$legacy" "$legacy.meta"
            echo "  🗑  Removed duplicate legacy bridge: ${legacy#$UNITY_PROJECT/}"
        else
            CURRENT="$(dirname "$legacy")/UnitySceneRefsBridge.cs"
            mv "$legacy" "$CURRENT"
            [ -f "$legacy.meta" ] && mv "$legacy.meta" "$CURRENT.meta"
            echo "  🔁 Renamed ${legacy#$UNITY_PROJECT/} → UnitySceneRefsBridge.cs"
        fi
        CHANGED=true
    done < <(find "$UNITY_PROJECT/Assets" -name CursorBridge.cs)

    if [ -z "$CURRENT" ]; then
        CURRENT="$UNITY_PROJECT/Assets/Editor/UnitySceneRefs/UnitySceneRefsBridge.cs"
        make_folder "$UNITY_PROJECT/Assets/Editor" b2eda7cb896d5cec08e7102be3422eb8
        make_folder "$UNITY_PROJECT/Assets/Editor/UnitySceneRefs" e326e6e4bf9f7c37279011f2c6ee101a
        cp "$LATEST_BRIDGE" "$CURRENT"
        echo "  ✅ Copied bridge to ${CURRENT#$UNITY_PROJECT/}"
        CHANGED=true
    elif ! cmp -s "$LATEST_BRIDGE" "$CURRENT"; then
        cp "$LATEST_BRIDGE" "$CURRENT"
        echo "  ⬆️  Updated bridge to the latest version: ${CURRENT#$UNITY_PROJECT/}"
        CHANGED=true
    else
        echo "  ✅ Bridge is up to date: ${CURRENT#$UNITY_PROJECT/}"
    fi

    # The bridge is a static editor class that nothing references by GUID, so switching an
    # older random GUID to the fixed one is safe.
    if ! cmp -s "$LATEST_BRIDGE.meta" "$CURRENT.meta"; then
        cp "$LATEST_BRIDGE.meta" "$CURRENT.meta"
        echo "  🔑 Set fixed GUID in ${CURRENT#$UNITY_PROJECT/}.meta"
        CHANGED=true
    fi

    if [ "$CHANGED" = true ]; then
        echo "  👉 Commit the bridge changes to your game repo so the whole team gets them."
    fi
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Done! Reload your editor: Cmd+Shift+P → 'Developer: Reload Window'"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
