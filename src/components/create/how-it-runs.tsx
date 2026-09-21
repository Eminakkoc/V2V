const STEPS = [
  {
    title: "Your file goes straight to storage",
    description: "Never through our servers, so big clips do not stall.",
  },
  {
    title: "The model renders in the background",
    description: "Close the tab if you like. The job keeps going.",
  },
  {
    title: "Results land in History",
    description: "Source and result side by side, every time.",
  },
] as const;

// The Create page's aside, shown only until a source is picked; `reuseCard` arrives already
// rendered from the server because answering "does this account have uploads" is a database read
// the drop zone must not wait on.
export function HowItRuns({ reuseCard }: { reuseCard?: React.ReactNode }) {
  return (
    <aside className="flex flex-col gap-4 sm:pt-3">
      <h2 className="type-h4">How it runs</h2>
      <ol className="flex flex-col gap-4">
        {STEPS.map((step, index) => (
          <li key={step.title} className="flex gap-4">
            <span
              aria-hidden
              className="flex size-[34px] shrink-0 items-center justify-center rounded-pill bg-accent2-200 font-display type-h5 text-accent2-800"
            >
              {/* -0.07em: Caprasimo's metrics are asymmetric (ascent 16,
                  descent 4 per 17px em) while a digit has no descender, so
                  centring the line box leaves the ink low in the disc. In em
                  so it holds if the step size ever changes. */}
              <span className="translate-y-[-0.07em]">{index + 1}</span>
            </span>
            <div className="flex min-w-0 flex-col">
              <p className="type-body font-semibold">{step.title}</p>
              <p className="type-body-sm text-muted-foreground">{step.description}</p>
            </div>
          </li>
        ))}
      </ol>

      {reuseCard}
    </aside>
  );
}
