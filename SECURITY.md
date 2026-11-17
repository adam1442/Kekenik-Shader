# Security Policy

## Supported Versions

Kekenik Shader is currently in early preview (`0.1.x`). Security fixes are applied to the latest `0.1.x` release on the `main` branch.

| Version | Supported |
|---|---|
| `0.1.x` | :white_check_mark: |
| `< 0.1.0` | :x: |

## Security Model Overview

Kekenik Shader is a static client-side web application that runs entirely in the user's browser:
- No user data, shader graphs, or assets are uploaded to any remote server.
- Areas of security relevance include untrusted `.kshader` / `.kshadersub` project file parsing, SVG/asset imports, DOM rendering (XSS prevention), and zip archive path sanitization (`src/core/export/bundle.ts`).

## Reporting a Vulnerability

Please **do not** report security vulnerabilities through public GitHub issues.

Instead, please report them privately by emailing:
- **hossein.r.1442@gmail.com** (Maintainer: `@adam1442`)

Please include:
1. A description of the vulnerability and its potential impact.
2. Step-by-step instructions or a minimal `.kshader` file / reproduction case to trigger the issue.
3. Any suggested mitigation or patch, if available.

You can expect an initial acknowledgment within **72 hours**, followed by a status update once the issue has been triaged.
