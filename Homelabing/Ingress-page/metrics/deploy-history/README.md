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

Then checked rolebinding for ArgoCD:

```bash
kubectl get role,rolebinding -n argocd | grep deploy-history
```

![Rolebindings binded](./screenshots/rolebindings-binded.PNG)

Moved the rbac.yaml from the manifests folder to a different folder for seperation since ArgoCD watches the manifests folder itself for creation, pruning and updating and having permissions there just screamed trouble for me.

RBAC is identity and permissions so i kept it manual for oversight, same thing i learned earlier with the argocd prune incident from the ingress build. 

Then created ArgoCDs application file to watch cronjob.yaml file and created the object in the cluster to match it and for automation.

Applied the application manifest and checked if application was synced and healthy:

![Deploy synced fully](./screenshots/deploy-synced-healthy.PNG)

Pushed a test change on jenkins, application didnt however trigger the jenkins build so started investigatinga as to why it wasnt triggering.

Checked jenkings job config to see if githubs hook trigger for GITscm polling was checked, it was.

Checked webhook delivery on github side, payload was correct, ref refs/heads/main, correct repo, 200 response.

Checked included/excluded path restrictions, everything was correct.

Cleared path restrictions entirely as a test, still no agent was starting a build on push, ruled out path restriction as the cause.

Found that build #88 had run and finished, so concurrency wasnt blocking anything. Added debug log recorder in manage jenkins > system log, logging `org.jenkinsci.plugins.github` at FINE, showed webhook recieved "Considering to poke hermitden-site", "Poked hermitden-site" then nothing.

Checked the jobs config.xml on disk, found the trigger was persisted under plugin="github@1.47.0" so much older version than currently installed github plugin, stale serialization maybe?

Soft restarted jenking to force plugins reloading cleanly, no change.

Added 2nd logger specifically for `com.cloudbees.jenkins.GitHubPushTrigger at FINE, completely silent across multiple pushed, no output at all past "poked".

Unchecked github hook trigger, saved, rechecked, saved again to force clean re serialization on the trigger object under current plugin version, no change yet again.

Checked project url field, correctly filled and pointed at `CI-CD-DevOps` repo.

Checked jenkins thread dump for stuck/blocked scm polling thread. Found 1 idle SCMEvent thread, healthy not stuck.

Checked if `{githubPush()}` was declared in jenkinsfile, already there.

Used jenkins script console to call `trigger.run()` on the jobs GitHubPushTrigger object, bypassing webhook. Job queue stayed empty, confirmed bug is inside the triggers own polling logic and not webhook delivery.

Used the console again to check `SCMTriggerItem.poll()` directly with capture listener, found the root cause: `Error: no such computer hermitden-site-87-...poll()`, it was trying to reuse a long dead ephemeral kubernetes agent pod from build #87 as its comparision baseline.

Removed redundant explicity checkout scm stage from jenkinsfile (declarative: Checkout SCM running automatically already), running theory is that it was poisoning the polling baseline, didnt fix it but removed it as dead weight regardless.

Searched job directly `/mnt/k3s-data/jenkins/jobns/hermitden-site` for anything that was referencing the "dead computer", found github polling log and live polling state file, confirmed this is what the webhook pokes were writing into.

Found a bug in fetch.sh along the way, wrong app name, three missing `$` on var references, fixced that.

Seperately found a bug in argocd application, yaml had been sitting inside the same manifests folder it was configured to watch, causing argocd to misdetect and silentll skip deploying cronjob.yaml even while reporting Synced/Healthy. Moved the app yaml out the module root, fixed.

Application object briefly disappeared entirely after the move, reapplied app yaml manually, confirmed synced/healthy and cronjob intact afterwards.

Fixed dockerfile filename case mismatch in jenkinsfile kaniko stage. Flag said `--dockerfile=Dockerfile`, actual file was lowercase, this caused build failures.

Trigger clean manual build after all fixes and the pipeline succeeded end to end, deploy-history-fetch:latest image built and pushed successfully.

Re ran script console poll test after the successful build. Confirmed the pattern: Error now referenced `hermiden-site-91-...` so just finished build, proving that this wasnt a 1 time scale cache from days ago, `poll()` tries to reuse whatever pod ran the most recent build, every time and that pod is alwasy already dead by the time polling runs next since K8s agents are ephemeral and torn down withing mins of finishing.

Root cause conclusion: Mismatch between classic SCMTrigger/poll() which assumes reusable persistent workspace and kubernetes-plugin ephemeral agents.

Potential fix i will need to test: Convert the website to multibranch pipeline job which uses github-branch-sources event based indexing instead of the broken poll() path entirely.

Fallback confirmed not viable at all, poll scm would hit the exact same poll() method so it wouldnt have worked either. For now manual Build now going forward until i set up the multibranch.

Picked this up again today, saw that traefik logs showed 404 on /v2/virtualhermit/deploy-history-fetch/manifests/latest, cronjob pods stuck in ImagePullBackOff.

Checked registry directly with curl against giteas v2 API, anon request gave unauthorized (expected, not useful)

Checked if giteas registry secret existed in the argocd namespace at all. It didnt, only existed in default.

Realized cronjobs pod spec never had imagePullSecrets at all to begin with, wasnt referencing credentials so pulls were anonymoys regardless of namespace.

Copied the secret into argocd namespace manually, added imagePullSecrets:-name:gitea-registry-secret to cronjobs yaml. Commited, pushed, argocd auto synced it, confirmed live in the deployed cronjob spec.

Retested with manual job, error changed to ErrImagePull with message "not found", image didnt exist in the registry.

Used curl to auth against gitea registrys api, NAME_UNKNOWN, image was never pushed despite last nights kaniko log appearing to show successful push.

Made trivial commit to fetch.sh to retrigger the changeset gated jenkins stage, ran build manually, confirmed this time it pushed. Verified directly agains the registrys API afterward.

Ran manual test job, pod completed successfully, configmap now shows real data:

```json
='{.data.data\.json}'
{
  "sync_status": "Synced",
  "health_status": "Healthy",
  "last_deployed": "2026-09-25T02:37:37Z",
  "deploy_count": 10,
  "data_generated_at": "2026-09-25T11:35:08Z"
```

Module confirmed working end to end, rbac, configmap, fetch.sh, dockerfile, cronjob, argocd application, image build/push, pull secret, actual fetch logicl all working together.

Cron will now run on its own every hour.

Still open: Webhook auto-trigger issue from last night unresolved, ill try setting up multibranch pipeline to see if that would fix the issue.