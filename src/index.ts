export interface Env {
  ENVIRONMENT: string;
}

export default {
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    console.debug("TODO");
  },
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return new Response(null, { status: 404 });
  }
};
