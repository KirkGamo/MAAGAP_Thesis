---
tags: [architecture, deployment]
status: active
created: 2026-08-08
updated: 2026-08-08
---

# Deployment

Per the project's stack guidelines: Vercel for the Next.js frontend (dynamic runtime environment variable resolution), the FastAPI ml-service containerized (Docker/Dokploy) or hosted separately (AWS/GCP) for independent scaling and deployment cadence from the frontend.

## Why separate deployment targets

The frontend and ml-service have very different runtime needs — the frontend is stateless request/response, the ml-service needs to run pandas/TensorFlow/XGBoost training jobs that are heavier and slower than a typical serverless function budget allows, and the two are versioned/deployed independently (a frontend UI fix shouldn't require re-deploying the model service, and vice versa).

## What's NOT yet formalized here

This vault doesn't currently have a note on the actual live deployment pipeline (CI/CD, environment promotion, secrets management) beyond the stack choice above — that's a gap worth filling in if/when the project moves past local development. Flag this in [[../MOC-Known-Issues]] if it becomes a blocker.
