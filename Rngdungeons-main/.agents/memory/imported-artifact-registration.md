---
name: Imported artifact registration
description: Workspace behavior when imported projects contain artifact metadata but no registered artifact service
---

An imported project may include a valid `artifacts/<slug>/.replit-artifact/artifact.toml` while `listArtifacts()` and `listWorkflows()` still return empty. In that state, the direct managed workflow name is unavailable and preview screenshots cannot resolve the artifact.

**Why:** The imported workspace can be structurally ready without having gone through artifact registration in the current environment.

**How to apply:** Check `listArtifacts()` and `listWorkflows()` before restarting an imported artifact. Do not create a duplicate workflow just because the metadata file exists; register or reconcile the artifact through the platform flow first.