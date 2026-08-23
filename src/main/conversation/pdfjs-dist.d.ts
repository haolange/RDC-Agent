declare module 'pdfjs-dist/legacy/build/pdf.mjs' {
  export const GlobalWorkerOptions: {
    workerSrc: string;
  };

  export class PasswordException extends Error {
    name: 'PasswordException';
  }

  export function getDocument(src: {
    data: Uint8Array;
    verbosity?: number;
  }): {
    promise: Promise<{
      numPages: number;
      getPage: (index: number) => Promise<{
        getTextContent: () => Promise<{ items: Array<{ str?: string }> }>;
      }>;
    }>;
  };
}
