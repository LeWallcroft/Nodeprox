export type ChapterReplacementResult = {
  replacementId: string;
  chapterId: string;
  previousImageCount: number;
  imageCount: number;
  retainedImageCount: number;
  createdImageCount: number;
  retiredImageCount: number;
  completedAt: Date;
};
