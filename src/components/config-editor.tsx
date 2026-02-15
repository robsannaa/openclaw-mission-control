"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  ChevronDown,
  ChevronRight,
  Save,
  AlertCircle,
  CheckCircle,
  Shield,
  RefreshCw,
  Eye,
  EyeOff,
  Search,
  X,
  Plus,
  Trash2,
  RotateCcw,
  AlertTriangle,
  Info,
  Code,
  Settings2,
  Loader2,
  GripVertical,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ================================================================
   Types
   ================================================================ */

type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  additionalProperties?: JsonSchema | boolean;
  propertyNames?: JsonSchema;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  enum?: string[];
  const?: unknown;
  default?: unknown;
  minLength?: number;
  description?: string;
  $schema?: string;
};

type UiHint = {
  label?: string;
  help?: string;
  group?: string;
  order?: number;
  sensitive?: boolean;
  enum?: string[];
  placeholder?: string;
};

type Toast = { ok: boolean; msg: string };

/* ================================================================
   Section metadata (icons + ordering)
   ================================================================ */

const SECTION_ICONS: Record<string, string> = {
  gateway: "🌐",
  channels: "💬",
  agents: "🤖",
  models: "🧠",
  env: "🔑",
  auth: "🔐",
  tools: "🔧",
  bindings: "🔗",
  messages: "✉️",
  commands: "⌘",
  hooks: "🪝",
  skills: "⚡",
  plugins: "🔌",
  browser: "🌍",
  talk: "🗣️",
  meta: "📋",
  wizard: "🧙",
  session: "📍",
  cron: "⏰",
  ui: "🎨",
  discovery: "📡",
  canvasHost: "🖼️",
  audio: "🔊",
  media: "🎬",
  memory: "💾",
  approvals: "✅",
  nodeHost: "🖥️",
  broadcast: "📢",
  update: "🔄",
  diagnostics: "🩺",
  logging: "📝",
  web: "🕸️",
  presence: "👁️",
  voicewake: "🎤",
};

const READONLY_SECTIONS = new Set(["meta", "wizard", "diagnostics"]);
const SENSITIVE_SECTIONS = new Set(["env", "auth"]);

/* ================================================================
   Helpers
   ================================================================ */

/** Get a nested value by dot-path from an object */
function getDeep(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/** Set a nested value by dot-path (returns a new object) */
function setDeep(
  obj: Record<string, unknown>,
  path: string,
  value: unknown
): Record<string, unknown> {
  const parts = path.split(".");
  const result = { ...obj };
  let cur: Record<string, unknown> = result;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    const existing = cur[p];
    if (existing && typeof existing === "object" && !Array.isArray(existing)) {
      cur[p] = { ...(existing as Record<string, unknown>) };
    } else {
      cur[p] = {};
    }
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
  return result;
}

/** Delete a nested key by dot-path (returns a new object) */
function deleteDeep(
  obj: Record<string, unknown>,
  path: string
): Record<string, unknown> {
  const parts = path.split(".");
  if (parts.length === 1) {
    const r = { ...obj };
    delete r[parts[0]];
    return r;
  }
  const result = { ...obj };
  let cur: Record<string, unknown> = result;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    const existing = cur[p];
    if (existing && typeof existing === "object" && !Array.isArray(existing)) {
      cur[p] = { ...(existing as Record<string, unknown>) };
    } else {
      return result; // path doesn't exist
    }
    cur = cur[p] as Record<string, unknown>;
  }
  delete cur[parts[parts.length - 1]];
  return result;
}

