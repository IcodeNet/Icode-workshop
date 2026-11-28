import { testStep, expect, dtl } from "@icodenet/workshop-test";

await testStep("The page shows a Count button", async () => {
  const button = await dtl.screen.findByRole("button", { name: /count/i });
  expect(button).toBeInTheDocument();
  expect(button).toHaveTextContent("Count: 0");
});

await testStep("Clicking the button adds one", async () => {
  const button = dtl.screen.getByRole("button", { name: /count/i });
  button.click();
  button.click();
  expect(button).toHaveTextContent("Count: 2");
});
