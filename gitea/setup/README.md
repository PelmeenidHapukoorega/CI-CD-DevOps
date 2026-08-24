# Setup

Installing and configuring Gitea in Docker on the home lab laptop.

## What
- Gitea running as a Docker container
- Web UI on port 3000
- SSH (git operations) on port 2222, 22 already used by the hosts own SSH
- Data persisted in a named Docker volume (`gitea-data`)

## Why these choices
- Docker over bare-metal install: consistent with the rest of this repos tooling, easy to tear down/rebuild
- Port 2222 instead of 22: avoids conflicting with the host SSH server used for remote management