/** Build a nested object from a dot-path + value, for config.patch */
function buildPatchObject(
  path: string,
  value: unknown
): Record<string, unknown> {
  const parts = path.split(".");
  const result: Record<string, unknown> = {};
  let cur = result;
  for (let i = 0; i < parts.length - 1; i++) {
    cur[parts[i]] = {};
    cur = cur[parts[i]] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
  return result;
}

/** Get the label for a config path from hints */
function getLabel(
  hints: Record<string, UiHint>,
  path: string,
  fallback: string
): string {
  return hints[path]?.label || fallback;
}

function getHelp(hints: Record<string, UiHint>, path: string): string {
  return hints[path]?.help || "";
}

function isSensitivePath(
  hints: Record<string, UiHint>,
  path: string
): boolean {
  if (hints[path]?.sensitive) return true;
  const parts = path.split(".");
  return SENSITIVE_SECTIONS.has(parts[0]);
}

/** Infer field type from JSON Schema */
function inferFieldType(
  schema: JsonSchema | undefined,
  hint: UiHint | undefined
): "string" | "number" | "boolean" | "array" | "object" | "enum" | "unknown" {
  if (hint?.enum && hint.enum.length > 0) return "enum";
  if (schema?.enum && schema.enum.length > 0) return "enum";
  if (schema?.const !== undefined) return "enum";
  if (schema?.anyOf || schema?.oneOf) {
    const variants = schema.anyOf || schema.oneOf || [];
    // Check if it's an enum-like anyOf (all const/enum)
    const isEnumLike = variants.every(
      (v) => v.const !== undefined || (v.enum && v.enum.length > 0) || v.type === "string"
    );
    if (isEnumLike && variants.length <= 10) return "enum";
  }
  switch (schema?.type) {
    case "string":
      return "string";
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    case "array":
      return "array";
    case "object":
      return "object";
  }
  return "unknown";
}

/** Extract enum values from schema */
function extractEnumValues(schema: JsonSchema | undefined): string[] {
  if (!schema) return [];
  if (schema.enum) return schema.enum;
  if (schema.const !== undefined) return [String(schema.const)];
  if (schema.anyOf || schema.oneOf) {
    const vals: string[] = [];
    for (const v of schema.anyOf || schema.oneOf || []) {
      if (v.const !== undefined) vals.push(String(v.const));
      if (v.enum) vals.push(...v.enum);
    }
    return vals;
  }
  return [];
}

/* ================================================================
   Toast
   ================================================================ */

function ToastBar({ toast, onDone }: { toast: Toast; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 4000);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div
      className={cn(
        "fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-lg border px-4 py-2.5 text-[13px] font-medium shadow-xl backdrop-blur-sm",
        toast.ok
          ? "border-emerald-500/30 bg-emerald-950/80 text-emerald-300"
          : "border-red-500/30 bg-red-950/80 text-red-300"
      )}
    >
      <div className="flex items-center gap-2">
        {toast.ok ? (
          <CheckCircle className="h-4 w-4" />
        ) : (
          <AlertCircle className="h-4 w-4" />
        )}
        {toast.msg}
      </div>
    </div>
  );
}

/* ================================================================
   Restart Banner
   ================================================================ */

