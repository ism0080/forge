import { copyFileSync } from "node:fs";

copyFileSync("src/client.d.ts", "dist/client.d.ts");
