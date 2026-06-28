export type { Template, TemplateFile } from "./types.js";

import { defaultTemplate } from "./templates/default.js";
import { pwaTemplate } from "./templates/pwa.js";
import type { Template } from "./types.js";

export { defaultTemplate, pwaTemplate };

export const templates: ReadonlyArray<Template> = [defaultTemplate, pwaTemplate];

export const getTemplate = (id: string): Template | undefined =>
  templates.find((template) => template.id === id);
