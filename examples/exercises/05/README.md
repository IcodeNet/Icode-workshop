# An export app: values, not pages

Some exercises produce values rather than a user interface. In an **export app** the Preview panel shows everything the module logs and every value it exports.

## Your task

Implement `groupByStatus(documents)` in <InlineFile file="index.mjs" />. It returns an object that maps each `status` to the titles with that status.

```js
groupByStatus([{ title: "A", status: "approved" }, { title: "B", status: "draft" }]);
// { approved: ["A"], draft: ["B"] }
```

<callout-warning>
  Keep the input unchanged: build a new object.
</callout-warning>

Open the **Preview** panel to see `grouped` update as you save. Then run the tests.
