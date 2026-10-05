import { UnrecoverableError, type Job } from "bullmq";
import { AdmissionTechnicalFailure } from "../admission-validation/application/admission-validation.service.js";
import { ProcessingPermanentFailure } from "../processing/application/chapter-processing.service.js";
import type { WorkerDependencies } from "./create-worker-dependencies.js";

export type WorkerJobHandlerDependencies = Pick<
  WorkerDependencies,
  | "logger"
  | "deletion"
  | "loadImageProcessingWarnings"
  | "createExtractor"
  | "createChapterProcessing"
  | "createReplacementProcessing"
  | "createAdmissionValidation"
>;

export function createWorkerJobHandler(
  dependencies: WorkerJobHandlerDependencies,
) {
  return async (job: Job) => {
    const correlation = {
      jobId: String(job.id),
      attemptsMade: job.attemptsMade,
      originRequestId: (job.data as { originRequestId?: string })
        .originRequestId,
      chapterId: (job.data as { chapterId?: string }).chapterId,
      uploadId: (job.data as { uploadId?: string }).uploadId,
      replacementId: (job.data as { replacementId?: string }).replacementId,
    };
    dependencies.logger.info(correlation, "Worker job started");
    if (job.name === "chapter.delete") {
      await dependencies.deletion.execute(job.data);
      dependencies.logger.info(correlation, "Worker job completed");
      return;
    }
    const warnings = await dependencies.loadImageProcessingWarnings();
    if (job.name === "chapter.upload.validate") {
      const finalAttempt =
        job.attemptsMade + 1 >= Number(job.opts.attempts ?? 1);
      try {
        const owner = job.data as { uploadId?: string; replacementId?: string };
        if (!owner.uploadId && !owner.replacementId)
          throw new UnrecoverableError("admission-owner-missing");
        await dependencies.createAdmissionValidation(warnings).validate({
          ...(owner.uploadId
            ? { uploadId: owner.uploadId }
            : { replacementId: owner.replacementId as string }),
          jobId: String(job.id),
          jobAttempt: job.attemptsMade + 1,
          finalAttempt,
          ...((job.data as { originRequestId?: string }).originRequestId
            ? {
                requestId: (job.data as { originRequestId: string })
                  .originRequestId,
              }
            : {}),
        });
      } catch (error) {
        if (error instanceof AdmissionTechnicalFailure && !error.retryable)
          throw new UnrecoverableError(error.code);
        throw error;
      }
      dependencies.logger.info(correlation, "Worker job completed");
      return;
    }
    const extractor = dependencies.createExtractor(warnings);
    if (job.name === "chapter.replacement.process")
      await dependencies
        .createReplacementProcessing(extractor)
        .process(
          job.data,
          job.attemptsMade + 1 >= Number(job.opts.attempts ?? 1),
          { jobId: String(job.id), jobAttempt: job.attemptsMade + 1 },
        );
    else {
      const finalAttempt =
        job.attemptsMade + 1 >= Number(job.opts.attempts ?? 1);
      try {
        await dependencies
          .createChapterProcessing(extractor)
          .process(job.data, finalAttempt, {
            jobId: String(job.id),
            jobAttempt: job.attemptsMade + 1,
          });
      } catch (error) {
        if (error instanceof ProcessingPermanentFailure)
          throw new UnrecoverableError(error.code);
        throw error;
      }
    }
    dependencies.logger.info(correlation, "Worker job completed");
  };
}
