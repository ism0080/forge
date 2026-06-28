/// <reference types="@ism0080/forge-vite-plugin/client" />
import { apiBaseUrl, siteId } from "virtual:forge";
import { createClient } from "@ism0080/forge-sdk";

const client = await createClient({ baseUrl: apiBaseUrl, siteId });
console.log("Forge site:", siteId, apiBaseUrl, client);
