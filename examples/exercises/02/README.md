# Apply the policy in Python

## Learning objectives

- Work with lists and dictionaries in Python.
- Express an approval policy as a deterministic function.
- Read pytest failures and verify a corrected implementation.

## Your task

Implement `approved_only(documents)` in `main.py`. Include only dictionaries whose `status` equals `approved`, preserving order.

```python
{"id": "faq-01", "status": "approved"}
```

A missing status must not qualify as approval.

## Practice

1. Run tests before editing: the starter should fail.
2. Implement the filter in **Playground**.
3. Run tests and inspect the output.
4. Create a helper file if you want to split your implementation.
5. Use **Compare** to review the whole saved project.

## Extend this lesson

For a future Langfuse course, this deterministic function can become the task evaluated against a versioned dataset. Tools can then connect the lesson to a local trace or experiment viewer.

Mark the lesson complete when you can explain the policy. This is separate from the test result.

## Check your understanding

Answer each question before you reveal anything. Your answers and marks are saved with your progress.

```question
id: missing-status
prompt: A document arrives with **no** `status` field. What should `approved_only` do with it?
options:
  - Include it, because nothing says it is unapproved
  - Exclude it, because only an explicit `approved` qualifies
  - Raise an error, so the pipeline stops
answer: 1
explanation: |
  The policy is an allowlist. A missing status is unknown, and unknown content must
  not reach the model. Failing closed keeps the boundary testable: the test for a
  missing status passes only when the document is excluded.
```

```question
id: filter-placement
prompt: Where should the approval filter run in a retrieval-augmented app?
options:
  - In the prompt, by asking the model to ignore unapproved text
  - In the browser, before the question is sent
  - On the server, before the retrieved text is put into the model context
answer: On the server, before the retrieved text is put into the model context
explanation: |
  Instructions in a prompt can be ignored or overridden by injected text, and
  anything in the client can be changed by the user. Only a server-side filter is
  enforced for every request.
source: handoff
```

```question
id: tests-prove
prompt: Your tests for `approved_only` pass. What do they prove, and what don't they?
answer: |
  They prove that **this function** keeps exactly the documents whose `status` is
  `approved`, in order, for the cases tested. They don't prove that the status
  itself is correct or current, that every retrieval path calls the filter, or that
  the final answer is grounded.
explanation: |
  Tests show behaviour for the inputs they cover. Governance also needs an
  authoritative status source, the filter on every path, and evaluation of answers.
```
