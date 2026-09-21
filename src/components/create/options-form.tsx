"use client";

import { ChevronDown } from "lucide-react";
import { useId } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Textarea } from "@/components/ui/textarea";
import { ART_STYLES, MODELS, PROMPT_TYPES, VERSIONS } from "@/lib/magic-hour-styles";
import type { TransformParams } from "@/lib/transform-contract";

export type FieldErrors = Partial<Record<keyof TransformParams, string>>;

type OptionsFormProps = {
  value: TransformParams;
  onChange: (next: TransformParams) => void;
  disabled?: boolean;
  errors?: FieldErrors;
  // The summary and submit row. Owned by CreateFlow (it holds the submission
  // state) but rendered here so it sits inside the form panel on desktop, as
  // in the design, and can pin itself to the bottom on phones.
  footer?: React.ReactNode;
};

// Short labels for the segmented control, per the design. The full sentences
// live in the option's own helper text rather than inside a 13px segment.
const PROMPT_TYPE_LABELS: Record<(typeof PROMPT_TYPES)[number], string> = {
  default: "Default",
  custom: "Custom",
  append_default: "Add to default",
};

const PROMPT_TYPE_HELP: Record<(typeof PROMPT_TYPES)[number], string> = {
  default: "Uses the art style's own prompt.",
  custom: "Replaces the art style's prompt with yours.",
  append_default: "Adds your words to the art style's own prompt.",
};

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="type-caption text-accent-900">
      {message}
    </p>
  );
}

function Field({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-1.5">{children}</div>;
}

function Help({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <p id={id} className="type-caption text-muted-foreground">
      {children}
    </p>
  );
}

// Figma "Transformation form" (59:2641). From tablet up it is a surface panel
// at radius/card beside the preview; on phones the fields sit directly on the
// page, which is why the panel styling is behind `sm:`.
export function OptionsForm({
  value,
  onChange,
  disabled = false,
  errors = {},
  footer,
}: OptionsFormProps) {
  const nameId = useId();
  const artStyleId = useId();
  const promptTypeId = useId();
  const promptId = useId();
  const fpsId = useId();
  const modelId = useId();
  const versionId = useId();

  const nameErrorId = `${nameId}-error`;
  const artStyleErrorId = `${artStyleId}-error`;
  const promptErrorId = `${promptId}-error`;
  const fpsHelpId = `${fpsId}-help`;
  const promptTypeHelpId = `${promptTypeId}-help`;

  // The SDK requires a non-empty prompt for append_default as well as custom
  // (transformParamsSchema enforces the same rule), so the box isn't gated on
  // "custom" alone.
  const showPrompt = value.promptType === "custom" || value.promptType === "append_default";

  function set<K extends keyof TransformParams>(key: K, next: TransformParams[K]) {
    onChange({ ...value, [key]: next });
  }

  return (
    <div className="flex flex-col gap-4 sm:rounded-card sm:bg-surface sm:p-6">
      <h2 className="sr-only type-h4 sm:not-sr-only">Transformation</h2>

      <Field>
        <Label htmlFor={artStyleId}>Art style</Label>
        <Select
          value={value.artStyle}
          disabled={disabled}
          onValueChange={(next) => set("artStyle", next as TransformParams["artStyle"])}
        >
          <SelectTrigger
            id={artStyleId}
            className="w-full"
            aria-invalid={errors.artStyle ? true : undefined}
            aria-describedby={errors.artStyle ? artStyleErrorId : undefined}
          >
            <SelectValue placeholder="Choose a style" />
          </SelectTrigger>
          <SelectContent>
            {ART_STYLES.map((style) => (
              <SelectItem key={style} value={style}>
                {style}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldError id={artStyleErrorId} message={errors.artStyle} />
      </Field>

      <Field>
        <span id={promptTypeId} className="type-caption text-ink-label">
          Prompt
        </span>
        <SegmentedControl
          name="promptType"
          aria-labelledby={promptTypeId}
          value={value.promptType}
          disabled={disabled}
          options={PROMPT_TYPES.map((type) => ({
            value: type,
            label: PROMPT_TYPE_LABELS[type],
          }))}
          onChange={(next) => set("promptType", next)}
        />
        <Help id={promptTypeHelpId}>{PROMPT_TYPE_HELP[value.promptType]}</Help>
        {showPrompt ? (
          <div className="flex flex-col gap-1.5 pt-1.5">
            <Label htmlFor={promptId}>Your prompt</Label>
            <Textarea
              id={promptId}
              placeholder="Describe the look you want."
              value={value.prompt ?? ""}
              disabled={disabled}
              aria-invalid={errors.prompt ? true : undefined}
              aria-describedby={errors.prompt ? promptErrorId : undefined}
              onChange={(event) => set("prompt", event.target.value)}
            />
            <FieldError id={promptErrorId} message={errors.prompt} />
          </div>
        ) : null}
      </Field>

      <Field>
        <span id={fpsId} className="type-caption text-ink-label">
          Frame rate
        </span>
        <SegmentedControl
          name="fpsResolution"
          aria-labelledby={fpsId}
          value={value.fpsResolution}
          disabled={disabled}
          options={[
            { value: "HALF", label: "Half" },
            { value: "FULL", label: "Full" },
          ]}
          onChange={(next) => set("fpsResolution", next)}
        />
        <Help id={fpsHelpId}>Half renders every other frame and finishes sooner.</Help>
      </Field>

      <Field>
        <Label htmlFor={nameId}>Name</Label>
        <Input
          id={nameId}
          value={value.name}
          disabled={disabled}
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? nameErrorId : undefined}
          onChange={(event) => set("name", event.target.value)}
        />
        <FieldError id={nameErrorId} message={errors.name} />
      </Field>

      {/* Width/height are deprecated no-ops in the pinned SDK and don't exist in
          the schema, so Advanced holds only model and version. */}
      <Collapsible className="border-t border-divider">
        <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 rounded-lg px-1.5 py-(--disclosure-py) type-body font-semibold focus-ring data-[state=open]:[&>svg]:rotate-180">
          Advanced — model, version
          <ChevronDown aria-hidden className="size-[18px] shrink-0 transition-transform" />
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-4 pb-3">
          <Field>
            <Label htmlFor={modelId}>Model</Label>
            <Select
              value={value.model}
              disabled={disabled}
              onValueChange={(next) => set("model", next as TransformParams["model"])}
            >
              <SelectTrigger id={modelId} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODELS.map((model) => (
                  <SelectItem key={model} value={model}>
                    {model === "default" ? "Default" : model}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <Label htmlFor={versionId}>Version</Label>
            <Select
              value={value.version}
              disabled={disabled}
              onValueChange={(next) => set("version", next as TransformParams["version"])}
            >
              <SelectTrigger id={versionId} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VERSIONS.map((version) => (
                  <SelectItem key={version} value={version}>
                    {version === "default" ? "Default" : version.toUpperCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </CollapsibleContent>
      </Collapsible>

      {footer}
    </div>
  );
}
