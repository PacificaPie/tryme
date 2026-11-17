import { publicCardPageResponse } from '@/lib/funtrack/server';
export async function GET(request: Request, context: { params: Promise<{ cardId: string }> }) {
  return publicCardPageResponse(request, (await context.params).cardId);
}
export const HEAD = GET;
