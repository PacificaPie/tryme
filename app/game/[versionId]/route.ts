import { gameResponse } from '@/lib/funtrack/server';
export async function GET(request: Request, context: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await context.params;
  return gameResponse(request, versionId);
}
