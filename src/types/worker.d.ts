// src/types/worker.d.ts
declare module "*?worker" {
  // Defines the type for Vite worker imports:
  // `import MyWorker from './my-worker?worker'`
  // `const worker = new MyWorker()`
  const workerConstructor: new () => Worker;
  export default workerConstructor;
}
