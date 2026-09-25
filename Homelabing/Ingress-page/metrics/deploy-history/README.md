Moved onto adding metrics to my website starting with adding deployment history.

Idea is to run the CronJob inside the cluster that then reads ArgoCDs `application` object via `kubectl` since ArgoCDs API isnt reachable from outside my network. I.e public page never queries cluster live.

Auth through scoped ServiceAccount + Role not an ArgoCD token for fewer secrets.

Output written to ConfigMap mounted into the side pod, served as static JSON file by nginx. Browser fetches the file and never touches ArgoCD.

Created an empty ConfigMap so Roles `update` and `patch` paths is what the cronjob would actually use going forward:

```bash
kubectl create configmap deploy-history -n default --from-literal=data.json='{}'
```

Created fetch script to only grab metrics i wanted to display (sync status, health, last deploy time, deploy count) without exposing everything from ArgoCDs full internal state. TLDR: the script here is used as a filter as in what information will be displayed and what wont.

`status.history` for free deploy count, everything the script touches is read from `Application` object ArgoCD already maintains so no new state or external calls.

Used `--dry-run=client -o yaml | kubectl apply -f -` instead of just `kubectl create`. 

`kubectl create` would only work once, run it against the configmap find it already exist and error out.

So first run would work, but runs after that the `create` would just fail silently in cronjob logs. 

Used `kubectl create ...... --dry-run=client -o yaml` to generate configmap manifest as yaml without sending it to cluster, then pipe that yaml into `kubectl apply -f -` instead which would wouldnt error if it already existed and would just patch the fields that changed.

Script is idempotent so safe to run every hour regardless of configmaps existance.

>!Note: Configmap got bootstrapped manually once because RBAC role only grants `update`/`patch` and not `create`. `resourceNames` scoping means service account cant create resource in the first place, only touch it once it exists.

Created dockerfile using same pattern as the pages own dockerfile, small base image and installing only whats needed then copy the app code in. Builds through Kaniko exactly the same way.

Just needed jenkins path restriction to now also watch `metrics/deploy-history/**` so it would know to build it into its own image tag seperate from the site image.

Then added cronjob with `backoffLimit: 2` so it wouldnt loop on failure hence the cap.

Used giteas registry again since the sites image is already using one.

Then added new stage to existing jenkinsfile and added path restriction to only build the image if dockerfile or the script is being touched.

Applied the RBAC manifest, then checked if service account was created using the correct set namespace:

```bash
kubectl get serviceaccount deploy-history-reader -n argocd
```