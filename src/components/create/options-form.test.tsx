// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ART_STYLES } from "@/lib/magic-hour-styles";
import type { TransformParams } from "@/lib/transform-contract";
import { OptionsForm, type FieldErrors } from "./options-form";

function makeParams(overrides: Partial<TransformParams> = {}): TransformParams {
  return {
    name: "clip.mp4",
    startSeconds: 0,
    endSeconds: 5,
    fpsResolution: "HALF",
    artStyle: "Ghibli Anime",
    promptType: "default",
    model: "default",
    version: "default",
    ...overrides,
  };
}

function renderForm(overrides: Partial<Parameters<typeof OptionsForm>[0]> = {}) {
  const props = {
    value: makeParams(),
    onChange: vi.fn(),
    ...overrides,
  };
  render(<OptionsForm {...props} />);
  return props;
}

describe("OptionsForm", () => {
  it("renders the art style select with all 75 options", () => {
    renderForm();
    fireEvent.click(screen.getByRole("combobox", { name: "Art style" }));
    expect(screen.getAllByRole("option")).toHaveLength(ART_STYLES.length);
  });

  it("hides the prompt textarea for the default prompt type", () => {
    renderForm({ value: makeParams({ promptType: "default" }) });
    expect(screen.queryByRole("textbox", { name: "Your prompt" })).not.toBeInTheDocument();
  });

  it("shows the prompt textarea for a custom prompt", () => {
    renderForm({ value: makeParams({ promptType: "custom", prompt: "a cat" }) });
    expect(screen.getByRole("textbox", { name: "Your prompt" })).toHaveValue("a cat");
  });

  it("also shows the prompt textarea for append_default, not only custom", () => {
    renderForm({ value: makeParams({ promptType: "append_default", prompt: "and sparkles" }) });
    expect(screen.getByRole("textbox", { name: "Your prompt" })).toHaveValue("and sparkles");
  });

  it("defaults the frame rate to HALF", () => {
    renderForm();
    const group = screen.getByRole("radiogroup", { name: "Frame rate" });
    expect(within(group).getByRole("radio", { checked: true })).toHaveAccessibleName("Half");
  });

  it("defaults the job name to the source file name", () => {
    renderForm({ value: makeParams({ name: "vacation.mov" }) });
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("vacation.mov");
  });

  it("collapses Advanced by default and reveals model and version on toggle", () => {
    renderForm();
    expect(screen.queryByRole("combobox", { name: "Model" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Version" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Advanced/ }));
    expect(screen.getByRole("combobox", { name: "Model" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Version" })).toBeInTheDocument();
  });

  it("never renders a width or height control", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: /^Advanced/ }));
    expect(screen.queryByLabelText(/width/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/height/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/width/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/height/i)).not.toBeInTheDocument();
  });

  it("gives every control an accessible name", () => {
    renderForm({ value: makeParams({ promptType: "custom", prompt: "a cat" }) });
    fireEvent.click(screen.getByRole("button", { name: /^Advanced/ }));
    expect(screen.getByRole("textbox", { name: "Name" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Art style" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Prompt" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Your prompt" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Frame rate" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Model" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Version" })).toBeInTheDocument();
  });

  it("links an invalid field to its message with aria-describedby and marks it invalid", () => {
    const errors: FieldErrors = { name: "Name is required" };
    renderForm({ errors });
    const input = screen.getByRole("textbox", { name: "Name" });
    expect(input).toHaveAttribute("aria-invalid", "true");
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent("Name is required");
  });

  it("does not mark a field invalid when it has no error", () => {
    renderForm();
    expect(screen.getByRole("textbox", { name: "Name" })).not.toHaveAttribute("aria-invalid");
  });

  it("calls onChange with the whole params object when a field changes", () => {
    const props = renderForm();
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "new-name.mp4" },
    });
    expect(props.onChange).toHaveBeenCalledWith({ ...props.value, name: "new-name.mp4" });
  });

  it("disables every control when disabled", () => {
    renderForm({ disabled: true });
    expect(screen.getByRole("textbox", { name: "Name" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Art style" })).toBeDisabled();
  });
});
