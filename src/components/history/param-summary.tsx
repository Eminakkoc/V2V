import { Badge } from "@/components/ui/badge";
import type { TransformParams } from "@/lib/transform-contract";

// Copy matches the create-page form (src/components/create/options-form.tsx)
// so a reader sees the same words on the form and on the card that resulted
// from it. F9: no fps numbers -- fpsResolution is relative to the source
// frame rate, which the sources model does not store.
const PROMPT_TYPE_SUMMARY: Record<TransformParams["promptType"], string> = {
  default: "Default prompt",
  custom: "Custom prompt",
  append_default: "Custom + default prompt",
};

const FPS_SUMMARY: Record<TransformParams["fpsResolution"], string> = {
  HALF: "Half frame rate",
  FULL: "Full frame rate",
};

type ParamSummaryProps = {
  params: TransformParams;
};

// Figma "Parameters": a wrapping row of neutral tags. One of the History
// view's three named deliverables (6.6) -- shown here as text, not only
// implied by the players. The art style is deliberately absent: the card's
// own title already carries it.
export function ParamSummary({ params }: ParamSummaryProps) {
  const clipSeconds = params.endSeconds - params.startSeconds;

  const items = [
    [
      "Clip",
      `${clipSeconds.toFixed(2)}s · ${params.startSeconds.toFixed(2)} to ${params.endSeconds.toFixed(2)}`,
    ],
    ["Prompt", PROMPT_TYPE_SUMMARY[params.promptType]],
    ["Frame rate", FPS_SUMMARY[params.fpsResolution]],
  ] as const;

  return (
    <dl className="flex flex-wrap items-center gap-2">
      {items.map(([term, value]) => (
        <div key={term}>
          <dt className="sr-only">{term}</dt>
          <dd>
            <Badge>{value}</Badge>
          </dd>
        </div>
      ))}
    </dl>
  );
}
