# Gitea

Self-hosted Git server running in Docker on the home lab laptop.

## Why

Local backup of repos independent of GitHub, and the git remote that later tools here (Jenkins, ArgoCD) will point at.

## Setup

- Runs via Docker on the home lab laptop
- Web UI on port 3000, SSH on port 2222 (22 already taken by the hosts own SSH)
- Data persisted in a Docker named volume