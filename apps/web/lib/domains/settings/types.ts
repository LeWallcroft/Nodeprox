export type ProductSettingField = {
  key: string;
  label: string;
  description: string;
  unit: string;
  helpText: string;
  impact: string;
  type: "number" | "boolean" | "text" | "select";
  value: number | boolean | string;
  editable: boolean;
  constraints?: { min?: number; max?: number; options?: string[] };
};

export type ProductSettings = {
  sections: Array<{ id: string; label: string; fields: ProductSettingField[] }>;
};
