import { next } from "./counter.mjs";

let count = 0;
const button = document.getElementById("count");
button.addEventListener("click", () => {
  count = next(count);
  button.textContent = "Count: " + count;
});
