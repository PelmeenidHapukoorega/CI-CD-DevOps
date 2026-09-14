# Ingress + landing page

Had an idea about creating a landing page for myself finally, clean HTTPS urls for the homelab instead of port remembering but instead of doing it in a simple manner like just installing Caddy my idea was to do it the way real Kubernetes clusters actually solve the problem using ingress, cert manager and ArgoCD for GitOps on top.

Full pieces and how they connect:

1. Ingress + Traefik: K3s already ship with built in Traefik as ingress controller, instead of seperate proxy container i would define K3s ingress resources that would tell Traefik to route to clean names instead of ports.

2. Cert manager: Handles HTTPS automatically, since i dont have public domain i would use local Certificate authority to usse certs my own devices would trust instead of browser showing "insecure" warnings.

3. Pi-hole local DNS entries: Pi hole already is my current DNS resolver so i would need to add custom records so services would actually resolve to the servers IP for any device on the network.

4. Homepage or Homarr: landing page sitting at the root URL showing tiles for every service as well as pulling live stats from services.

5. ArgoCD: Instead of manually running `kubectl apply` every time i would add or change 1 of these ingress manifests id push yml to Github and ArgoCD would automatically detect change and apply it to the cluster for me. Essentially more practice for GitOps. 

Considered pointing ArgoCD at gitea instead since its self hosted but it only pulls mirrors from GitHub on an interval so it would add real delay between pushing and seeing it deployed. GitHub would stay the source of truth ArgoCD would watch directly and Gitea remains just a backup mirror.

## Build log

Now that i had set up ArgoCD i could start with the ingress page idea itself.

For ArgoCD setup see: ***[ArgoCD setup](../../argocd/setup/README.md)***

### Cert-manager and Ingress setup

Currently ArgoCD was accessible for me through port forwarding (explained in the setup) but now i wanted to set up ingress for it specifically so i wouldnt need to access anything over localhost or port forwarding.

Read that ArgoCDs server internally expects to handle its own TLS encryption by default. 

So i decided to this in 2 phases:

1. Phase 1: Plain ingress routing first
2. Phase 2: Cert manager later

I needed to tell argo to run in "insecure" mode internally so it wouldnt selft encrypt and just serve plain HTTP since Traefik would be the thing terminating HTTPS once i would add cert manager.

As much as i gathered its standard config step for Traefik + ArgoCD and not a security compromise on its own, TLS still happens, just at the ingress layer instead of inside ArgoCD itself.

Patched ArgoCD to run insecure internally:

```bash
kubectl patch configmap argocd-cmd-params-cm -n argocd --type merge -p '{"data":{"server.insecure":"true"}}'
```

Then restarted rollout:

```bash
kubectl rollout restart deployment argocd-server -n argocd
```

Created ingress manifest ([argocd-ingress.yaml](./manifests/argocd-ingress.yaml)) applied it, then got ingress:

![Traefik Ingress created and reachable for argocd.hermitden](./screenshots/Ingress-working.PNG)

Added DNS entry in Pi-holes admin UI by going to Local DNS > DNS records and added my created domain `argocd.hermitden` and my servers IP address.

Then checked if ingress was now working:

![ArgoCD accessible over plain HTTP via argocd.hermitden before TLS](./screenshots/argocd-direct.PNG)

My core problem was that HTTPS requires a certificate and certs only mean something if some trusted authority vouches for them and since i have no public domain then i became the AUTHORITY. 

In comes cert manager that lets me create my own personal certificate authority and could basically tell my own devices "trust anything signed by this CA".

After 1 time trust set up, cert manager could then automatically issue and renew HTTPS certs for every internal service, therefore no manual cert gen eah time, no expiration and no browser warnings once devices would trust root CA.

Installed cert manager:

```bash
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.20.2/cert-manager.yaml
```

Then ran wait for condition:

```bash
kubectl wait --for=condition=Available deployment --all -n cert-manager --timeout=300s
```

And checked pods:

![cert-manager pods running](./screenshots/certmanger-pods-running.PNG)

Created self signed root ClusterIssuer as a temporary bootstrapping piece. Its only job is to just sign root CA certificate itself. 

Created the yaml `root-clusterissuer` and added the following:

```yaml
apVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
    name: selfsigned-issuer
spec:
    selfsigned: {}
```

Then applied the manifest and checked cluster issuer:

```bash
kubectl get clusterissuer
```

![Self-signed root ClusterIssuer showing Ready](./screenshots/selfsigned-true.PNG)

With bootstrapping in place i then created CA certificate which would then become ongoing trust anchor for everything else.

Then applied it, checked if cert was showing as ready and secret existing

