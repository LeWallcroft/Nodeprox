export class ProcessingPermanentFailure extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ProcessingPermanentFailure";
  }
}
