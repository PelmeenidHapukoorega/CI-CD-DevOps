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
| [Jenkins](./jenkins/setup/) | Done | Self-hosted CI/CD |
| [K3s](./k3s/setup) | Done | Lightweight local Kubernetes |
| [ArgoCD](./argocd/setup/) | Done | GitOps on K3s |
| Ansible | Planned | Config management, extending existing playbook |
| [Grafana/Prometheus](./prometheus-grafana/setup) | Done | Observability stack — node_exporter + cAdvisor scraped by Prometheus, visualized in Grafana |
| AI agent layer | Planned | Automation/incident-response experiments |
| Azure DevOps Pipelines | Planned | Ported pipeline, AZ-400 focus |

## Infra

Self hosted pieces run on a home lab laptop (Ubuntu Server) acting as the always on/onprem node, reachable via static IP over a direct link to my workstation. Azure handles the cloud side pieces (AKS, Azure DevOps).

I still have another PC laying around at home but still pondering on what to do with it and how to incorporate it to my day to day. Also as a sidenote i will mention that every single project and thing i have ran across the repos has been done with inconsistent network running at 500kbs at max, this alone takes quite a lot of discipline and patience lol.

I also started running into issues while hosting different services on the server so i figured im gonna add a section to this readme with specific problems i ran into and what i did to either mitigate them or fix them completely.

### Infra update 21.09.26

Ever since the writing above the single Docker host has grown into K3s cluster running most of my self hosted stack:

* Jenkins
* ArgoCD
* Gitea (git + container registry)
* Prometheus/Grafana for monitoring
* Pi-Hole as local DNS
* Homarr as internal launcher tying it all together.

Everything sits behind ingress (Traefik) with self hosted CA through cert-manager so every internal service gets real HTTPS instead of browser warnings.

Remote access is handled through Tailscale with split DNS so i could reach anything at `.hermitden` from my phone or laptop without exposing single port publicly.

Only thing being public is the portfolio landing page (constantly in development), exposed through cloudflare tunnel since my home connection sits behind CGNAT, with the whole thing wired into CI-CD pipeline (Jenkins + Kaniko + ArgoCD) so pushing to the repo is what actually ships changes to the live site which is what this project eventually evolved into:

The entire purpose is to have a live environment where i could push changes into and genuinely practice CI/CD devops as close to the production environment i could think of getting without having a job yet. 

My intention is figure out stuff as i go and how i could turn this in time into smt more interesting. 

Current idea is to have it as a portfolio site with everything in 1 place to make it easier for recruiters but i dont want it to be just that, i want it to be a visible live portfolio piece.

### Infra update

Since writing the above, the single Docker host has grown into an actual K3s cluster running most of my self hosted stack: Jenkins, ArgoCD, Gitea (git + container registry), Prometheus/Grafana for monitoring, Pi-hole for local DNS, and Homarr as an internal launcher tying it all together. Everything sits behind proper ingress (Traefik) with a self hosted CA through cert-manager so every internal service gets real HTTPS instead of browser warnings.

Remote access is handled through Tailscale with split DNS so i can reach anything at `.hermitden` from my phone or laptop without exposing a single port publicly. The one thing that is public is my portfolio landing page, exposed through a Cloudflare Tunnel since my home connection sits behind CGNAT, with the whole thing wired into a real CI/CD pipeline (Jenkins + Kaniko + ArgoCD) so pushing to the repo is what actually ships changes to the live site.

Full writeup on all of that: → [Ingress + landing page](./Homelabing/Ingress-page/README.md)

## Homelabing and issues encountered

1. [Jenkins left running, RAM exhaustion](#jenkins-left-running-ram-exhaustion)
2. [ArgoCD Pruned live infra during manifest cleanup](#argocd-pruned-live-infra-during-manifest-cleanup)

--- 

### Jenkins left running, RAM exhaustion
Immediate fix: stopped unattended jenkins container. This led to idea of migrating self hosted services onto K3s for proper per workload resource limits and also getting more hands on with K3s which would then build on understanding K8s later.

→ [K3s migration](./k3s/k3s-migration/README.md)

### ArgoCD pruned live infra during manifest cleanup
Immediate fix: disabled ArgoCDs syncPolicy before moving unrelated manifests out of the watched path. Didnt help, sync was already mid-retry from before the policy got disabled.

That in-flight sync finished with prune still active and wiped 3 ingresses, CA cert and all of Homarr.

Recovered fully, reapplied everything from moved manifests copies in git.

→ [ArgoCD prune incident](./Homelabing/Ingress-page/README.md#argocd-prune-incident)