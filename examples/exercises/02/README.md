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
