# opencode-workspace-env

## 0.1.2

### Patch Changes

- [`6b6960b`](https://github.com/yimsk/opencode-workspace-env/commit/6b6960b7454812af51b6bdba9833e7d71111ed36) Thanks [@yimsk](https://github.com/yimsk)! - Merge nix PATH with existing PATH instead of replacing it (deduplicated, nix paths first)

## 0.1.1

### Patch Changes

- [#1](https://github.com/yimsk/opencode-workspace-env/pull/1) [`b8a8b5b`](https://github.com/yimsk/opencode-workspace-env/commit/b8a8b5b0c45ee7c3477cdab70f1fb5c285b532b5) Thanks [@yimsk](https://github.com/yimsk)! - Filter system identity variables (HOME, USER, LOGNAME, SHELL, HOSTNAME) from env injection to prevent overriding host values
