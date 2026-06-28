export interface TemplateFile {
  readonly path: string;
  readonly content: string;
}

export interface Template {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly files: ReadonlyArray<TemplateFile>;
}
