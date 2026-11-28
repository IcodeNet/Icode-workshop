export const documents = [
  { title: "Retention policy", status: "approved" },
  { title: "Draft FAQ", status: "draft" },
  { title: "Security guide", status: "approved" },
];

export function groupByStatus(items) {
  // TODO: map each status to the titles with that status
  return {};
}

export const grouped = groupByStatus(documents);
console.log("Grouped", Object.keys(grouped).length, "statuses");