![hermitden-ca Certificate showing Ready True](./screenshots/cert-ready-true.PNG)

Next created the real ClusterIssuer which would actually sign certs for the services going forward and pointed it at the secret i just created.

Going forward i would now reference this on every ingress that would need HTTPS since it signs real leaf certs all trusted back to the root CA.

Applied it and checked ClusterIssuer (2 ClusterIssuers, selfsigned-issuer from earlier bootstrapping and the real one)

![Both ClusterIssuers showing Ready - self-signed root and the real CA-backed issuer](./screenshots/clusterissuers-self-real.PNG)

No need to delete the self signed issuer incase of cert renewal since cert manager needs to re issue fresh CA cert it would go back to that in order to do that.

Updated ArgoCD ingress to actually request cert from the real issuer

So added annotations line to trigger cert manager:

```yaml
annotations: 
    cert-manager.io/cluster-issuer: hermitden-ca-issuer
```

And `spec.tls` which tells Traefik to terminate HTTPS for the hostname using whatever cert ends up in `secretName: 

```yaml
tls: 
  - hosts:
      - argocd.hermitden
    secretName: argocd-tls-secret
```

`argocd-tls-secret` didnt exist at this stage yet, cert manager would creat it automatically once it would finish issuing the cert triggered by the annotation i set.

Applied ArgoCD ingress, then checked it:

![Ingress updated with TLS annotation and argocd-tls-secret issued](./screenshots/argocd-ingress.PNG)

Next i needed to get the browser to actually trust it so the warning page would go away.

Extracted CAs public cert from the secret i created earlier:

```bash
kubectl get secret hermitden-ca-secret -n cert-manager -o jsonpath='{.data.ca\.crt}' | base64 -d > ~/hermitden-ca.crt
```

Then used secure copy or `scp` command to transfer `hermitden-ca.crt` to windows before i could add it to Trusted Root Certification Authorities store which would tell my workstation that i personally vouch for said authority.

Then found the cert locally, double clicked on it and went through installation, chose local machine which would make my workstation trusted for all users/browsers on the device.

Browsed and chose Trusted Root Certification Authorities as the store, then finished it.

Closed all tabs since it needs a clean restart of it, then checked `https://argocd.hermitden`:

![argocd.hermitden fully trusted with a clean HTTPS padlock](./screenshots/CA-fully-trusted.PNG)

Next i repeated doing ingress for Gitea, Grafana and Prometheus, starting off with Gitea first.

Used the same shape as ArgoCD for ingress with difference being in port.

Applied the manifest, then got cert with:

```bash
kubectl get certificate -n default
```

![gitea.hermitden certificate showing Ready True](./screenshots/gitea-cert.PNG)

Afterwards added DNS entry to Pihole: `gitea.hermitden` and servers IP.

Checked `https://gitea.hermitden`

![Gitea reachable directly via gitea.hermitden with a trusted HTTPS padlock](./screenshots/gitea-direct.PNG)

Dealt with migrating Prometheus and Grafana to k3s as well which i have not documented under k3s migration since its more of the same pattern i already used with others there.

With that out of the way created ingress for both using the same pattern as i have with others above and are visible in the repo anyway.

Applied both:

![Prometheus and Grafana certificates issued alongside giteas existing one](./screenshots/grafana-prom-ingress.PNG)

Then DNS entries for both via Pi hole and checked URLs:

![prometheus.hermitden and grafana.hermitden both working directly with clean HTTPS](./screenshots/grafana-prom-direct.PNG)

This closes out the ingress part of this small project, next up making the landing page and have them all in 1 place.

### Pivoting initial idea

My initial idea was to have a landing page where i could access all my services from 1 place but i also wanted to have a public portfolio landing page.

So instead of having both in 1 place i opted out to have them seperate instead since i have services that have no business in being publicly available. So public portfolio landing page and Homarr as the internal launcher.

Then i wanted the internal launcher to be available for me remotely in case i wasnt at home so i could still have access and make sure everything was working when i was running things.

So now the idea transpired into following:

1. Personal internal launcher using Homarr: Single page with tiles for services so i wouldnt need to manage them individually, purely for my use case.

2. Public portfolio landing page: Custom built, real domain/HTTPS, showing either github activity, curated safe stats from the homelab and links to write ups or smt like that, full list still pending.

Connective infrastructure for making both possible:

* Tailscale: Installed on the phone/server, full remote access to everything at `.hermitden`, no public exposure.

* Cloudflare tunnel: Solves getting the public landing page onto the internet despite my horrible connection, tunnel makes outbound only connection from the server to Cloudflare which would then serve my domain publicly with TLS, no inbound ports opened on the home network.

* Real domain: Full ownership and control.