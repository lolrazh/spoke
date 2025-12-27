export interface OcrResult {
  words: string[];
}

export interface OcrError {
  error: string;
  fallback: string[];
}
