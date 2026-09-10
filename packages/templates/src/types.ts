export interface TemplateFile {
  readonly path: string;
  readonly content: string;
}

export interface TemplateConfig {
  readonly entry?: string;
  readonly spa?: boolean;
  readonly database?: {
    readonly migrations: string;
  };
}

export interface Template {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly config?: TemplateConfig;
  readonly files: ReadonlyArray<TemplateFile>;
}
