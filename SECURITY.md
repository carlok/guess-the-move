# Security

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private vulnerability reporting on this repository
(Security tab, "Report a vulnerability"). Say what you found, how to reproduce it, and which version (the commit or the build id in
`version.json` of a `make dist` build).

## What is in scope

- The static site (`web/`): cross-site scripting, a way around the content security policy, anything that sends your stats or
  moves anywhere (the page is meant to keep them in your browser).
- The optional `api` service (`api/`): input validation, request limits, rate limiting, cross-origin POSTs (refused by design).
- The container images and the deploy notes (`containers/`, `docs/deploy.md`).
- Files you can import (the stats file) are treated as untrusted input; a crafted file that does anything but fail cleanly is a bug.

## Not in scope

Chess results being wrong (use the "Report a problem with this position" link), or the limits of the level estimate (they are
documented on the page).

## Supported versions

Only the latest commit on `main`.
