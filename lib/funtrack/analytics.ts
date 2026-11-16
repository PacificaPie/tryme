import { readAnalytics } from './analytics-query.mjs';

export async function analyticsResponse(url:URL,user:{id:string},database:D1Database){
  const result=await readAnalytics(url,user,database);
  return Response.json(result,{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
