import { app } from '../src/app.ts';

export default async function handler(request: Request) {
  return app.fetch(request);
}
