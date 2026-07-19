{
  description = "Coax Electron development environment";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { nixpkgs, ... }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in
    {
      devShells = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          default = pkgs.mkShell {
            packages = with pkgs; [
              cacert
              corepack
              ffmpeg
              git
              gnumake
              mpv
              nodejs_24
              pkg-config
              python3
              stdenv.cc
            ];

            shellHook = ''
              export COREPACK_HOME="$PWD/.cache/corepack"
              export PNPM_HOME="$PWD/.cache/pnpm"
              export PATH="$PNPM_HOME:$PATH"
              echo "Coax shell: Node $(node --version), Corepack $(corepack --version), ffmpeg $(ffmpeg -version | head -n 1), mpv $(mpv --version | head -n 1)"
            '';
          };
        }
      );

      checks = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          node-major = pkgs.runCommand "coax-node-major" { nativeBuildInputs = [ pkgs.nodejs_24 ]; } ''
            test "$(node -p 'process.versions.node.split(`.`)[0]')" = 24
            touch $out
          '';
        }
      );

      formatter = forAllSystems (system: nixpkgs.legacyPackages.${system}.nixfmt);
    };
}
