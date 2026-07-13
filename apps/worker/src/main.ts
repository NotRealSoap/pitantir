import { runWorkerMain } from "./index.js";

runWorkerMain().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
