export type LawbookScope =
  | 'global'
  | 'api'
  | 'ui'
  | 'issues'
  | 'workflows'
  | 'deploy'
  | 'observability';

export type LawbookCategory =
  | 'safety'
  | 'security'
  | 'reliability'
  | 'quality'
  | 'compliance'
  | 'performance'
  | 'cost'
  | 'product'
  | 'observability';

export type LawbookEnforcement = 'hard' | 'soft' | 'advisory';

export type LawbookJson<T> = {
  version: number;
} & T;

export type Guardrail = {
  id: string;
  title: string;
  description: string;
  scope: LawbookScope;
  category: LawbookCategory;
  enforcement: LawbookEnforcement;
  createdAt: string; // ISO
  updatedAt: string; // ISO
};

export type GuardrailsFile = LawbookJson<{
  guardrails: Guardrail[];
}>;

export type ParameterType = 'string' | 'number' | 'boolean' | 'json';

export type LawbookParameter = {
  key: string;
  title: string;
  description: string;
  scope: LawbookScope;
  category: LawbookCategory;
  type: ParameterType;
  defaultValue: unknown;
  createdAt: string; // ISO
  updatedAt: string; // ISO
};

export type ParametersFile = LawbookJson<{
  parameters: LawbookParameter[];
}>;

export type MemorySeedEntry = {
  id: string;
  title: string;
  content: string;
  scope: LawbookScope;
  category: LawbookCategory;
  createdAt: string; // ISO
  updatedAt: string; // ISO
};

export type MemorySeedFile = LawbookJson<{
  entries: MemorySeedEntry[];
}>;

export type ContextTrace = {
  paramsHash: string;
  guardrailIdsApplied: string[];
  memoryIdsUsed: string[];
};

export type LoadedLawbook<T> = {
  hash: string;
  data: T;
};
