# Repository Agent Instructions

## Nix development environment

This repository's required development tools are provided by the default Nix
development shell in `flake.nix`. A tool missing from the host `PATH` is not by
itself a blocker when that tool is available in the dev shell.

Run one-off commands with:

```bash
nix develop --command <command> [arguments...]
```

## GitHub CLI

Use the Nix-provided GitHub CLI rather than requiring a host installation:

```bash
nix develop --command gh <arguments...>
```

For example:

```bash
nix develop --command gh auth status
nix develop --command gh pr view
```

Only ask the user to install or authenticate `gh` after the Nix-provided CLI
has also been checked and is unavailable or unauthenticated.