function RestartBanner({ onRestart, onDismiss }: { onRestart: () => void; onDismiss: () => void }) {
  return (
    <div className="mx-6 mb-3 flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.08] px-4 py-3">
      <AlertTriangle className="h-5 w-5 shrink-0 text-amber-400" />
      <div className="flex-1">
        <p className="text-[13px] font-medium text-amber-200">
          Configuration changed — restart recommended
        </p>
        <p className="text-[11px] text-amber-400/70 mt-0.5">
          Some changes require a gateway restart to take effect.
        </p>
      </div>
      <button
        onClick={onRestart}
        className="rounded-lg bg-amber-500/20 px-4 py-1.5 text-[12px] font-semibold text-amber-200 transition-colors hover:bg-amber-500/30"
      >
        Restart Gateway
      </button>
      <button
        onClick={onDismiss}
        className="rounded p-1 text-amber-500/50 transition-colors hover:text-amber-400"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

/* ================================================================
   Field Renderers
   ================================================================ */

function FieldLabel({
  path,
  label,
  help,
  sensitive,
  required,
}: {
  path: string;
  label: string;
  help?: string;
  sensitive?: boolean;
  required?: boolean;
}) {
  return (
    <div className="mb-1">
      <div className="flex items-center gap-1.5">
        <label className="text-[12px] font-medium text-foreground/70">
          {label}
          {required && <span className="text-red-400 ml-0.5">*</span>}
        </label>
        {sensitive && (
          <Shield className="h-3 w-3 text-amber-500" />
        )}
      </div>
      {help && (
        <p className="text-[10px] text-muted-foreground/60 mt-0.5 leading-relaxed">
          {help}
        </p>
      )}
    </div>
  );
}

function StringField({
  value,
  onChange,
  placeholder,
  sensitive,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  sensitive?: boolean;
  disabled?: boolean;
}) {
  const [show, setShow] = useState(!sensitive);
  return (
    <div className="flex items-center gap-1">
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder || ""}
        className="flex-1 rounded-lg border border-foreground/[0.08] bg-muted px-3 py-1.5 text-[12px] text-foreground/90 outline-none transition-colors focus:border-violet-500/30 disabled:opacity-50 font-mono"
      />
      {sensitive && (
        <button
          type="button"
          onClick={() => setShow(!show)}
          className="rounded p-1 text-muted-foreground/60 hover:text-muted-foreground"
        >
          {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
      )}
    </div>
  );
}

function NumberField({
  value,
  onChange,
  disabled,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  disabled?: boolean;
}) {
  return (
    <input
      type="number"
      value={value ?? ""}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v === "" ? undefined : Number(v));
      }}
      disabled={disabled}
      className="w-full rounded-lg border border-foreground/[0.08] bg-muted px-3 py-1.5 text-[12px] text-foreground/90 outline-none transition-colors focus:border-violet-500/30 disabled:opacity-50 font-mono"
    />
  );
}

function BooleanField({
  value,
  onChange,
  disabled,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!value)}
      disabled={disabled}
      className={cn(
        "relative h-6 w-11 rounded-full transition-colors",
        value ? "bg-violet-500" : "bg-muted",
        disabled && "opacity-50"
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
          value ? "left-[22px]" : "left-0.5"
        )}
      />
    </button>
  );
}

function EnumField({
  value,
  options,
  onChange,
  disabled,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  // For 2-4 options use buttons, for more use select
  if (options.length <= 5) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => !disabled && onChange(opt)}
            disabled={disabled}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-[11px] font-medium transition-all",
              value === opt
                ? "border-violet-500/40 bg-violet-500/15 text-violet-300"
                : "border-foreground/[0.08] bg-foreground/[0.02] text-muted-foreground hover:border-foreground/[0.15] hover:text-foreground/70"
            )}
          >
            {opt}
          </button>
        ))}
      </div>
    );
  }

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="rounded-lg border border-foreground/[0.08] bg-muted px-3 py-1.5 text-[12px] text-foreground/90 outline-none"
    >
      <option value="">Select...</option>
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  );
}

