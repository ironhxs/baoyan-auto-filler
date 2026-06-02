{
  description = "秒填鸭 - LLM-powered Chrome extension for automatic form filling";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    { nixpkgs, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs {
          inherit system;
        };

        lib = pkgs.lib;
        nodejs = pkgs.nodejs_22;
      in
      {
        devShells.default = pkgs.mkShell {
          name = "auto-filler-dev";

          packages =
            [
              nodejs
              pkgs.git
              pkgs.cacert
            ]
            ++ lib.optionals pkgs.stdenv.isLinux [
              pkgs.chromium
              pkgs.xdg-utils
            ];

          shellHook =
            ''
              export PATH="$PWD/node_modules/.bin:$PATH"

              export npm_config_update_notifier=false
              export npm_config_fund=false
              export npm_config_audit=false
            ''
            + lib.optionalString pkgs.stdenv.isLinux ''
              export CHROME_PATH="${pkgs.chromium}/bin/chromium"
            ''
            + lib.optionalString pkgs.stdenv.isDarwin ''
              if [ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
                export CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
              elif [ -x "/Applications/Chromium.app/Contents/MacOS/Chromium" ]; then
                export CHROME_PATH="/Applications/Chromium.app/Contents/MacOS/Chromium"
              elif [ -x "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary" ]; then
                export CHROME_PATH="/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"
              else
                unset CHROME_PATH
                echo "Warning: Chrome/Chromium not found in /Applications."
                echo "Install Google Chrome or set CHROME_PATH manually."
              fi
            ''
            + ''
              echo ""
              echo "秒填鸭 (Auto Filler) dev environment"
              echo "----------------------------------------"
              echo "node:   $(node --version)"
              echo "npm:    $(npm --version)"
              echo "chrome: ''${CHROME_PATH:-not set}"
              echo ""
              echo "Quick start:"
              echo "  npm install"
              echo "  npm run dev"
              echo "  npm run build"
              echo ""
            '';
        };

        formatter = pkgs.nixfmt-rfc-style;
      }
    );
}