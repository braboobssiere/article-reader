import { app } from '../src/index.js';

export default async function handler(request: Request) {
  return app.fetch(request);
}
