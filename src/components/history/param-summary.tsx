import { formatDuration } from "@/lib/format";
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

// Compact parameter summary (6.6): art style, clip length, prompt type and
// frame-rate setting. One of the History view's three named deliverables --
// shown here as text, not only implied by the players in VideoPair.
export function ParamSummary({ params }: ParamSummaryProps) {
  const clipSeconds = params.endSeconds - params.startSeconds;

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-muted-foreground @sm:grid-cols-4">
      <div>
        <dt className="sr-only">Art style</dt>
        <dd className="text-foreground">{params.artStyle}</dd>
      </div>
      <div>
        <dt className="sr-only">Clip length</dt>
        <dd>{formatDuration(clipSeconds)} clip</dd>
      </div>
      <div>
        <dt className="sr-only">Prompt</dt>
        <dd>{PROMPT_TYPE_SUMMARY[params.promptType]}</dd>
      </div>
      <div>
        <dt className="sr-only">Frame rate</dt>
        <dd>{FPS_SUMMARY[params.fpsResolution]}</dd>
      </div>
    </dl>
  );
}
