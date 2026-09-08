import { createConfigHandler } from './handler.mjs';
Deno.serve(createConfigHandler({getEnv:(name: string) => Deno.env.get(name)}));
