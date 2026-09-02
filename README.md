# CI/CD and DevOps

Learning DevOps tool by tool: Get it running, connect it to something real, break it, then add complexity. Building toward AZ-400 and a portfolio that actually demonstrates CI/CD practices.

Repo also contains my self hosted homelab where i run all the tooling myself to gain better understanding about each one and move on gradually towards more complexity

## Approach

Each tool gets its own folder with:
- `README.md`: Where i have explained how its set up, why i set it up, errors i ran into and everything documented in raw format so my learning can be visually seen. 
- `Screenshots`: Where i have added evidence that i did in fact check it, set it up and overall showcasing.

## Tools

| Tool | Status | Notes |
|---|---|---|
| [Gitea](./gitea) | Done | Self-hosted git, backup + remote for everything else here |
| [Jenkins](./jenkins/setup/README.md) | Planned | Self-hosted CI/CD |
| [K3s](./k3s/setup) | Done | Lightweight local Kubernetes |
| ArgoCD | Planned | GitOps on K3s |
| Ansible | Planned | Config management, extending existing playbook |
| [Grafana/Prometheus](./prometheus-grafana/setup) | Done | Observability stack — node_exporter + cAdvisor scraped by Prometheus, visualized in Grafana |
| AI agent layer | Planned | Automation/incident-response experiments |
| Azure DevOps Pipelines | Planned | Ported pipeline, AZ-400 focus |

## Infra

Self hosted pieces run on a home lab laptop (Ubuntu Server) acting as the always on/onprem node, reachable via static IP over a direct link to my workstation. Azure handles the cloud side pieces (AKS, Azure DevOps).

I still have another PC laying around at home but still pondering on what to do with it and how to incorporate it to my day to day. Also as a sidenote i will mention that every single project and thing i have ran across the repos has been done with inconsistent network running at 500kbs at max, this alone takes quite a lot of discipline and patience lol.

I also started running into issues while hosting different services on the server so i figured im gonna add a section to this readme with specific problems i ran into and what i did to either mitigate them or fix them completely.

## Table of contents

### Homelab issues

1. [Jenkins left running, RAM exhaustion](#jenkins-left-running-ram-exhaustion)

### Jenkins left runnig, RAM exhaustion

Immediate fix: stopped unattended jenkins container. This led to idea of migrating self hosted services onto K3s for proper per workload resource limits and also getting more hands on with K3s which would then build on understanding K8s later.
