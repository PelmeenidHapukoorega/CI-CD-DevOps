## Table of Contents <a id="toc"></a>

- [Ingress + landing page](#ingress--landing-page)
  - [Build log](#build-log)
    - [Cert-manager and Ingress setup](#cert-manager-and-ingress-setup)
    - [Pivoting initial idea](#pivoting-initial-idea)
    - [Tailscale for remote access](#tailscale-for-remote-access)
    - [Setting up Domain and tunnel](#setting-up-domain-and-tunnel)
    - [Designing and building landing page](#designing-and-building-landing-page)
    - [Setting up the pipeline](#setting-up-the-pipeline)
    - [Firewall rule for webhook](#firewall-rule-for-webhook)
    - [HMAC secret, authentication](#hmac-secret-authentication)
    - [Kaniko registry auth](#kaniko-registry-auth)
    - [Jenkins pipeline job](#jenkins-pipeline-job)
    - [ArgoCD prune incident](#argocd-prune-incident)
    - [Continuing the pipeline](#continuing-the-pipeline)

# Ingress + landing page

Had an idea about creating a landing page for myself finally, clean HTTPS urls for the homelab instead of port remembering but instead of doing it in a simple manner like just installing Caddy my idea was to do it the way real Kubernetes clusters actually solve the problem using ingress, cert manager and ArgoCD for GitOps on top.

Full pieces and how they connect:

1. Ingress + Traefik: K3s already ship with built in Traefik as ingress controller, instead of seperate proxy container i would define K3s ingress resources that would tell Traefik to route to clean names instead of ports.

2. Cert manager: Handles HTTPS automatically, since i dont have public domain i would use local Certificate authority to usse certs my own devices would trust instead of browser showing "insecure" warnings.

3. Pi-hole local DNS entries: Pi hole already is my current DNS resolver so i would need to add custom records so services would actually resolve to the servers IP for any device on the network.

4. Homepage or Homarr: landing page sitting at the root URL showing tiles for every service as well as pulling live stats from services.

5. ArgoCD: Instead of manually running `kubectl apply` every time i would add or change 1 of these ingress manifests id push yml to Github and ArgoCD would automatically detect change and apply it to the cluster for me. Essentially more practice for GitOps. 

Considered pointing ArgoCD at gitea instead since its self hosted but it only pulls mirrors from GitHub on an interval so it would add real delay between pushing and seeing it deployed. GitHub would stay the source of truth ArgoCD would watch directly and Gitea remains just a backup mirror.

[back to top](#toc)

## Build log

Now that i had set up ArgoCD i could start with the ingress page idea itself.

For ArgoCD setup see: ***[ArgoCD setup](../../argocd/setup/README.md)***

[back to top](#toc)

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

[back to top](#toc)

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

[back to top](#toc)

### Tailscale for remote access

Singed up for Tailscale and installed it on the server:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
```

Then ran `sudo tailscale up` for authentication.

Enabled IP forwarding to advertise home subnet so Tailscale could route every device on the network not just the server.

IPv4:

```bash
echo 'net.ipv4.ip_forward = 1' | sudo tee -a /etc/sysctl.d/99-tailscale.conf
```

IPv6:

```bash
echo 'net.ipv6.conf.all.forwarding = 1' | sudo tee -a /etc/sysctl.d/99-tailscale.conf
```

Then told the kernel to load the settings:

```bash
sudo sysctl -p /etc/sysctl.d/99-tailscale.conf
```

And advertised the home network range so Tailscale would know what to route:

```bash
sudo tailscale up --advertise-routes=192.168.137.0/24
```

Checked tailscales admin page to make sure my server existed in the list, then edited route settings to approve my set IP address range for the devices.

Downloaded the app itself and had issues with initial login, the buttons just werent working, looked for a workaround which was to use Auth key for login, generated new key through tailscales console and used that to login the app.

Then checked if i could access `grafana.hermitden` remotely without being on the same network:

<img src="./screenshots/hermitden-phone.PNG" width="300">

Moved onto homarr, first generated encryption key for it:

```bash
openssl rand -hex 32
```
And then added it as kubernetes secret:

```bash
kubectl create secret generic homarr-secret --from-literal=encryption-key='My generated key'
```

Didnt want any complexity and since Homarr defaults to running as root inside its container i just used its default.

Created config for Homarr and added 500Mi as modest storage room for it now.

Checked bound status between volumes before moving on to creating deployment manifest, applied it and checked if the pod was up.

Then added ingress manifest, applied it checked certificate:

![Homarr certificate issued alongside the other hermitden TLS secrets](./screenshots/homarr-certificate.PNG)

Then added DNS entry on Pihole and checked if it was resolving:

![Homarr init setup wizard resolving at home.hermitden](./screenshots/homarr-resolving.PNG)

Set up my account and then made connections to my services:

![Homarr dashboard with tiles for all hermitden services, weather, and clock](./screenshots/homarr-dashboard.PNG)

Now i had my own homepage done so i wouldnt need to have seperate tabs open for each but could access them all in 1 place.

[back to top](#toc)

### Setting up Domain and tunnel

Bought myself `hermitden.dev` domain, then connected it to cloudflare to set up the tunnel since my home network is behind CGNAT. So with the tunnel instead of waiting for inbound traffic to reach me, my server would reach to Cloudflare and keep the connection open. 

Set up zero trust tunnel, named it and then installed cloudflare using instructions provided by cloudflare onto my server:

Added cloudflares gpg key:

```bash
sudo mkdir -p --mode=0755 /usr/share/keyrings
```

```bash
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
```

Then added repo to app repositiories:

```bash
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' | sudo tee /etc/apt/sources.list.d/cloudflared.list
```

And installed cloudflare:

```bash
sudo apt-get update && sudo apt-get install cloudflared
```

Then installed the service:

```bash
sudo cloudflared service install 'CLOUDFLARE_TOKEN'
```

Checked cloudflare to see if the connection was made:

![Cloudflare tunnel to server working](./screenshots/cloudflare-tunnel.PNG)

[back to top](#toc)

### Designing and building landing page

Honestly when i got to this point i was stumped, then had a think about the design on how to make it appealing to myself. 

Made a rough shape of it and added few assets i found at `itch.io` so no copyright bs coming my way.

More to the point about the page itself, i didnt want just a page where im just showcasing what ive made, i wanted it to serve a better principal.

My intention with the site is to use it as a live portfolio piece, and since im right about finished with having all the necessary tools for DevOps installed and self hosted i figured the way im gonna do this is to run everything through the CI-CD pipeline for it, track changes, have version control and gradually see the site get better and better. 

My rough idea is some cozy dark fantasy pixelated art since im a sucker for dark fantasy RPGs but thinking on maybe adding a character to the page and as the page itself gets new features, stats, updates and whatever, then the character itself would level up as well. Still pondering on how that will look like.

[back to top](#toc)

### Setting up the pipeline

Now since the idea was to run everything as a pipeline for the changes to the site i set up docker for it. Set up nginx for the site since container would only serve files for it.

```dockerfile
FROM nginx:alpine
COPY . /usr/share/nginx/html
EXPOSE 80
```

Next question i needed to figure out was how would the new image tag actually reach ArgoCD?

Decided to have Jenkins buld the image, then have it tag git commit SHA and push it to Giteas registry and then edit the K3s deployment manifest and then commit changes back to the repo.

Since my source of truth was github but jenkins lives internally for me then this meant that Githubs webhook would need it to be able to reach jenkins.

I could have jenkins check Github for new commits on schedule ie every 2-3 mins, 0 exposure but slight delay.

Or i could expose webhook endpoint through cloudflare tunnel.

Was leaning towards webhook endpoint via tunnel but started thinking on security since it also added public attack surface on the infra itself.

To mitigate it i added a firewall scoped to 1 hostname and block everything except those CIDR ranges so even if someone finds the URL, the request would never reach Jenkins at all.

Scope to specific webhook path through the tunnel so the public route has 1 job and nothing else is reachable through it.

Use HMAC secret so anything that wouldnt match the signature would get booted.

[back to top](#toc)

### Firewall rule for webhook

Set up firewall rule on cloudflare to block out everything except for requests that are either both on the same webhook path and coming from Github IP.

On cloudflare: Security > Create rule > custom rules.

Edited the expression and added my IP strings by using the output i got for running:

```bash
curl -s https://api.github.com/meta | python -c "import json,sys; print(json.load(sys.stdin)['hooks'])"
```

Then created the rule and verified it was active:

![Cloudflare firewall rule](./screenshots/cloudflare-rule.PNG)


Added route to the webhooks subdomain on cloudflare: Zero trust > tunnels and mesh > my tunnel > Published application routes.

Added details and saved the route.

[back to top](#toc)

### HMAC secret, authentication

Generated random secret on the server:

```bash
openssl rand -hex 32
```

And added it to jenkins, then added the same value Githubs webhook config as secret.

Then got Giteas registry credentials, generated token scoped for package with read and write, then added token to jenkins as credentials.

Repeated the same thing for githubs write access creds.

[back to top](#toc)

### Kaniko registry auth

Wanted to try Kaniko to build images instead of docker here for least privileged access. 

It runs inside a cluster, doesnt require any special privileges like with docker where daemon runs on the host and then builds the image.

More secure for K8s environments and would be fun to try out and see it firsthand.

Created a kubernetes secret first to give Kaniko config file to authenticate with to Gitea since it has no Docker daemon therefore it cant use `docker login`.

```bash
kubectl create secret docker-registry gitea-registry-secret \
--docker-server=gitea.hermitden \
--docker-username=virtualhermit \
--docker-password=GITEA-TOKEN-I-GENERATED \
--docker-email=MY-EMAIL \
-n default
```

Created deployment manifest next, telling K3s to run the pod with `hermitden-site` container image on port 80 i.e to run the site itself.

And `site-service` manifest to give the pod stable internal network address so other things inside the cluster (like Cloudflare tunnel) could reach it without caring which pod is currently running or whats the IP on it.

Then created ArgoCD application that would tell ArgoCD to actually watch the `manifest/` folder and have it poll the repo to see manifests changes and then sync it to clusters. 

Added jenkinsfile where it spins up temporary container (Kaniko in this case) sitting idle with Giteas credentials already mounted as a file.

Added `triggers` block where the pipeline would be triggerd only when Github sends a signed push notif through the webhook.

Actual work runs in 4 steps:

1. Checkout: Pulls altes code from Github into the pod so there is actually something to build.

2. Kaniko reads dockerfile, buyilds the nginx and site image and pushes it straight to Giteas registry tagged with short git commit hash so every new build i make for the webiste gets a unique and traceble tag instead of overwriting latest.

3. Update manifest: Edits `site-deployment.yaml` file inside the pod, swapping image line to point at the new tag that got pushed.

4. Commit manifest change: takes the edited file and pushes it back to Github as an actual commit using write access token which is what ArgoCD notices and syncs to the cluster.

[back to top](#toc)

### Jenkins pipeline job

Created the job on jenkins and ran it and got met with:

```
WorkflowScript: 3: Invalid agent type "kubernetes" specified. Must be one of [any, label, none] @ line 3, column 5.
```

It didnt recognize the word kubernetes, installed Kubernetes agent plugin to mitigate it.

Ran the job again and this time got: No kubernetes cloud was found.

Jenkins got the syntax but had no connection configurted to actually talk to Kubernetes API and spun up a pod. Managed jenkins > clouds > new cloud > Kubernetes, left URL blank since jenkins already runs inside the cluster and could auto detect the in cluster API endpoint, set namespace to default and saved.

Ran the job again and got a new error: pods is forbidden. User "system:serviceaccount:default:default" cannot list resource pods in API group in the namespace"default"

Turns out jenkins runs under the clusters default service acc which had no permissions at all by default, couldnt even list pods let alone create new ones for the pipeline to use.

Needed to set up RBAC properly, dedicated service account for Jenkins, Role that grants it permissions it needs (create/list/watch/delete pods, pods/exec, pods/log, events), and RoleBinding tying the 2 together.

Kept it scoped to just the default namespace instead of cluster wide, same least privilege pattern as everything else.

Created jenkins-rbac.yaml alonside the existing jenkins-deployment.yaml and jenkins-storage.yaml manifests on the server.

Applied it:

![Jenkins RBAC manifest](./screenshots/jenkins-rbac.PNG)

Then patched Jenkins deployment to use new serviceaccount instead of default one, so added `servicAccountName: jenkins` to the deployment.yaml on the server, applied the manifest and ran the pipeline again.

Hit `Pod [Pending][ContainersNotReady] containers with unready status: [kaniko jnlp]` this time around.

Checked `kubectl get pods` while debugging and noticed `cloudflared` was in CrashLoopBackOff with 850 plus restarts over 45 hours, completely separate issue from the pipeline itself but worth fixing since it affects the whole tunnel and webhook setup.

Described the pod and found the actual cause was that the liveness probe checked "https://:200-/ready" but cloudflares metrics and readiness server was actually starting on port 20241, nothing was listening on 2000 at all so kubelet kept killing the container every -10 seconds.

Fixed it by adding `--metrics 0.0.0.0:200` to cloudflareds container args to it would bind where the probe expected it. Restart count stopped climbing.

Back to pipeline, ran the job again and this time pod itself came up fine but jenkins still failed the build with `java.lang.IllegalStateException: Agent is not connected after 1000 seconds`.

Described the pod and saw the jnlp container was configured with `JENKINS_URL: https://jenkins.hermitden/` meaning the agent was trying to link home through public ingress hostname going through Traefik, TLS and internal CA even tho its running in the same cluster 1 hop away from Jenkins.

Fixed it by setting jenkins tunnel under the kubernetes clouds settings to `jenkins-service.default.svc.cluster.local:50000` so agent pods connect directly to jenkins over the internal cluster network via jnlp port instead of going out through the ingress/DNS/TLS path.

Ran the pipeline again and met with `Error: error resolving dockerfile path: please provide a valid path to a Dockerfile within the build context with --dockerfile`.

Checked the kaniko command `--dockerfile` still had the full repo path even though `--context` already pointed at `Page-assets/`, kaniko resolves `--dockerfile` relative to `--context` so the path doubled up and didnt exist. 

Fixed by changing `--dockerfile` to just `Dockerfile`.

Ran the pipeline again and same error persisted, turned out the file was actually committed as lowercase `dockerfile`, Linux treats that as a different file from `Dockerfile`. 

Fixed the Jenkins file to match the real filename.

Next run got past that and failed on the push itself, CoreDNS couldnt resolve `gitea.hermitden`. 

Host resolved it fine (via Tailscales split DNS to Pihole) but CoreDNS just does a dumb forward to `/etc/resolv.conf` with none of that routing logic. 

Since this would break any pod reaching `.hermitden` i fixed it properly by adding a `coredns-custom` ConfigMap forwarding `.hermitden` queries straight to Pihole. 

Restarted CoreDNS:

```bash
kubectl rollout restart deployment coredns -n kube-system
```

Then checked if it was now resolving to my servers IP with:

```bash
kubectl run dns-test --image=busybox:1.36 --rm -it --restart=Never -- nslookup gitea.hermitden
```

CoreDNS fix worked, ran pipeline again.

Error `tls: failed to verify certificate: x509: certificate signed by unknown authority`.

So now Kaniko wasnt trusting my internal CA which i created for HTTPS encryption.

Decided to give Kaniko the CA as a file which it then could use to verify the connection.

Pulled the CA cert out of the secret first:

```bash
kubectl get secret hermitden-ca-secret -n cert-manager -o jsonpath='{.data.ca\.crt}' | base64 -d > hermitden-ca.crt
```

Then verified its output:

```bash
cat hermitden-ca.crt
```

Then created the config map for it:

```bash
kubectl create configmap hermitden-ca --from-file=ca.crt=hermitden-ca.crt -n default
```

And updated Jenkinsfile, added volumenMount and volume for the CA, then added `--registry-certificate` pointing at the mounted file.

Saved, commit push and ran pipeline again.

Errored out again since it could find the dockerfile, realised i hadnt commited and pushed it to github so it couldnt find it.

Ran the pipeline again and this time kaniko build + push and manifest edit all succeeded. 

Also got a warning that said `A secret was passed to "sh" using Groovy String interpolation, which is insecure.`.

Right now jenkins did `git push https://${GIT_USER}:${GIT_PASS}@github.com/...` inside """ string which meant Groovy substitude the actual token into the script text itself before jenkins credential masking could hide it.

Used ''' single quoted on the block and referenced the credentials as shell variables instead.

Then got 403 permission denied pushing as my own Github user.

Checked personal tokens on Github to make sure my write-creds which i made much earlier werent expired and were scoped properly.

It wasnt, edited the token, set CI-CD-DevOps repo as the only repo, checked permissions and checkboxed contents and set the permissions to read and write.

Ran the pipeline again and this time it succeeded:

![Pipeline succeeding](./screenshots/pipeline-working.PNG)

[back to top](#toc)

### ArgoCD prune incident 

After the pipeline finally succeeded i checked on argocd to confirm if the deploy landed. Found out instead the app was stuck on retry, OutOfSync throwing errors on deployment manifest.

Found 2 things after digging. First was the deployment yaml was corrupted by sed bug in the jenkinsfile and argocd app watched folder had been silently tracking unrelated infra manifests id left in there as reference copies (so Homarr, some ingresses, CA issuer) with `prune: true` on.

To be safe i disabled syncPolicy before moving the reference files out, thinking it would stop anything from being touched.

Well...it didnt.

Automated syn was already mid retry loop before i disabled the policy and apparently disabling it only blocks new syncs and not the ones already running.

Once i pushed the deployment fix, in-flight sync succeeded with `prune: true` still baked into it and deleted everything no longer present in git: 3 ingresses, CA cert object and Homarss entire deployment/Service/PVC/PV.

Recovery worked because deleting k3s object doesnt delete whats behind it, homarrs data was untouched on disk and the CA actual secret/key survived solo of the Cert object.

Recreated all the deleted manifests from the reference-manifests copies in git and everything reconnected fine.

**Lesson:** disabling argocds sync policy stops future syncs and not in flight ones. Kill switch mid incident is clearing active operation cleanly with:

```bash
kubectl patch application <NAME> -n argocd --type merge -p '{"operation":null}'`
```

[back to top](#toc)

### Continuing the pipeline

Site pod got stuck in ImagePullBackOff.

First error was cert unknown authority again but this time from the node cause kubelet/containerd pulling the image never got the CA trust that i gave Kaniko earlier.

Fixed by dropping CA cert onto the node and pointing k3s at it via /etc/rancher/k3s/registries.yaml, restarted k3s so containerd actually picked it up

That being sorted the error changed to routing bug, curl to gitea.hermitden was getting traefiks own default self signed cert instead of the actual one.

This was the fallout from the argocd incident, gitea ingress itself got pruned along with everything else so traefik had nothing to route the hostname to.

After reapply it went bacj to trust error yet agan. Then once cleared it hit `:latest not found` since kaniko only ever pushes commit sha tags and manifest i manually fixed earlier just had `:latest` as placeholder.

Fixed it by rerunning the pipeline itself instead of patching around it. 

First run of that failed on groovy syntax error, jenkinsfile was missing its last 2 closing braces. Fixed that, pushed again and pipeline succeeded clean.

Argo failed to pick up the new commit instantly since it polls every few mins. Forced a hard refresh on the application:

```bash
kubectl patch application hermitden-site -n argocd --type merge -p '{"metadata":{"annotations":{"argocd.argoproj.io/refresh":"hard"}}}'
```

Synced the correct tag in. Deployment came up healthy.

Last i wanted to expose the site itself, landing page itself didnt have its own published route yet since pipeline was the priority first. 

Added new route `www.hermitden.dev`, service type http since cloudflare terminates TLS at the their edge and internal service has none of its own, same pattern as other internal stuff.

DNS record showed up fine on puhblic resolvers but the servers own resolver (tailscale) kept giving NXDOMAIN off a cahced negative lookup from before the record existed.

Forced curl to resolve manually, got a clean 200 back. Opened it from the actual browser after and site loaded fine:

![Site finally working](./screenshots/site-working.PNG)

Tailscales cache cleared on its own after a while.

Pipeline is now fully closed, push to page assets goes all the way through the live site with nothing manual in between.

[back to top](#toc)

