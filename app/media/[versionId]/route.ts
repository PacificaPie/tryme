import { mediaResponse } from '@/lib/funtrack/server';
export async function GET(request: Request, context: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await context.params;
  return mediaResponse(request, versionId);
}
