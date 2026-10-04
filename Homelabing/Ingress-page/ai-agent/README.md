Decided to build an AI agent layer on top of the existing CI/CD setup, 2 pieces: a changelog agent that summarizes recent commits/deploys into plain english for the site, and a triage agent that gets called on Jenkins build failures to give a first-pass diagnosis instead of just a stack trace.

Both call out to the Claude API, sharing 1 small client module instead of duplicating the API call logic.

Starting with the changelog agent since its the lower risk one: read only, public-facing, no sensitive data touching it.