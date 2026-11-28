export const documents = [
  { title: "Retention policy", status: "approved" },
  { title: "Draft FAQ", status: "draft" },
  { title: "Security guide", status: "approved" },
];

export function groupByStatus(items) {
  const groups = {};
  for (const { title, status } of items) (groups[status] ??= []).push(title);
  return groups;
}

export const grouped = groupByStatus(documents);
console.log("Grouped", Object.keys(grouped).length, "statuses");