function ArrayField({
  value,
  onChange,
  itemSchema,
  disabled,
}: {
  value: unknown[];
  onChange: (v: unknown[]) => void;
  itemSchema?: JsonSchema;
  disabled?: boolean;
}) {
  const isStringArray = !itemSchema || itemSchema.type === "string";

  const addItem = () => {
    onChange([...value, ""]);
  };

  const removeItem = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx));
  };

  const updateItem = (idx: number, v: unknown) => {
    const next = [...value];
    next[idx] = v;
    onChange(next);
  };

  if (!isStringArray) {
    // Complex array — fall back to JSON editor
    return (
      <JsonFallbackField
        value={value}
        onChange={(v) => onChange(Array.isArray(v) ? v : [v])}
        disabled={disabled}
      />
    );
  }

  return (
    <div className="space-y-1.5">
      {value.map((item, idx) => (
        <div key={idx} className="flex items-center gap-1.5">
          <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground/40" />
          <input
            type="text"
            value={String(item)}
            onChange={(e) => updateItem(idx, e.target.value)}
            disabled={disabled}
            className="flex-1 rounded-lg border border-foreground/[0.08] bg-muted px-3 py-1.5 text-[12px] text-foreground/90 outline-none font-mono focus:border-violet-500/30"
          />
          {!disabled && (
            <button
              type="button"
              onClick={() => removeItem(idx)}
              className="rounded p-1 text-muted-foreground/60 hover:text-red-400 transition-colors"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      ))}
      {!disabled && (
        <button
          type="button"
          onClick={addItem}
          className="flex items-center gap-1 rounded-lg border border-dashed border-foreground/[0.1] px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:border-violet-500/30 hover:text-violet-400"
        >
          <Plus className="h-3 w-3" />
          Add item
        </button>
      )}
    </div>
  );
}

function JsonFallbackField({
  value,
  onChange,
  disabled,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState(JSON.stringify(value, null, 2) ?? "");
  const [error, setError] = useState("");

  const handleBlur = () => {
    try {
      const parsed = JSON.parse(text);
      setError("");
      onChange(parsed);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="space-y-1">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={handleBlur}
        disabled={disabled}
        rows={Math.min(12, (text || "").split("\n").length + 1)}
        className="w-full rounded-lg border border-foreground/[0.08] bg-muted p-3 font-mono text-[11px] leading-5 text-foreground/70 outline-none resize-y focus:border-violet-500/30 disabled:opacity-50"
        spellCheck={false}
      />
      {error && (
        <p className="flex items-center gap-1 text-[10px] text-red-400">
          <AlertCircle className="h-3 w-3" />
          {error}
        </p>
      )}
    </div>
  );
}

/* ================================================================
   Section renderer — renders all fields in a config section
   ================================================================ */

function SectionFields({
  sectionKey,
  sectionSchema,
  sectionValue,
  hints,
  showSensitive,
  onFieldChange,
  disabled,
}: {
  sectionKey: string;
  sectionSchema: JsonSchema | undefined;
  sectionValue: unknown;
  hints: Record<string, UiHint>;
  showSensitive: boolean;
  onFieldChange: (path: string, value: unknown) => void;
  disabled: boolean;
}) {
  if (sectionValue == null || typeof sectionValue !== "object") {
    return (
      <div className="text-[11px] text-muted-foreground/60 italic">
        No configuration set for this section.
      </div>
    );
  }

  const props = sectionSchema?.properties || {};
  const val = sectionValue as Record<string, unknown>;

  // Get all keys: from schema + from value (to show unknown keys)
  const allKeys = Array.from(
    new Set([...Object.keys(props), ...Object.keys(val)])
  );

  // Sort: schema-defined first (by hint order), then extras
  allKeys.sort((a, b) => {
    const aHint = hints[`${sectionKey}.${a}`];
    const bHint = hints[`${sectionKey}.${b}`];
    const aOrder = aHint?.order ?? 999;
    const bOrder = bHint?.order ?? 999;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.localeCompare(b);
  });

  return (
    <div className="space-y-4">
      {allKeys.map((key) => {
        const fullPath = `${sectionKey}.${key}`;
        const fieldSchema = props[key];
        const fieldValue = val[key];
        const hint = hints[fullPath];
        const label = getLabel(hints, fullPath, key);
        const help = getHelp(hints, fullPath);
        const sensitive = isSensitivePath(hints, fullPath);
        const fieldType = inferFieldType(fieldSchema, hint);

        // Skip undefined values with no schema
        if (fieldValue === undefined && !fieldSchema) return null;

        // For nested objects, render recursively
        if (
          fieldType === "object" &&
          fieldValue &&
          typeof fieldValue === "object" &&
          !Array.isArray(fieldValue)
        ) {
          return (
            <NestedSection
              key={key}
              path={fullPath}
              label={label}
              help={help}
              schema={fieldSchema}
              value={fieldValue as Record<string, unknown>}
              hints={hints}
              showSensitive={showSensitive}
              onFieldChange={onFieldChange}
              disabled={disabled}
            />
          );
        }

        return (
          <div key={key} className="space-y-1">
            <FieldLabel
              path={fullPath}
              label={label}
              help={help}
              sensitive={sensitive && !showSensitive}
            />
            {renderField(
              fieldType,
              fieldValue,
              (v) => onFieldChange(fullPath, v),
              fieldSchema,
              hint,
              sensitive && !showSensitive,
              disabled
            )}
          </div>
        );
      })}
    </div>
  );
}

function renderField(
  fieldType: string,
  value: unknown,
  onChange: (v: unknown) => void,
  schema: JsonSchema | undefined,
  hint: UiHint | undefined,
  sensitive: boolean,
  disabled: boolean
) {
  switch (fieldType) {
    case "string":
      return (
        <StringField
          value={String(value ?? "")}
          onChange={onChange}
          sensitive={sensitive}
          disabled={disabled}
          placeholder={hint?.placeholder}
        />
      );
    case "number":
      return (
        <NumberField
          value={typeof value === "number" ? value : undefined}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case "boolean":
      return (
        <BooleanField
          value={Boolean(value)}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case "enum": {
      const options =
        hint?.enum ||
        extractEnumValues(schema);
      return (
        <EnumField
          value={String(value ?? "")}
          options={options}
          onChange={onChange}
          disabled={disabled}
        />
      );
    }
    case "array":
      return (
        <ArrayField
          value={Array.isArray(value) ? value : []}
          onChange={onChange}
          itemSchema={schema?.items}
          disabled={disabled}
        />
      );
    default:
      return (
        <JsonFallbackField
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      );
  }
}

/* ================================================================
   Nested section (collapsible sub-object)
   ================================================================ */

function NestedSection({
  path,
  label,
  help,
  schema,
  value,
  hints,
  showSensitive,
  onFieldChange,
  disabled,
}: {
  path: string;
  label: string;
  help?: string;
  schema: JsonSchema | undefined;
  value: Record<string, unknown>;
  hints: Record<string, UiHint>;
  showSensitive: boolean;
  onFieldChange: (path: string, value: unknown) => void;
  disabled: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const props = schema?.properties || {};
  const allKeys = Array.from(
    new Set([...Object.keys(props), ...Object.keys(value)])
  );

  allKeys.sort((a, b) => {
    const aHint = hints[`${path}.${a}`];
    const bHint = hints[`${path}.${b}`];
    const aOrder = aHint?.order ?? 999;
    const bOrder = bHint?.order ?? 999;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.localeCompare(b);
  });

  // If schema has no known properties, it's a dynamic map — use JSON fallback
  const isDynamicMap =
    Object.keys(props).length === 0 &&
    (schema?.additionalProperties !== undefined ||
      schema?.propertyNames !== undefined);

  return (
    <div className="rounded-lg border border-foreground/[0.04] bg-foreground/[0.01]">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground/60" />
        )}
        <span className="text-[12px] font-medium text-foreground/70">{label}</span>
        <span className="text-[10px] text-muted-foreground/60">
          {allKeys.length} field{allKeys.length !== 1 ? "s" : ""}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-foreground/[0.04] px-3 py-3 space-y-3">
          {help && (
            <p className="text-[10px] text-muted-foreground/60 leading-relaxed">{help}</p>
          )}
          {isDynamicMap ? (
            <JsonFallbackField
              value={value}
              onChange={(v) => onFieldChange(path, v)}
              disabled={disabled}
            />
          ) : (
            allKeys.map((key) => {
              const fullPath = `${path}.${key}`;
              const fieldSchema = props[key];
              const fieldValue = value[key];
              const hint = hints[fullPath];
              const fLabel = getLabel(hints, fullPath, key);
              const fHelp = getHelp(hints, fullPath);
              const sensitive = isSensitivePath(hints, fullPath);
              const fieldType = inferFieldType(fieldSchema, hint);

              if (fieldValue === undefined && !fieldSchema) return null;

              // Recurse for nested objects
              if (
                fieldType === "object" &&
                fieldValue &&
                typeof fieldValue === "object" &&
                !Array.isArray(fieldValue)
              ) {
                return (
                  <NestedSection
                    key={key}
                    path={fullPath}
                    label={fLabel}
                    help={fHelp}
                    schema={fieldSchema}
                    value={fieldValue as Record<string, unknown>}
                    hints={hints}
                    showSensitive={showSensitive}
                    onFieldChange={onFieldChange}
                    disabled={disabled}
                  />
                );
              }

              return (
                <div key={key} className="space-y-1">
                  <FieldLabel
                    path={fullPath}
                    label={fLabel}
                    help={fHelp}
                    sensitive={sensitive && !showSensitive}
                  />
                  {renderField(
                    fieldType,
                    fieldValue,
                    (v) => onFieldChange(fullPath, v),
                    fieldSchema,
                    hint,
                    sensitive && !showSensitive,
                    disabled
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

/* ================================================================
   Main ConfigEditor
   ================================================================ */

export function ConfigEditor() {
  const [rawConfig, setRawConfig] = useState<Record<string, unknown> | null>(null);
  const [baseHash, setBaseHash] = useState("");
  const [schema, setSchema] = useState<Record<string, JsonSchema>>({});
  const [hints, setHints] = useState<Record<string, UiHint>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showSensitive, setShowSensitive] = useState(false);
  const [search, setSearch] = useState("");
  const [pendingChanges, setPendingChanges] = useState<
    Record<string, unknown>
  >({});
  const [showRestart, setShowRestart] = useState(false);
  const [showRawJson, setShowRawJson] = useState(false);

  // Track which sections have unsaved edits
  const [dirtyPaths, setDirtyPaths] = useState<Set<string>>(new Set());

  /* ── Fetch ─────────────────────────── */

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/config");
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setRawConfig(data.rawConfig || data.config || {});
      setBaseHash(data.baseHash || "");
      if (data.schema?.properties) {
        setSchema(data.schema.properties);
      }
      if (data.uiHints) setHints(data.uiHints);
    } catch (err) {
      console.error("Config fetch error:", err);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  /* ── Section ordering ────────────── */

  const sections = rawConfig
    ? Object.keys(rawConfig).sort((a, b) => {
        const aOrder = hints[a]?.order ?? 999;
        const bOrder = hints[b]?.order ?? 999;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return a.localeCompare(b);
      })
    : [];

  const filteredSections = search
    ? sections.filter((s) => {
        const label = hints[s]?.label || s;
        const matchSection =
          label.toLowerCase().includes(search.toLowerCase()) ||
          s.toLowerCase().includes(search.toLowerCase());
        if (matchSection) return true;
        // Also search field labels within the section
        return Object.keys(hints).some(
          (k) =>
            k.startsWith(s + ".") &&
            (hints[k].label?.toLowerCase().includes(search.toLowerCase()) ||
              k.toLowerCase().includes(search.toLowerCase()))
        );
      })
    : sections;

  /* ── Field change handler ─────────── */

  const handleFieldChange = useCallback(
    (path: string, value: unknown) => {
      if (!rawConfig) return;
      const newConfig = setDeep(rawConfig, path, value);
      setRawConfig(newConfig);
      setPendingChanges((prev) => ({
        ...prev,
        ...buildPatchObject(path, value),
      }));
      setDirtyPaths((prev) => new Set([...prev, path.split(".")[0]]));
    },
    [rawConfig]
  );

  /* ── Save ───────────────────────────── */

  const saveChanges = useCallback(async () => {
    if (Object.keys(pendingChanges).length === 0) return;
    setSaving(true);
    try {
      const res = await fetch("/api/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patch: pendingChanges, baseHash }),
      });
      const data = await res.json();
      if (data.ok) {
        setToast({ ok: true, msg: "Configuration saved successfully" });
        setPendingChanges({});
        setDirtyPaths(new Set());
        setShowRestart(true);
        // Refresh to get new hash
        await fetchConfig();
      } else {
        setToast({ ok: false, msg: data.error || "Save failed" });
      }
    } catch (err) {
      setToast({ ok: false, msg: String(err) });
    }
    setSaving(false);
  }, [pendingChanges, baseHash, fetchConfig]);

  /* ── Restart gateway ────────────── */

  const restartGateway = useCallback(async () => {
    try {
      const res = await fetch("/api/gateway", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restart" }),
      });
      const data = await res.json();
      if (data.ok) {
        setToast({ ok: true, msg: "Gateway restart initiated" });
        setShowRestart(false);
      } else {
        setToast({ ok: false, msg: data.error || "Restart failed" });
      }
    } catch (err) {
      setToast({ ok: false, msg: String(err) });
    }
  }, []);

  /* ── Discard ────────────────────── */

  const discardChanges = useCallback(() => {
    setPendingChanges({});
    setDirtyPaths(new Set());
    fetchConfig();
  }, [fetchConfig]);

  const toggleSection = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const hasDirty = dirtyPaths.size > 0;

  /* ── Loading state ─────────────── */

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-violet-400" />
      </div>
    );
  }

  if (!rawConfig) {
    return (
      <div className="flex flex-1 items-center justify-center text-[13px] text-muted-foreground">
        <AlertCircle className="mr-2 h-4 w-4" />
        Failed to load configuration
      </div>
    );
  }

  /* ── Render ─────────────────────── */

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-foreground/[0.06] px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-[18px] font-semibold text-foreground">
              <Settings2 className="h-5 w-5 text-violet-400" />
              Configuration
            </h1>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              Edit your OpenClaw settings safely &bull; Changes are validated before saving
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Search */}
            <div className="flex items-center gap-1.5 rounded-lg border border-foreground/[0.08] bg-muted/50 px-2.5 py-1.5">
              <Search className="h-3.5 w-3.5 text-muted-foreground/60" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search settings..."
                className="w-36 bg-transparent text-[12px] text-foreground/70 outline-none placeholder:text-muted-foreground/60"
              />
              {search && (
                <button onClick={() => setSearch("")} className="text-muted-foreground/60 hover:text-muted-foreground">
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowSensitive(!showSensitive)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] transition-colors",
                showSensitive
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                  : "border-foreground/[0.08] text-muted-foreground hover:bg-muted/80"
              )}
            >
              {showSensitive ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              Secrets
            </button>

            <button
              type="button"
              onClick={() => setShowRawJson(!showRawJson)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] transition-colors",
                showRawJson
                  ? "border-violet-500/30 bg-violet-500/10 text-violet-400"
                  : "border-foreground/[0.08] text-muted-foreground hover:bg-muted/80"
              )}
            >
              <Code className="h-3 w-3" />
              Raw
            </button>

            <button
              type="button"
              onClick={fetchConfig}
              className="rounded-lg border border-foreground/[0.08] p-1.5 text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground/70"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Restart banner */}
      {showRestart && (
        <div className="shrink-0 pt-3">
          <RestartBanner
            onRestart={restartGateway}
            onDismiss={() => setShowRestart(false)}
          />
        </div>
      )}

      {/* Unsaved changes bar */}
      {hasDirty && (
        <div className="shrink-0 flex items-center gap-3 border-b border-violet-500/20 bg-violet-500/[0.06] px-6 py-2.5">
          <Info className="h-4 w-4 text-violet-400 shrink-0" />
          <p className="flex-1 text-[12px] text-violet-300">
            You have unsaved changes in{" "}
            <strong>{Array.from(dirtyPaths).join(", ")}</strong>
          </p>
          <button
            type="button"
            onClick={discardChanges}
            className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground/70"
          >
            <RotateCcw className="h-3 w-3" />
            Discard
          </button>
          <button
            type="button"
            onClick={saveChanges}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
        {showRawJson ? (
          /* Raw JSON view */
          <div className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[13px] font-medium text-foreground/70">
                Raw Configuration (read-only)
              </span>
              <span className="text-[10px] text-muted-foreground/60">
                Use the form view to make changes safely
              </span>
            </div>
            <pre className="max-h-[70vh] overflow-auto rounded-lg bg-muted p-4 font-mono text-[11px] leading-5 text-muted-foreground whitespace-pre-wrap">
              {JSON.stringify(rawConfig, null, 2)}
            </pre>
          </div>
        ) : (
          /* Form view */
          filteredSections.map((sectionKey) => {
            const isExpanded = expanded.has(sectionKey);
            const isReadonly = READONLY_SECTIONS.has(sectionKey);
            const isSensitive = SENSITIVE_SECTIONS.has(sectionKey);
            const isDirty = dirtyPaths.has(sectionKey);
            const sectionHint = hints[sectionKey];
            const label = sectionHint?.label || sectionKey;
            const icon = SECTION_ICONS[sectionKey] || "📦";
            const sectionSchema = schema[sectionKey];
            const sectionValue = rawConfig[sectionKey];

            // Count fields
            let fieldCount = 0;
            if (sectionValue && typeof sectionValue === "object") {
              fieldCount = Object.keys(sectionValue).length;
            }

            return (
              <div
                key={sectionKey}
                className={cn(
                  "rounded-xl border transition-colors",
                  isDirty
                    ? "border-violet-500/30 bg-violet-500/[0.03]"
                    : "border-foreground/[0.06] bg-foreground/[0.02]"
                )}
              >
                {/* Section header */}
                <div
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
                  onClick={() => toggleSection(sectionKey)}
                >
                  {isExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" />
                  )}
                  <span className="text-base">{icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-semibold text-foreground/90">
                        {label}
                      </span>
                      {isDirty && (
                        <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-violet-300">
                          Modified
                        </span>
                      )}
                      {isReadonly && (
                        <span className="rounded-full bg-muted/50 px-2 py-0.5 text-[9px] text-muted-foreground">
                          Read-only
                        </span>
                      )}
                      {isSensitive && !showSensitive && (
                        <Shield className="h-3 w-3 text-amber-500" />
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground/60">
                      {sectionHint?.help || `${fieldCount} setting${fieldCount !== 1 ? "s" : ""}`}
                    </p>
                  </div>
                </div>

                {/* Section content */}
                {isExpanded && (
                  <div className="border-t border-foreground/[0.04] px-4 py-4">
                    <SectionFields
                      sectionKey={sectionKey}
                      sectionSchema={sectionSchema}
                      sectionValue={sectionValue}
                      hints={hints}
                      showSensitive={showSensitive}
                      onFieldChange={handleFieldChange}
                      disabled={isReadonly}
                    />
                  </div>
                )}
              </div>
            );
          })
        )}

        {filteredSections.length === 0 && search && (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground/60">
            <Search className="h-6 w-6 mb-2" />
            <p className="text-[13px]">No settings match &ldquo;{search}&rdquo;</p>
            <button
              onClick={() => setSearch("")}
              className="mt-2 text-[11px] text-violet-400 hover:text-violet-300"
            >
              Clear search
            </button>
          </div>
        )}
      </div>

      {toast && <ToastBar toast={toast} onDone={() => setToast(null)} />}
    </div>
  );
}
