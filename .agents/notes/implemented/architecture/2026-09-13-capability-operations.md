# Agent Note: Capability operations in Workbench

Status: implemented

English | [中文](2026-09-13-capability-operations.zh.md)

## Problem

Workbench needs to expose reusable capability runs and limits without making users edit definitions, engine configuration, or runtime records. Execution controls must preserve durable checkpoints, workspace identity, and published workflow rules while keeping research optional for deterministic work.

## Decision

Workbench keeps reusable capability authoring in conversation. The capability operations settings section shows durable runs and workspace limits without exposing the capability definition or engine configuration.

A published invocation records the authenticated Weave user, step checkpoints, transitions, and consumed step allowance. Human review parks the invocation and resumes from the saved checkpoint. An expired worker claim returns to the queue from that checkpoint; completed model and tool steps are not repeated.

A capability may use local Loom inference or an eligible remote CLI runtime. The published runtime requirement selects the execution route, while the published definition continues to own roles, steps, input validation, output validation, branching, bounded loops, and the final business result.

Team and capability authoring instructions select an execution approach during proposal generation, without a mandatory classifier call or research stage. Known procedures execute directly. Discovery is limited to concrete unknowns that prevent selecting a method, with evidence, allowed alternatives, bounded attempts and stop conditions. Mixed tasks restrict discovery to their uncertain portion. External access, permissions and side-effect risk alone do not trigger research; input errors, missing permissions and transient failures retain their normal handling. Explicit constraints and frozen published workflows remain authoritative.

This selection is model guidance, not a runtime-enforced research classifier. The structured team definition still compiles to lead → parallel workers → finalizer. Instructions and role names cannot add sequential dependencies, automatic return loops or human waits. These require a supported custom graph; an automated reviewer does not constitute human approval. A completed run does not prove delivery acceptance or successful fallback execution.

## Alternatives considered

A JSON capability editor would expose execution internals and shift schema maintenance to users. Mandatory research would slow deterministic work. A separate Workbench scheduler would duplicate platform claims, retries and final-state authority.

## Consequences

Users review business intent in conversation and inspect runs and limits through product views. Weave remains the authority for execution, checkpoints, budgets and terminal state. Real browser acceptance must still prove the chosen runtime, human review, recovery and delivered business result.
