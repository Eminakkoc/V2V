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
import { Textarea } from "@/components/ui/textarea";
import { ART_STYLES, MODELS, PROMPT_TYPES, VERSIONS } from "@/lib/magic-hour-styles";
import type { TransformParams } from "@/lib/transform-contract";
import { cn } from "@/lib/utils";

export type FieldErrors = Partial<Record<keyof TransformParams, string>>;

type OptionsFormProps = {
  value: TransformParams;
  onChange: (next: TransformParams) => void;
  disabled?: boolean;
  errors?: FieldErrors;
};

const PROMPT_TYPE_LABELS: Record<(typeof PROMPT_TYPES)[number], string> = {
  default: "Use the style's default prompt",
  custom: "Write a custom prompt",
  append_default: "Add to the style's default prompt",
};

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}

export function OptionsForm({ value, onChange, disabled = false, errors = {} }: OptionsFormProps) {
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

  // The SDK requires a non-empty prompt for append_default as well as custom
  // (transformParamsSchema enforces the same rule), so the box isn't gated on
  // "custom" alone.
  const showPrompt = value.promptType === "custom" || value.promptType === "append_default";

  function set<K extends keyof TransformParams>(key: K, next: TransformParams[K]) {
    onChange({ ...value, [key]: next });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={nameId}>Job name</Label>
        <Input
          id={nameId}
          value={value.name}
          disabled={disabled}
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? nameErrorId : undefined}
          onChange={(event) => set("name", event.target.value)}
        />
        <FieldError id={nameErrorId} message={errors.name} />
      </div>

      <div className="flex flex-col gap-1.5">
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
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={promptTypeId}>Prompt type</Label>
        <Select
          value={value.promptType}
          disabled={disabled}
          onValueChange={(next) => set("promptType", next as TransformParams["promptType"])}
        >
          <SelectTrigger id={promptTypeId} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROMPT_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {PROMPT_TYPE_LABELS[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {showPrompt ? (
          <div className="flex flex-col gap-1.5 pt-1.5">
            <Label htmlFor={promptId}>Prompt</Label>
            <Textarea
              id={promptId}
              value={value.prompt ?? ""}
              disabled={disabled}
              aria-invalid={errors.prompt ? true : undefined}
              aria-describedby={errors.prompt ? promptErrorId : undefined}
              onChange={(event) => set("prompt", event.target.value)}
            />
            <FieldError id={promptErrorId} message={errors.prompt} />
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={fpsId}>Frame rate</Label>
        <Select
          value={value.fpsResolution}
          disabled={disabled}
          onValueChange={(next) => set("fpsResolution", next as TransformParams["fpsResolution"])}
        >
          <SelectTrigger id={fpsId} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="HALF">Half (faster, lower cost)</SelectItem>
            <SelectItem value="FULL">Full</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Width/height are deprecated no-ops in the pinned SDK and don't exist in
          the schema, so Advanced holds only model and version. */}
      <Collapsible>
        <CollapsibleTrigger
          className={cn(
            "flex min-h-11 items-center gap-1.5 text-sm font-medium",
            "data-[state=open]:[&>svg]:rotate-180",
          )}
        >
          <ChevronDown aria-hidden className="size-4 transition-transform" />
          Advanced
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-4 pt-4">
          <div className="flex flex-col gap-1.5">
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
          </div>
          <div className="flex flex-col gap-1.5">
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
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
