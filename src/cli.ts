import { startStdioServer } from "./index.js";

startStdioServer().catch((error) => {
  console.error(error);
  process.exit(1);
});
