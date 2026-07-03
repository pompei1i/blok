#!/usr/bin/env bash
# $blok builder — installs system deps + Rust if missing, then builds the installer
set -euo pipefail

CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; RED='\033[0;31m'; NC='\033[0m'

cd "$(dirname "${BASH_SOURCE[0]}")"

echo -e "\n${CYAN}==> Checking system packages...${NC}"

PKGS=(libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev patchelf libasound2-dev)
MISSING=()
for pkg in "${PKGS[@]}"; do
    dpkg -s "$pkg" >/dev/null 2>&1 || MISSING+=("$pkg")
done

if [ "${#MISSING[@]}" -gt 0 ]; then
    echo -e "    ${YELLOW}Missing: ${MISSING[*]}. Installing (needs sudo)...${NC}"
    sudo apt-get update
    sudo apt-get install -y "${MISSING[@]}"
else
    echo -e "    ${GREEN}All system packages present.${NC}"
fi

echo -e "\n${CYAN}==> Checking Rust...${NC}"

if command -v rustc >/dev/null 2>&1; then
    echo -e "    ${GREEN}Rust found: $(rustc --version)${NC}"
else
    echo -e "    ${YELLOW}Rust not found. Installing via rustup...${NC}"
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal
    source "$HOME/.cargo/env"
    echo -e "    ${GREEN}Rust installed: $(rustc --version)${NC}"
fi

echo -e "\n${CYAN}==> Installing npm dependencies...${NC}"
npm install

echo -e "\n${CYAN}==> Building \$blok installer (this takes a few minutes)...${NC}"
npm run tauri build

BUNDLE_DIR="src-tauri/target/release/bundle"
FOUND=0
for f in "$BUNDLE_DIR"/deb/*.deb "$BUNDLE_DIR"/rpm/*.rpm "$BUNDLE_DIR"/appimage/*.AppImage; do
    [ -e "$f" ] || continue
    echo -e "${GREEN}    $f${NC}"
    FOUND=1
done

if [ "$FOUND" -eq 1 ]; then
    echo -e "\n${GREEN}==> Done! Installer(s) above.${NC}"
else
    echo -e "\n${GREEN}==> Done! Check $BUNDLE_DIR/${NC}"
fi
