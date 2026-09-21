import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ImageReplacementFileValidationError } from "../../../lib/domains/images/api";
import { ApiError } from "../../../lib/api/types";
import {
  imageReplacementErrorMessage,
  replacementActionLabel,
  resetReplacementFileInput,
  SelectedImageReplacementAction,
  submitSelectedImageReplacement,
} from "./selected-image-replacement-action";

const selectedImage = { id: "image-1", filename: "page-001.jpg" };

function renderAction(capabilities: readonly string[] = ["images.replace"]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <SelectedImageReplacementAction
        capabilities={capabilities}
        chapterId="chapter-1"
        image={selectedImage}
      />
    </QueryClientProvider>,
  );
}

describe("SelectedImageReplacementAction", () => {
  it("renders the replacement action only as an enabled control with images.replace", () => {
    const markup = renderAction();

    expect(markup).toContain("Cambiar imagen");
    expect(markup).toContain("Cambiar imagen: page-001.jpg");
    expect(markup).toContain('type="file"');
    expect(markup).toContain('class="sr-only"');
    expect(markup).not.toContain(
      'aria-label="Cambiar imagen: page-001.jpg" disabled',
    );
  });

  it("keeps the file picker single-file and limited to the backend-supported MIME policy", () => {
    const markup = renderAction();

    expect(markup).toContain(
      'accept="image/jpeg,image/png,image/webp,image/gif"',
    );
    expect(markup).not.toContain("multiple");
    expect(markup).not.toContain("image/avif");
    expect(markup).not.toContain("application/zip");
  });

  it("disables replacement when the contextual capability is not projected", () => {
    expect(renderAction(["chapters.read"])).toContain("disabled");
  });

  it("exposes the approved loading labels", () => {
    expect(replacementActionLabel("idle")).toBe("Cambiar imagen");
    expect(replacementActionLabel("preparing")).toBe("Preparando…");
    expect(replacementActionLabel("uploading")).toBe("Subiendo…");
    expect(replacementActionLabel("completing")).toBe("Aplicando…");
  });

  it("maps validation and transport stages to safe feedback", () => {
    expect(
      imageReplacementErrorMessage(
        new ImageReplacementFileValidationError(),
        null,
      ),
    ).toBe("Selecciona una imagen JPG, PNG, WEBP o GIF válida.");
    expect(imageReplacementErrorMessage(new Error(), "uploading")).toBe(
      "No se pudo subir la imagen. Inténtalo nuevamente.",
    );
    expect(imageReplacementErrorMessage(new Error(), "completing")).toBe(
      "No se pudo aplicar el reemplazo de la imagen.",
    );
    expect(
      imageReplacementErrorMessage(
        new ApiError(409, "conflict", "image-replacement-conflict"),
        "preparing",
      ),
    ).toContain("cambio de imagen o de capítulo en curso");
  });

  it("submits the selected logical image and never generates storage or version authority", async () => {
    const mutateAsync = vi.fn().mockResolvedValue(undefined);
    const file = new File(["replacement"], "replacement.png", {
      type: "image/png",
    });

    await submitSelectedImageReplacement({
      chapterId: "chapter-1",
      image: selectedImage,
      file,
      mutateAsync,
    });

    expect(mutateAsync).toHaveBeenCalledWith({
      chapterId: "chapter-1",
      imageId: "image-1",
      file,
    });
  });

  it("rejects an invalid selection before invoking the mutation", async () => {
    const mutateAsync = vi.fn();

    await expect(
      submitSelectedImageReplacement({
        chapterId: "chapter-1",
        image: selectedImage,
        file: new File(["zip"], "replacement.zip", {
          type: "application/zip",
        }),
        mutateAsync,
      }),
    ).rejects.toBeInstanceOf(ImageReplacementFileValidationError);

    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("resets the native file input after an attempt", () => {
    const input = { value: "replacement.jpg" } as HTMLInputElement;

    resetReplacementFileInput(input);

    expect(input.value).toBe("");
  });
});
