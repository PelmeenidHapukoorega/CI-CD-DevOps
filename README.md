# CI/CD and DevOps

Learning DevOps tool by tool: Get it running, connect it to something real, break it, then add complexity. Building toward AZ-400 and a portfolio that actually demonstrates CI/CD practices.

## Approach

Each tool gets its own folder with:
- `README.md`: Where i have explained how its set up, why i set it up, errors i ran into and everything documented in raw format so my learning can be visually seen. 
- `Screenshots`: Where i have added evidence that i did in fact check it, set it up and overall showcasing.

## Tools

| Tool | Status | Notes |
|---|---|---|
| [Gitea](./gitea) | Done | Self-hosted git, backup + remote for everything else here |
| Jenkins | Planned | Self-hosted CI/CD |
| K3s | Planned | Lightweight local Kubernetes |
| ArgoCD | Planned | GitOps on K3s |
| Ansible | Planned | Config management, extending existing playbook |
| Grafana/Prometheus | Planned | Observability stack |
| AI agent layer | Planned | Automation/incident-response experiments |
| Azure DevOps Pipelines | Planned | Ported pipeline, AZ-400 focus |

## Infra

Self hosted pieces run on a home lab laptop (Ubuntu Server) acting as the always on/onprem node, reachable via static IP over a direct link to my workstation. Azure handles the cloud side pieces (AKS, Azure DevOps).