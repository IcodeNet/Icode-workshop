# Approved documents only

## Learning objectives

- Filter a retrieval result using explicit approval metadata.
- Understand why a grounded answer can still use an unapproved source.
- Use failing tests to validate the policy before an LLM sees the context.

## Your task

Implement `approvedOnly(documents)` in `index.mjs`. Return only documents whose `status` is exactly `approved`. Preserve their order and do not change the original array.

## Workflow

1. Run the starter tests and read the failure.
2. Open **Playground**, edit the implementation and run tests again.
3. Use the **Diff** tab to compare your saved files with the reference solution, or open [the step diff](#diff=step) (problem → solution).
4. Explain what should happen if a document has no approval status.

## Why this matters

A retrieval system can return relevant text that has not passed review. Enforcing approval before assembling model context makes the boundary testable.

Passing these sample tests demonstrates this filter, not a complete secure RAG system. Production systems also need authoritative status checks, access controls and evaluation.
